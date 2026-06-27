#!/usr/bin/env tsx
/**
 * CLI entry point for the supabase-axi benchmark harness.
 *
 * Commands:
 *   run       — Run a single benchmark (--condition, --task, --repeat, --model)
 *   matrix    — Run all condition × task combinations
 *   report    — Generate summary from results.jsonl
 *
 * Agent backend and judge are both `claude` (no OpenAI key required).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ConditionDef, ConditionId, TaskDef } from "./types.js";
import { runOne, ensureStackUp, stopStack } from "./runner.js";
import { writeReports } from "./reporter.js";

const BENCH_ROOT = resolve(import.meta.dirname, "..");
const CONFIG_DIR = join(BENCH_ROOT, "config");
const DEFAULT_MODEL = "claude-sonnet-4-6";

function loadConditions(): Map<string, ConditionDef> {
  const raw = readFileSync(join(CONFIG_DIR, "conditions.yaml"), "utf-8");
  const doc = parseYaml(raw) as { conditions: Record<string, Omit<ConditionDef, "id">> };
  const map = new Map<string, ConditionDef>();
  for (const [id, def] of Object.entries(doc.conditions)) {
    map.set(id, { ...def, id: id as ConditionId });
  }
  return map;
}

function loadTasks(): Map<string, TaskDef> {
  const raw = readFileSync(join(CONFIG_DIR, "tasks.yaml"), "utf-8");
  const doc = parseYaml(raw) as { tasks: Record<string, Omit<TaskDef, "id">> };
  const map = new Map<string, TaskDef>();
  for (const [id, def] of Object.entries(doc.tasks)) {
    map.set(id, { ...def, id });
  }
  return map;
}

/** Clear previous results for the given conditions, keeping results from others. */
function clearResults(conditionIds: string[]): void {
  const resultsDir = join(BENCH_ROOT, "results");
  const resultsPath = join(resultsDir, "results.jsonl");
  if (!existsSync(resultsPath)) {
    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(resultsPath, "");
    return;
  }
  try {
    const kept = readFileSync(resultsPath, "utf-8")
      .split("\n")
      .filter((l) => {
        if (!l.trim()) return false;
        const r = JSON.parse(l);
        return !conditionIds.includes(r.condition);
      })
      .join("\n");
    writeFileSync(resultsPath, kept ? kept + "\n" : "");
  } catch {
    writeFileSync(resultsPath, "");
  }
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "true";
      args[key] = val;
      if (val !== "true") i++;
    }
  }
  return args;
}

async function cmdRun(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const conditionId = args.condition;
  const taskId = args.task;
  const repeat = parseInt(args.repeat ?? "1", 10);
  const model = args.model ?? DEFAULT_MODEL;

  if (!conditionId || !taskId) {
    console.error("Usage: bench run --condition <id> --task <id> [--repeat N] [--model M] [--no-stop]");
    process.exit(1);
  }

  const conditions = loadConditions();
  const tasks = loadTasks();

  const condition = conditions.get(conditionId);
  if (!condition) {
    console.error(`Unknown condition: ${conditionId}. Available: ${[...conditions.keys()].join(", ")}`);
    process.exit(1);
  }

  const task = tasks.get(taskId);
  if (!task) {
    console.error(`Unknown task: ${taskId}. Available: ${[...tasks.keys()].join(", ")}`);
    process.exit(1);
  }

  clearResults([conditionId]);
  ensureStackUp();

  try {
    for (let r = 1; r <= repeat; r++) {
      console.log(`\n=== Run ${r}/${repeat}: ${conditionId} × ${taskId} ===\n`);
      const result = runOne({ condition: conditionId as ConditionId, task: taskId, run: r, model, agent: "claude" }, condition, task);
      console.log(`  Success: ${result.grade.task_success}`);
      console.log(`  Turns: ${result.usage.turn_count}, Commands: ${result.usage.command_count}`);
      console.log(`  Input tokens: ${result.usage.input_tokens} (cached: ${result.usage.input_tokens_cached})`);
      console.log(`  Cost: $${result.usage.total_cost_usd.toFixed(4)}`);
      console.log(`  Time: ${result.usage.wall_clock_seconds.toFixed(1)}s`);
    }
  } finally {
    if (args["no-stop"] !== "true") stopStack();
  }
}

async function cmdMatrix(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const repeat = parseInt(args.repeat ?? "1", 10);
  const model = args.model ?? DEFAULT_MODEL;
  const conditionFilter = args.condition;
  const taskFilter = args.task;

  const conditions = loadConditions();
  const tasks = loadTasks();

  const conditionIds = conditionFilter ? conditionFilter.split(",") : [...conditions.keys()];
  const taskIds = taskFilter ? taskFilter.split(",") : [...tasks.keys()];

  clearResults(conditionIds);
  ensureStackUp();

  const total = conditionIds.length * taskIds.length * repeat;

  try {
    for (const condId of conditionIds) {
      const condition = conditions.get(condId);
      if (!condition) {
        console.error(`Skipping unknown condition: ${condId}`);
        continue;
      }

      let condDone = 0;
      const condTotal = taskIds.length * repeat;

      for (const taskId of taskIds) {
        const task = tasks.get(taskId);
        if (!task) {
          console.error(`Skipping unknown task: ${taskId}`);
          continue;
        }

        for (let r = 1; r <= repeat; r++) {
          condDone++;
          console.log(`\n[${condId} ${condDone}/${condTotal}] ${taskId} (run ${r})`);
          const result = runOne(
            { condition: condId as ConditionId, task: taskId, run: r, model, agent: "claude" },
            condition,
            task,
          );
          const status = result.grade.task_success ? "PASS" : "FAIL";
          console.log(`  ${status} | ${result.usage.turn_count} turns | $${result.usage.total_cost_usd.toFixed(4)} | ${result.usage.wall_clock_seconds.toFixed(1)}s`);
        }
      }
    }
  } finally {
    if (args["no-stop"] !== "true") stopStack();
  }

  console.log(`\nMatrix complete: ${total} runs.`);
  writeReports();
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "run":
      return cmdRun(rest);
    case "matrix":
      return cmdMatrix(rest);
    case "report":
      writeReports();
      return;
    default:
      console.log(`supabase-axi-bench — benchmark harness for cli vs axi vs Supabase MCP

All three conditions run against the SAME local Supabase stack (fixtures/demo).
Agent backend and LLM judge are both \`claude\` (no OpenAI key required).

Commands:
  run       Run a single benchmark
              --condition <cli|axi|mcp>
              --task <task_id>
              --repeat <N>   (default: 1)
              --model <M>    (default: ${DEFAULT_MODEL})
              --no-stop      Leave the local stack running afterward

  matrix    Run all condition × task combinations
              --repeat <N>            (default: 1)
              --model <M>             (default: ${DEFAULT_MODEL})
              --condition <id,id,...> (filter conditions)
              --task <id,id,...>      (filter tasks)
              --no-stop               Leave the local stack running afterward

  report    Generate summary from results.jsonl
`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
