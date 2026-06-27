# supabase-axi Benchmark Study: Agent Interface Comparison

## Overview

This study compares three interfaces an AI agent can use to drive **Supabase**,
all hitting the **same local Supabase stack** (a synthetic blog schema — no real
or cloud data). Each task is read-only and graded by an LLM judge.

**Agent**: Claude Sonnet 4.6 (`claude-sonnet-4-6`)
**Judge**: Claude Sonnet 4.6 (`claude-sonnet-4-6`)
**Repeats**: 3 per condition × task
**Total runs**: 90 (3 conditions × 10 tasks × 3 repeats)
**Approx. agent token cost**: ~$5.20 across all 90 runs (LLM-judge calls extra)
**Target**: local `supabase start` stack, fixture `bench/fixtures/demo`

## Conditions

| Condition | Interface | Description |
| --------- | --------- | ----------- |
| `cli` | raw `supabase` CLI | The baseline. Agent runs `supabase …` shell commands (e.g. `supabase db dump --local`, `supabase gen types typescript --local`, `supabase status`). |
| `axi` | `supabase-axi` | The AXI wrapper. Same operations, but token-efficient TOON output, pre-computed summaries, previews, and `help:` hints. Resolved to the locally-built CLI via a `bin/` shim. |
| `mcp` | Supabase MCP server | The **official Supabase MCP server**, served by the local stack at `<api_url>/mcp` (tools: `list_tables`, `execute_sql`, `list_migrations`, `generate_typescript_types`, …). The agent has **no shell access** — it is hard-restricted to MCP tools only. |

All three conditions are driven by identical `claude` flags; the only
differences are the per-condition tool allow/deny lists and (for `mcp`) the
`--mcp-config` pointing at the local server.

### On the MCP condition (note)

The task brief anticipated that the official Supabase MCP server might not target
a local stack and allowed a Postgres-MCP substitute. **It turned out a
substitute was not needed**: a recent `supabase start` exposes the *real*
Supabase MCP server at `http://127.0.0.1:55321/mcp` (serverInfo `supabase`
v0.7.0). We use that — so the `mcp` condition is the genuine Supabase MCP, not a
stand-in, hitting the same local database as the other two conditions.

One honest caveat about scope: the local Supabase MCP exposes database-oriented
tools (`list_tables`, `execute_sql`, `list_migrations`,
`generate_typescript_types`, advisors, logs, docs) but **no tool for Edge
Functions** and no filesystem access. The `list_functions` task is therefore out
of reach for `mcp` by design — see Finding 3.

### Fair-comparison detail

`--dangerously-skip-permissions` (used by the reference harness) bypasses the
tool allowlist, which initially let the `mcp` agent fall back to `Bash`
(`find`/`ls`) to read the `supabase/functions/` directory off disk. That would
have made the MCP condition not actually MCP. We fixed this with an explicit
`--disallowedTools` denylist (respected even under skip-permissions) so the
`mcp` condition is genuinely shell-free. The numbers below are from the
corrected runs.

## Key Results (averages across 30 runs per condition)

| Condition | Success% | Avg Input Tokens | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns |
| --------- | -------- | ---------------- | ----------------- | -------- | ---------- | ------------ | --------- |
| **cli**   | **100%** | **51,317**       | **344**           | **$0.0310** | **$0.93** | **10.7s** | **2** |
| mcp       | 90%      | 56,500           | 670               | $0.0542  | $1.63      | 17.0s        | 4 |
| axi       | 97%      | 127,826          | 693               | $0.0880  | $2.64      | 20.4s        | 6 |

## Findings

### 1. For local schema introspection, the raw `supabase` CLI is the most efficient

