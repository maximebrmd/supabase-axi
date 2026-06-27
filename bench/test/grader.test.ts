import { describe, it, expect, vi } from "vitest";
import { formatTrajectory, buildGradingPrompt, grade } from "../src/grader.js";
import * as child_process from "node:child_process";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(child_process.execFileSync);

describe("formatTrajectory", () => {
  it("extracts Bash commands and tool results", () => {
    const jsonl = [
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Bash", input: { command: "supabase status" } }] },
      }),
      JSON.stringify({
        type: "user",
        message: { content: [{ type: "tool_result", content: "API_URL: http://127.0.0.1:55321" }] },
      }),
    ].join("\n");

    const result = formatTrajectory(jsonl);
    expect(result).toContain("COMMAND: supabase status");
    expect(result).toContain("OUTPUT: API_URL: http://127.0.0.1:55321");
  });

  it("extracts MCP tool calls and array-form results", () => {
    const jsonl = [
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "mcp__supabase__list_tables", input: { schemas: ["public"] } }] },
      }),
      JSON.stringify({
        type: "user",
        message: { content: [{ type: "tool_result", content: [{ type: "text", text: "authors, posts" }] }] },
      }),
    ].join("\n");

    const result = formatTrajectory(jsonl);
    expect(result).toContain("TOOL_CALL: mcp__supabase__list_tables");
    expect(result).toContain("OUTPUT: authors, posts");
  });

  it("extracts the final answer from the result event", () => {
    const jsonl = JSON.stringify({ type: "result", result: "There are 5 tables." });
    const result = formatTrajectory(jsonl);
    expect(result).toContain("AGENT: There are 5 tables.");
  });

  it("returns placeholder for empty input", () => {
    expect(formatTrajectory("")).toBe("(empty trajectory)");
    expect(formatTrajectory("\n\n")).toBe("(empty trajectory)");
  });

  it("skips malformed JSON lines", () => {
    const jsonl = [
      "not json",
      JSON.stringify({ type: "result", result: "Valid line." }),
    ].join("\n");

    const result = formatTrajectory(jsonl);
    expect(result).toContain("AGENT: Valid line.");
    expect(result).not.toContain("not json");
  });
});

describe("buildGradingPrompt", () => {
  it("includes task prompt and trajectory", () => {
    const prompt = buildGradingPrompt("List tables", "COMMAND: supabase db dump\nOUTPUT: ...");
    expect(prompt).toContain("TASK: List tables");
    expect(prompt).toContain("COMMAND: supabase db dump");
    expect(prompt).toContain("Rules:");
  });

  it("includes grading hint when provided", () => {
    const prompt = buildGradingPrompt("Count authors", "AGENT: 4", "There are 4 authors.");
    expect(prompt).toContain("KNOWN FACTS: There are 4 authors.");
  });

  it("omits KNOWN FACTS section when no hint", () => {
    const prompt = buildGradingPrompt("List tables", "AGENT: done");
    expect(prompt).not.toContain("KNOWN FACTS");
  });
});

describe("grade", () => {
  it("returns pass when judge says pass", () => {
    mockedExecFileSync.mockReturnValue(
      JSON.stringify({ pass: true, reason: "Agent ran correct commands and reported accurately." }),
    );

    const result = grade({}, "List tables", '{"type":"result","result":"5 tables"}');
    expect(result.task_success).toBe(true);
    expect(result.details).toContain("reported accurately");
  });

  it("returns fail when judge says fail", () => {
    mockedExecFileSync.mockReturnValue(
      JSON.stringify({ pass: false, reason: "Agent hallucinated without running tools." }),
    );

    const result = grade({}, "List tables", "");
    expect(result.task_success).toBe(false);
    expect(result.details).toContain("hallucinated");
  });

  it("extracts verdict from markdown-fenced JSON", () => {
    mockedExecFileSync.mockReturnValue('```json\n{"pass": true, "reason": "Correct."}\n```');

    const result = grade({}, "List tables", "");
    expect(result.task_success).toBe(true);
    expect(result.details).toBe("Correct.");
  });

  it("handles judge process failure", () => {
    mockedExecFileSync.mockImplementation(() => {
      const err = new Error("process failed") as Error & { stdout: string; stderr: string };
      err.stdout = "";
      err.stderr = "timeout";
      throw err;
    });

    const result = grade({}, "List tables", "");
    expect(result.task_success).toBe(false);
    expect(result.details).toContain("Judge process failed");
  });

  it("handles unparseable judge output", () => {
    mockedExecFileSync.mockReturnValue("I don't know what to say");

    const result = grade({}, "List tables", "");
    expect(result.task_success).toBe(false);
    expect(result.details).toContain("Could not parse judge verdict");
  });

  it("extracts verdict when reason contains curly braces", () => {
    mockedExecFileSync.mockReturnValue(
      JSON.stringify({ pass: true, reason: "Returned {number} which is correct." }),
    );

    const result = grade({}, "Gen types", "");
    expect(result.task_success).toBe(true);
    expect(result.details).toContain("{number}");
  });

  it("passes grading_hint through to the prompt", () => {
    mockedExecFileSync.mockReturnValue(JSON.stringify({ pass: true, reason: "ok" }));

    grade({ grading_hint: "There are 4 authors." }, "Count authors", "");

    const lastCallArgs = mockedExecFileSync.mock.calls.at(-1)![1] as string[];
    const promptArg = lastCallArgs[lastCallArgs.indexOf("-p") + 1];
    expect(promptArg).toContain("Count authors");
    expect(promptArg).toContain("There are 4 authors.");
  });
});
