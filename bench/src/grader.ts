/**
 * LLM-as-Judge grading.
 *
 * After the benchmark agent finishes, the grader spawns a separate `claude`
 * call (model `claude-sonnet-4-6`) to evaluate the agent's trajectory and
 * decide whether it completed the task.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import type { GradingSpec, GradeResult } from "./types.js";

const CLAUDE_JUDGE_MODEL = "claude-sonnet-4-6";

/**
 * Format raw JSONL from the agent run into a readable trajectory transcript.
 *
 * Extracts agent text messages, tool calls (Bash commands and MCP tool
 * invocations), and their outputs.
 */
export function formatTrajectory(jsonl: string): string {
  const parts: string[] = [];

  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    // Assistant messages with content blocks (text + tool_use).
    if (entry.type === "assistant") {
      const msg = (entry.message ?? {}) as Record<string, unknown>;
      const content = msg.content as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && typeof block.text === "string") {
            parts.push(`AGENT: ${block.text}`);
            parts.push("");
          }
          if (block.type === "tool_use") {
            const input = (block.input ?? {}) as Record<string, unknown>;
            if (block.name === "Bash" && typeof input.command === "string") {
              parts.push(`COMMAND: ${input.command}`);
            } else {
              parts.push(`TOOL_CALL: ${block.name}(${JSON.stringify(input)})`);
            }
          }
        }
      }
    }

    // Tool results.
    if (entry.type === "user") {
      const msg = (entry.message ?? {}) as Record<string, unknown>;
      const content = msg.content as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_result") {
            if (typeof block.content === "string") {
              parts.push(`OUTPUT: ${block.content}`);
            } else if (Array.isArray(block.content)) {
              // MCP tool results return an array of {type, text} objects.
              const text = (block.content as Array<Record<string, unknown>>)
                .map((c) => (typeof c.text === "string" ? c.text : JSON.stringify(c)))
                .join("\n");
              parts.push(`OUTPUT: ${text}`);
            }
            parts.push("");
          }
        }
      }
    }

    // Result event with the final answer.
    if (entry.type === "result" && typeof entry.result === "string") {
      parts.push(`AGENT: ${entry.result}`);
      parts.push("");
    }
  }

  return parts.join("\n").trim() || "(empty trajectory)";
}

/**
 * Build the grading prompt for the LLM judge.
 */
export function buildGradingPrompt(
  taskPrompt: string,
  trajectory: string,
  gradingHint?: string,
): string {
  const hintSection = gradingHint ? `\nKNOWN FACTS: ${gradingHint}\n` : "";

  return `You are a benchmark grader evaluating whether an AI agent completed a task.

TASK: ${taskPrompt}
${hintSection}
AGENT TRAJECTORY:
${trajectory}

Rules:
- PASS if the agent invoked appropriate tools/commands AND produced a correct, complete answer
- FAIL if the agent hallucinated data without running any tool or command
- FAIL if the agent ran commands but misinterpreted the results
- FAIL if the agent gave a partial answer when a complete one was requested
- If the agent's interface genuinely cannot perform the task (e.g. no tool exists for it) and the agent correctly reports that limitation, that is still a FAIL for task completion (the task was not accomplished)

Respond with exactly: {"pass": true, "reason": "..."} or {"pass": false, "reason": "..."}`;
}

/**
 * Grade the agent's run by invoking a separate `claude` call as judge.
 *
 * @param spec - Grading spec (may contain grading_hint)
 * @param taskPrompt - The original task prompt given to the agent
 * @param rawJsonl - Raw stream-json output from the agent's claude run
 * @param artifactDir - Where to archive the judge's output (optional)
 */
export function grade(
  spec: GradingSpec,
  taskPrompt: string,
  rawJsonl: string,
  artifactDir?: string,
): GradeResult {
  const trajectory = formatTrajectory(rawJsonl);
  const prompt = buildGradingPrompt(taskPrompt, trajectory, spec.grading_hint);

  let judgeOutput: string;
  try {
    judgeOutput = execFileSync(
      "claude",
      [
        "--setting-sources", "",
        "-p", prompt,
        "--model", CLAUDE_JUDGE_MODEL,
        "--output-format", "text",
        "--max-turns", "1",
        "--dangerously-skip-permissions",
        "--no-session-persistence",
      ],
      {
        encoding: "utf-8",
        timeout: 90 * 1000,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string };
    judgeOutput = execErr.stdout ?? "";
    if (!judgeOutput) {
      return {
        task_success: false,
        details: `Judge process failed: ${execErr.stderr ?? "unknown error"}`,
      };
    }
  }

  if (artifactDir) {
    writeFileSync(`${artifactDir}/judge_output.txt`, judgeOutput);
    writeFileSync(`${artifactDir}/judge_model.txt`, CLAUDE_JUDGE_MODEL);
  }

  const verdict = extractVerdict(judgeOutput);
  if (!verdict) {
    return {
      task_success: false,
      details: `Could not parse judge verdict from output: ${judgeOutput.slice(0, 500)}`,
    };
  }

  return {
    task_success: verdict.pass,
    details: verdict.reason,
  };
}

interface JudgeVerdict {
  pass: boolean;
  reason: string;
}

/**
 * Extract {"pass": bool, "reason": "..."} from the judge's output.
 * Handles raw text, markdown-fenced JSON, and JSONL-wrapped responses.
 */
function extractVerdict(output: string): JudgeVerdict | null {
  const stripped = output.replace(/```json\s*/g, "").replace(/```\s*/g, "");

  // Try to parse the stripped output directly as JSON first.
  try {
    const direct = JSON.parse(stripped.trim()) as JudgeVerdict;
    if (typeof direct.pass === "boolean") {
      return { pass: direct.pass, reason: direct.reason ?? "" };
    }
  } catch {
    // fall through
  }

  // Find a JSON object with a "pass" field anywhere in the output.
  const match =
    stripped.match(/\{\s*"pass"\s*:\s*(true|false)\s*,\s*"reason"\s*:\s*".*?"\s*\}/s) ??
    stripped.match(/\{\s*"reason"\s*:\s*".*?"\s*,\s*"pass"\s*:\s*(true|false)\s*\}/s);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as JudgeVerdict;
      if (typeof parsed.pass === "boolean") {
        return { pass: parsed.pass, reason: parsed.reason ?? "" };
      }
    } catch {
      // fall through
    }
  }

  // Try parsing each JSONL line for nested message content with the verdict.
  for (const line of stripped.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      for (const field of ["content", "text", "result"]) {
        if (typeof entry[field] === "string") {
          const nested = extractVerdict(entry[field] as string);
          if (nested) return nested;
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}