On these read-only, database-introspection tasks the raw CLI is the clear
winner on cost (100% success, ~$0.031/task, 2 turns). The reason is structural:
nearly every question ("what columns does `posts` have?", "which tables
reference `authors`?", "is there a `post_comment_count` function?") is answered
by a single terse command — `supabase db dump --local` prints the full DDL,
which the agent greps in one pass. There is little room to improve on a
one-command, low-token path.

### 2. `supabase-axi` adds exploration overhead on raw-DB tasks (the honest result)

`supabase-axi` is the **most expensive** condition here — ~3× the cost and ~2×
the input tokens of the raw CLI (6 turns vs 2). This is not what the `gh-axi`
study found, and the reason is specific to this task family:

- supabase-axi has no direct "run SQL / query the database" command. Faced with
  a schema question, the agent often first reaches for a query-style command
  (`supabase-axi db query …`), finds it doesn't exist, then pivots to
  `db dump`, sometimes re-running with `--full` to defeat the preview, then
  greps. Each detour is an extra turn that re-sends the growing context.
- `list_tables` is the sharpest example: raw cli 2 turns / $0.018, axi 8 turns /
  $0.104. `count_authors` similarly ran 10 turns / $0.143 for axi (and is where
  its single failure occurred — the model read `seed.sql` but missed the 4th
  author).

AXI's design strengths — pre-computed counts, structured status, contextual
`help:` hints — pay off on *list-and-summarize* operations (its `gh-axi`
sibling shines on `list_labels`-style "how many?" tasks). On *raw schema
introspection*, where the underlying CLI already emits a single terse dump,
those features add round-trips instead of removing them. The narrower the gap
the wrapper has to improve, the more its extra structure costs. Reporting this
faithfully matters more than a flattering headline.

### 3. The Supabase MCP is competitive on DB queries but cannot see Edge Functions

`mcp` is clean and cheap on database tasks (3 turns, ~$0.03–0.06) — `execute_sql`
and `list_tables` map directly onto the structural questions. Its only failures
are all three `list_functions` runs: the Supabase MCP exposes no Edge-Functions
tool and the agent has no filesystem access, so it correctly recognizes it
cannot answer (12 turns of `ToolSearch` + `execute_sql` probing
`supabase_functions`/`storage` before conceding). That single out-of-scope task
accounts for the entire 90% vs 100% gap and for `mcp`'s cost outlier
(`list_functions`: 12 turns / $0.120). On the nine in-scope tasks `mcp` is
27/27.

### 4. Tasks where each interface is at its best

- **Single-command structural lookups** (`table_columns`, `find_column`,
  `fk_relationships`, `sql_function`): cli is unbeatable (`db dump` → grep);
  mcp ties on turns via `execute_sql`; axi pays an exploration tax.
- **Generated TypeScript types** (`gen_types_field`): all three succeed; cli
  cheapest, mcp's `generate_typescript_types` tool is a clean one-shot.
- **Migrations** (`latest_migration`): closest of all — axi's `migration list`
  hint surface narrows the gap to 4 turns.
- **Edge Functions** (`list_functions`): a shell/filesystem task — cli and axi
  list `supabase/functions/` trivially; mcp cannot (Finding 3).

### 5. Caching is high across the board (91–97%)

Prompt caching keeps cached-input ratios at 91–97% for every condition, so the
cost differences above are driven by *uncached* input growth (extra turns
re-sending context) and output tokens, not by cache misses.

## Methodology

- A single local Supabase stack (`fixtures/demo`) is started once; all runs hit
  it. The schema is synthetic (blog: authors/posts/comments/tags/post_tags +
  RLS, an index, a SQL function, two edge functions). No real data.
- Each run gets a task prompt prefixed with a condition-specific tool preamble
  (the "AGENTS.md"). Tools are restricted per condition via
  `--allowedTools`/`--disallowedTools`.
- Agent output is captured as `claude` stream-json and parsed for token / turn /
  command / cost metrics (Claude's own reported `total_cost_usd` is used when
  present).
- A separate `claude-sonnet-4-6` judge evaluates the trajectory against the
  task's `grading_hint` and returns `{pass, reason}`.
- All trajectories and grades are archived under each `{condition}/{task}/run{N}/`.

## Files

- `results.jsonl` — Raw results (one JSON object per run)
- `report.md` — Summary tables with per-task breakdowns
- `report.csv` — Full CSV export for analysis
- `{condition}/{task}/run{N}/` — Per-run artifacts:
  - `agent_output.txt` — Raw agent stream-json output
  - `grade.json` — Judge verdict (`{task_success, details}`)
  - `judge_output.txt` / `judge_model.txt` — Judge response and model
