/** Shared interfaces for the supabase-axi benchmark harness. */

export type ConditionId = "cli" | "axi" | "mcp";
export type TaskCategory = "single_step" | "multi_step";
export type AgentBackend = "claude";

export interface GradingSpec {
  /** Optional hint for the judge about what to look for. */
  grading_hint?: string;
}

export interface TaskDef {
  id: string;
  category: TaskCategory;
  prompt: string;
  grading: GradingSpec;
}

export interface ConditionDef {
  id: ConditionId;
  name: string;
  tool: string;
  agents_md: string;
  /** Tools the agent is allowed to use (passed to `claude --allowedTools`). */
  allowed_tools: string[];
  /**
   * Tools hard-blocked for this condition (passed to `claude --disallowedTools`).
   * A denylist is respected even under `--dangerously-skip-permissions`, so it
   * is how the `mcp` condition is kept shell-free (genuinely MCP-only).
   */
  disallowed_tools?: string[];
  /** When true, register the local Supabase MCP server for this condition. */
  use_mcp?: boolean;
}

export interface RunSpec {
  condition: ConditionId;
  task: string;
  run: number;
  model: string;
  agent: AgentBackend;
}

export interface UsageMetrics {
  input_tokens: number;
  input_tokens_cached: number;
  input_tokens_uncached: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_cost_usd: number;
  wall_clock_seconds: number;
  turn_count: number;
  command_count: number;
  error_count: number;
  command_log: string[];
}

export interface GradeResult {
  task_success: boolean;
  details: string;
}

export interface RunResult {
  condition: ConditionId;
  task: string;
  run: number;
  model: string;
  timestamp: string;
  usage: UsageMetrics;
  grade: GradeResult;
  agent_output: string;
}

export interface ConditionSummary {
  condition: ConditionId;
  name: string;
  total_tasks: number;
  success_rate: number;
  avg_input_tokens: number;
  avg_cached_pct: number;
  avg_output_tokens: number;
  avg_cost_usd: number;
  total_cost_usd: number;
  avg_duration_seconds: number;
  avg_turns: number;
}
