/**
 * Benchmark runner — executes agent tasks against the local Supabase stack and
 * grades the results.
 *
 * Per RunSpec:
 * 1. Create artifact dir: results/{condition}/{task}/run{N}/
 * 2. Compose the prompt (condition AGENTS.md preamble + task prompt)
 * 3. Run the `claude` agent in the fixture project dir
 * 4. Parse stream-json output → usage metrics
 * 5. Run the grader → grade.json
 * 6. Append to results.jsonl
 *
 * All three conditions hit the SAME running local stack:
 *   - cli  → raw `supabase` CLI (Bash)
 *   - axi  → `supabase-axi` (Bash; resolved from bench/bin shim → local build)
 *   - mcp  → the official Supabase MCP server exposed by the local stack at
 *            <api_url>/mcp (no shell access — genuinely exercises MCP tools)
 */

import { spawnSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { RunSpec, RunResult, ConditionDef, TaskDef } from "./types.js";
import { parseClaudeJsonl } from "./usage.js";
import { grade } from "./grader.js";

const BENCH_ROOT = resolve(import.meta.dirname, "..");
const RESULTS_DIR = join(BENCH_ROOT, "results");
const FIXTURE_DIR = join(BENCH_ROOT, "fixtures", "demo");
const BIN_DIR = join(BENCH_ROOT, "bin");

/** API URL of the local stack; the Supabase MCP lives at `${API_URL}/mcp`. */
const API_URL = process.env.BENCH_API_URL ?? "http://127.0.0.1:55321";
const MCP_URL = `${API_URL}/mcp`;

const AGENT_TIMEOUT_MS = 5 * 60 * 1000;

/** Bring the local stack up if it is not already running (idempotent). */
export function ensureStackUp(): void {
  console.log("  Ensuring local Supabase stack is up...");
  execSync("supabase start", { cwd: FIXTURE_DIR, stdio: "pipe" });
}

/** Tear the local stack down. */
export function stopStack(): void {
  console.log("  Stopping local Supabase stack...");
  try {
    execSync("supabase stop", { cwd: FIXTURE_DIR, stdio: "pipe" });
  } catch {
    // best-effort
  }
}

export function runOne(
  spec: RunSpec,
  condition: ConditionDef,
  task: TaskDef,
): RunResult {
  const artifactDir = join(RESULTS_DIR, spec.condition, spec.task, `run${spec.run}`);
  mkdirSync(artifactDir, { recursive: true });

  const { agentOutput, wallClockSeconds } = runAgent(spec, condition, task, artifactDir);

  writeFileSync(join(artifactDir, "agent_output.txt"), agentOutput);

  const usage = parseClaudeJsonl(agentOutput, {
    model: spec.model,
    wallClockSeconds,
  });

  const finalOutput = extractClaudeFinalOutput(agentOutput);

  const gradeResult = grade(task.grading, task.prompt, agentOutput, artifactDir);
  writeFileSync(join(artifactDir, "grade.json"), JSON.stringify(gradeResult, null, 2));

  const result: RunResult = {
    condition: spec.condition,
    task: spec.task,
    run: spec.run,
    model: spec.model,
    timestamp: new Date().toISOString(),
    usage,
    grade: gradeResult,
    agent_output: finalOutput.slice(0, 2000),
  };

  const resultsJsonl = join(RESULTS_DIR, "results.jsonl");
  appendFileSync(resultsJsonl, JSON.stringify(result) + "\n");

  return result;
}

/** Extract the agent's final text output from Claude stream-json output. */
function extractClaudeFinalOutput(jsonl: string): string {
  const parts: string[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (entry.type === "result" && typeof entry.result === "string") {
        return entry.result;
      }
      if (entry.type === "assistant") {
        const msg = entry.message as Record<string, unknown> | undefined;
        if (msg && Array.isArray(msg.content)) {
          for (const block of msg.content) {
            const b = block as Record<string, unknown>;
            if (b.type === "text" && typeof b.text === "string") {
              parts.push(b.text);
            }
          }
        }
      }
    } catch {
      continue;
    }
  }
  return parts.length > 0 ? parts.join("\n") : jsonl;
}

/** Compose the prompt: condition tool preamble + the task. */
export function composePrompt(condition: ConditionDef, task: TaskDef): string {
  return `${condition.agents_md.trim()}\n\n---\n\nTASK:\n${task.prompt.trim()}`;
}

function runAgent(
  spec: RunSpec,
  condition: ConditionDef,
  task: TaskDef,
  artifactDir: string,
): { agentOutput: string; wallClockSeconds: number } {
  const prompt = composePrompt(condition, task);

  const args = [
    "--setting-sources", "",
    "-p", prompt,
    "--model", spec.model,
    "--output-format", "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--no-session-persistence",
    "--disable-slash-commands",
  ];

  // Allowlist of tools for this condition.
  args.push("--allowedTools", ...condition.allowed_tools);

  // Denylist — hard-blocks tools even under --dangerously-skip-permissions.
  // This is what keeps the `mcp` condition genuinely shell-free: without it the
  // agent falls back to Bash (`find`/`ls`) instead of using the MCP interface.
  if (condition.disallowed_tools && condition.disallowed_tools.length > 0) {
    args.push("--disallowedTools", ...condition.disallowed_tools);
  }

  // MCP condition: register the local Supabase MCP server.
  if (condition.use_mcp) {
    const mcpConfig = {
      mcpServers: {
        supabase: { type: "http", url: MCP_URL },
      },
    };
    const mcpConfigPath = join(artifactDir, ".mcp-config.json");
    writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig));
    args.push("--mcp-config", mcpConfigPath);
  }

  // For the axi condition, prepend the bench/bin shim dir so `supabase-axi`
  // resolves to the locally-built CLI (tests current code, no network).
  const env = { ...process.env };
  env.PATH = `${BIN_DIR}:${env.PATH ?? ""}`;
  // Keep the agent on the local stack only — never touch cloud.
  delete env.SUPABASE_ACCESS_TOKEN;

  const startTime = Date.now();
  const proc = spawnSync("claude", args, {
    encoding: "utf-8",
    timeout: AGENT_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    cwd: FIXTURE_DIR,
    env,
  });

  const agentOutput = proc.stdout ?? "";
  if (proc.stderr) {
    writeFileSync(join(artifactDir, "stderr.txt"), proc.stderr);
  }
  if (!existsSync(FIXTURE_DIR)) {
    throw new Error(`Fixture dir missing: ${FIXTURE_DIR}`);
  }
  return { agentOutput, wallClockSeconds: (Date.now() - startTime) / 1000 };
}
