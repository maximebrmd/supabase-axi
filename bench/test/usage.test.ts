import { describe, it, expect } from "vitest";
import { parseClaudeJsonl } from "../src/usage.js";

/** Claude stream-json: an assistant message wrapping content blocks. */
const assistantMsg = (blocks: Array<Record<string, unknown>>, usage?: Record<string, number>) =>
  JSON.stringify({
    type: "assistant",
    message: { content: blocks, ...(usage ? { usage } : {}) },
  });

const toolUse = (name: string, input: Record<string, unknown> = {}) => ({
  type: "tool_use",
  name,
  input,
});

const toolResult = (isError = false) =>
  JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", is_error: isError }] },
  });

const resultEvent = (opts: {
  numTurns: number;
  costUsd: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead?: number;
  cacheCreation?: number;
}) =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: opts.numTurns,
    total_cost_usd: opts.costUsd,
    duration_ms: opts.durationMs,
    result: "Final answer",
    usage: {
      input_tokens: opts.inputTokens,
      output_tokens: opts.outputTokens,
      cache_read_input_tokens: opts.cacheRead ?? 0,
      cache_creation_input_tokens: opts.cacheCreation ?? 0,
    },
  });

describe("parseClaudeJsonl", () => {
  it("parses result event with usage", () => {
    const raw = [
      assistantMsg([toolUse("Bash", { command: "supabase status" })]),
      toolResult(),
      resultEvent({
        numTurns: 2,
        costUsd: 0.05,
        durationMs: 5000,
        inputTokens: 3000,
        outputTokens: 500,
        cacheRead: 1000,
      }),
    ].join("\n");

    const result = parseClaudeJsonl(raw);

    expect(result.turn_count).toBe(2);
    // total = input_tokens(3000) + cache_creation(0) + cache_read(1000) = 4000
    expect(result.input_tokens).toBe(4000);
    expect(result.input_tokens_cached).toBe(1000);
    expect(result.input_tokens_uncached).toBe(3000);
    expect(result.output_tokens).toBe(500);
    expect(result.command_count).toBe(1);
    expect(result.error_count).toBe(0);
    expect(result.command_log).toEqual(["supabase status"]);
    expect(result.reasoning_tokens).toBe(0);
  });

  it("counts Bash commands and MCP tool calls", () => {
    const raw = [
      assistantMsg([toolUse("Bash", { command: "supabase db dump --local" })]),
      toolResult(),
      assistantMsg([toolUse("Read", { file_path: "/x" })]),
      toolResult(),
      assistantMsg([toolUse("mcp__supabase__execute_sql", { query: "select 1" })]),
      toolResult(),
      resultEvent({ numTurns: 1, costUsd: 0.01, durationMs: 2000, inputTokens: 1000, outputTokens: 200 }),
    ].join("\n");

    const result = parseClaudeJsonl(raw);
    // Bash + MCP tool count; Read does not.
    expect(result.command_count).toBe(2);
    expect(result.command_log[0]).toBe("supabase db dump --local");
    expect(result.command_log[1]).toContain("mcp__supabase__execute_sql");
  });

  it("counts tool errors", () => {
    const raw = [
      assistantMsg([toolUse("Bash", { command: "supabase migration list" })]),
      toolResult(true),
      resultEvent({ numTurns: 1, costUsd: 0.01, durationMs: 1000, inputTokens: 500, outputTokens: 100 }),
    ].join("\n");

    const result = parseClaudeJsonl(raw);
    expect(result.error_count).toBe(1);
    expect(result.command_count).toBe(1);
  });

  it("returns zeros for empty input", () => {
    const result = parseClaudeJsonl("");
    expect(result.turn_count).toBe(0);
    expect(result.input_tokens).toBe(0);
    expect(result.command_count).toBe(0);
  });

  it("skips malformed JSON lines", () => {
    const raw = [
      "not valid json",
      resultEvent({ numTurns: 1, costUsd: 0.02, durationMs: 1000, inputTokens: 100, outputTokens: 50 }),
      "{broken",
    ].join("\n");

    const result = parseClaudeJsonl(raw);
    expect(result.turn_count).toBe(1);
    expect(result.input_tokens).toBe(100);
  });

  it("uses Claude's reported cost when available", () => {
    const raw = resultEvent({
      numTurns: 1,
      costUsd: 0.05,
      durationMs: 3000,
      inputTokens: 1000,
      outputTokens: 200,
      cacheRead: 400,
    });

    const result = parseClaudeJsonl(raw, { model: "claude-sonnet-4-6" });
    expect(result.total_cost_usd).toBe(0.05);
  });

  it("computes cost from pricing when result cost is missing", () => {
    // Assistant-only usage (no result event) → cost computed from model pricing.
    const raw = assistantMsg(
      [toolUse("Bash", { command: "supabase status" })],
      { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    );

    const result = parseClaudeJsonl(raw, { model: "claude-sonnet-4-6" });
    // sonnet: $3/1M input, $15/1M output → 1000*3e-6 + 200*15e-6
    const expected = 1000 * 3e-6 + 200 * 15e-6;
    expect(result.total_cost_usd).toBeCloseTo(expected, 8);
  });

  it("uses duration from result event when wallClockSeconds not provided", () => {
    const raw = resultEvent({
      numTurns: 1,
      costUsd: 0.01,
      durationMs: 5500,
      inputTokens: 100,
      outputTokens: 50,
    });

    const result = parseClaudeJsonl(raw);
    expect(result.wall_clock_seconds).toBe(5.5);
  });

  it("prefers externally measured wall clock when provided", () => {
    const raw = resultEvent({
      numTurns: 1,
      costUsd: 0.01,
      durationMs: 5500,
      inputTokens: 100,
      outputTokens: 50,
    });

    const result = parseClaudeJsonl(raw, { wallClockSeconds: 12.3 });
    expect(result.wall_clock_seconds).toBe(12.3);
  });
});
