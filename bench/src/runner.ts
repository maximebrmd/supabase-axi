/**
 * Benchmark runner — executes agent tasks against a single throwaway Supabase
 * CLOUD project and grades the results.
 *
 * Per RunSpec:
 * 1. Create artifact dir: results/{condition}/{task}/run{N}/
 * 2. Compose the prompt (condition AGENTS.md preamble + task prompt)
 * 3. Run the `claude` agent in the fixture project dir (linked to the cloud project)
 * 4. Parse stream-json output → usage metrics
 * 5. Run the grader → grade.json
 * 6. Append to results.jsonl
 *
 * All three conditions hit the SAME cloud project (BENCH_PROJECT_REF):
 *   - cli  → raw `supabase` CLI (Bash), against the linked project
 *   - axi  → `supabase-axi` (Bash) — the published v1.1.0 release installed
 *            GLOBALLY (`npm i -g supabase-axi@1.1.0`) and invoked directly, on
 *            equal footing with the raw CLI (mirrors gh-axi's methodology). It
 *            includes the `db query` SQL command.
 *   - mcp  → the official Supabase MCP server (`@supabase/mcp-server-supabase`,
 *            read-only) spawned as a stdio subprocess. No shell access — it
 *            genuinely exercises the MCP tools.
 *
 * Auth: the agent and the MCP server read SUPABASE_ACCESS_TOKEN from the
 * environment. The runner NEVER reads, logs, or persists the token value — it
 * only forwards process.env. Export it in the shell before running the matrix.
 */

import { spawnSync, execSync } from "node:child_process";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { RunSpec, RunResult, ConditionDef, TaskDef } from "./types.js";
import { parseClaudeJsonl } from "./usage.js";
import { grade } from "./grader.js";

const BENCH_ROOT = resolve(import.meta.dirname, "..");
const RESULTS_DIR = join(BENCH_ROOT, "results");
const FIXTURE_DIR = join(BENCH_ROOT, "fixtures", "demo");

/** Project ref of the throwaway cloud project all conditions target (set via env). */
export const PROJECT_REF = process.env.BENCH_PROJECT_REF ?? "";

const AGENT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Verify cloud auth + project reachability before a run. Requires
 * SUPABASE_ACCESS_TOKEN in the environment.
 */
export function ensureProjectReachable(): void {
  if (!process.env.SUPABASE_ACCESS_TOKEN) {
    throw new Error(
      "SUPABASE_ACCESS_TOKEN is not set. Export it in the shell before running " +
        "the matrix so it propagates to the agent and MCP subprocesses.",
    );
  }
  if (!PROJECT_REF) {
    throw new Error("BENCH_PROJECT_REF is not set. Export the throwaway project's ref.");
  }
  console.log(`  Verifying cloud project ${PROJECT_REF} is reachable...`);
  execSync(`supabase projects list`, { stdio: "pipe" });
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
  const preamble = condition.agents_md.replaceAll("<PROJECT_REF>", PROJECT_REF).trim();
  return `${preamble}\n\n---\n\nTASK:\n${task.prompt.trim()}`;
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
  // This is what keeps the `mcp` condition genuinely shell-free.
  if (condition.disallowed_tools && condition.disallowed_tools.length > 0) {
    args.push("--disallowedTools", ...condition.disallowed_tools);
  }

  // MCP condition: register the official Supabase MCP server as a read-only
  // stdio subprocess. It inherits SUPABASE_ACCESS_TOKEN from this process's
  // environment (never written to disk).
  //
  // Account mode (no --project-ref) is used so the project-management tools
  // (list_projects, get_project, …) are available alongside the project-level
  // tools — the agent passes the project ref from its preamble. Writes are
  // blocked two ways: --read-only on the server AND the condition's
  // disallowed_tools denylist (which holds even under --dangerously-skip-permissions).
  if (condition.use_mcp) {
    const mcpConfig = {
      mcpServers: {
        supabase: {
          command: "npx",
          args: ["-y", "@supabase/mcp-server-supabase@latest", "--read-only"],
        },
      },
    };
    const mcpConfigPath = join(artifactDir, ".mcp-config.json");
    writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig));
    args.push("--mcp-config", mcpConfigPath);
  }

  // The agent inherits the environment. `supabase` and the globally-installed
  // `supabase-axi` resolve via the existing PATH; SUPABASE_ACCESS_TOKEN is
  // intentionally left in the environment so the agent (cli/axi) and the MCP
  // subprocess can reach the cloud project.
  const env = { ...process.env };

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
  return { agentOutput, wallClockSeconds: (Date.now() - startTime) / 1000 };
}
