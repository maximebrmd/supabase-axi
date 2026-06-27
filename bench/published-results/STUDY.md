# supabase-axi Benchmark Study: Cloud-Management Interface Comparison

## Overview

This study compares three interfaces an AI agent can use to drive **Supabase's
cloud-management surface**, all hitting the **same throwaway Supabase cloud
project** (synthetic data only). Each task is read-only and graded by an LLM
judge.

**Agent**: Claude Sonnet 4.6 (`claude-sonnet-4-6`)
**Judge**: Claude Sonnet 4.6 (`claude-sonnet-4-6`)
**Repeats**: 3 per condition × task
**Total runs**: 99 (3 conditions × 11 tasks × 3 repeats)
**Approx. agent token cost**: ~$5.16 across all 99 runs (LLM-judge calls extra)
**Target**: throwaway free-tier cloud project `supabase-axi-bench`, region
`eu-central-1` (deleted after the run)

> **Why this exists (Track B).** An earlier run of this benchmark targeted a
> local `supabase start` stack on raw schema-introspection tasks. The honest
> result there was that the bare `supabase db dump | grep` path is hard to beat,
> so the wrapper showed little benefit — a reflection of the *task selection*,
> not the tool. This version benchmarks the domain an AXI wrapper is designed
> for: the **cloud-management surface** (projects, keys, branches, secrets, edge
> functions, status) plus SQL via the `db query` command (shipped in
> supabase-axi v1.1.0), mirroring how the gh-axi benchmark exercised GitHub
> management.

## Conditions

| Condition | Interface | Description |
| --------- | --------- | ----------- |
| `cli` | raw `supabase` CLI | The baseline. Agent runs `supabase …` shell commands against the linked cloud project. |
| `axi` | `supabase-axi` | `supabase-axi@1.1.0`, **installed globally** (`npm i -g`) and invoked **directly** (`supabase-axi …`) — on exactly equal footing with the raw CLI, matching gh-axi's methodology and real-world usage. Provides token-efficient TOON output, pre-computed summaries, `help:` hints, and the `db query` SQL command. |
| `mcp` | Supabase MCP server | The **official** `@supabase/mcp-server-supabase` (read-only), spawned as a stdio subprocess. The agent has **no shell access** — it is hard-restricted to MCP tools only. |

All three are driven by identical `claude` flags; the only differences are the
per-condition tool allow/deny lists and (for `mcp`) the `--mcp-config`. The `cli`
and `axi` binaries are both installed system-wide and invoked the same way, so
neither pays an invocation penalty the other avoids.

### Notes on the MCP condition

- **Account mode (no `--project-ref`).** The server is run in account mode so the
  project-management tools (`list_projects`, `get_project`,
  `list_organizations`, …) are available alongside the project-level tools
  (`execute_sql`, `list_tables`, `list_edge_functions`, …). Project-level tools
  take a `project_id` argument, which the agent supplies from its preamble.
- **Writes/cost hard-blocked.** Account mode also exposes mutating/cost tools
  (`create_project`, `confirm_cost`, `deploy_edge_function`, `apply_migration`,
  branch mutations). These are blocked two ways: `--read-only` on the server,
  **and** a `claude --disallowedTools` denylist (which holds even under
  `--dangerously-skip-permissions`). The agent could never mutate a project or
  incur cost.
- **No secrets tool.** The MCP server exposes no "list secrets / function env
  vars" tool, so the `list_secrets` task is out of reach for `mcp` by design.

### Fair-comparison details

- `--dangerously-skip-permissions` bypasses the tool *allowlist*, so the `mcp`
  condition is kept genuinely shell-free with an explicit `--disallowedTools`
  denylist (Bash/Read/Glob/Grep/… plus all write MCP tools). Verified: the `mcp`
  runs use zero Bash calls.
- **Instance note.** The `cli` and `mcp` results were measured against the first
  instance of this throwaway project; the `axi` results were re-measured against
  a freshly recreated instance after switching from `npx` to a global install
  (see below). Both instances were provisioned from the **identical**
  deterministic synthetic schema/seed/functions, so the numbers are directly
  comparable — the only thing that changed for `axi` was how its binary is
  invoked, not the data it queries.

### Security

`SUPABASE_ACCESS_TOKEN` was supplied via the environment and is **never** read,
logged, or persisted by the harness. The throwaway project's API keys
(anon/publishable/service-role JWTs) that agents printed during runs have been
**redacted** from the archived trajectories — cloud resources are referenced
only by project ref. The DB password never appeared in any artifact. The
throwaway project is deleted after the run.

## Key Results (averages across 33 runs per condition)

| Condition | Success% | Avg Input Tokens | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns |
| --------- | -------- | ---------------- | ----------------- | -------- | ---------- | ------------ | --------- |
| **cli**   | **100%** | 56,772           | 380               | $0.0522  | $1.72      | 12.1s        | 3 |
| **axi**   | **100%** | 68,329           | 438               | $0.0527  | $1.74      | 14.0s        | 3 |
| mcp       | 82%      | 50,371           | 544               | $0.0515  | $1.70      | 14.1s        | 3 |

## Findings

### 1. cli and axi both hit 100% at near-identical cost

Both shell conditions complete every task (33/33). Total cost is within ~1%
($1.72 cli vs $1.74 axi). On the cloud-management domain — unlike the local
schema-introspection run, where the raw CLI dominated — the wrapper is fully
competitive on reliability and cost, invoked exactly the same way as the CLI.

### 2. axi wins the SQL / `db query` tasks (where v1.1.0's command lands)

On the four database tasks, `supabase-axi`'s `db query` gives the agent a
one-shot "run SQL, get rows back" path, while the raw CLI has to hand-roll more
(it has no direct cloud-SQL command) and the MCP makes more tool round-trips:

| Task | cli | axi | mcp |
| ---- | --- | --- | --- |
| `list_tables` | 3t / $0.059 | **2t / $0.042** | 3t / $0.049 |
| `query_count_authors` | 3t / $0.059 | **2t / $0.041** | 3t / $0.048 |
| `query_table_columns` | 3t / $0.065 | **2t / $0.045** | 3t / $0.053 |
| `query_fk_relationships` | 3t / $0.065 | **2t / $0.046** | 5t / $0.079 |

axi is ~25–37% cheaper than cli on these. This is exactly the gap the local
study exposed (no query command) and that v1.1.0's `db query` closes. axi is
also cheaper on several list/get tasks (`project_api_url`, `list_edge_functions`,
`list_secrets`).

### 3. axi costs more on project-detail lookups (its honest weak spot)

On the project-metadata lookups, axi takes more turns than cli:

| Task | cli | axi | mcp |
| ---- | --- | --- | --- |
| `list_projects` | 2t / $0.043 | 4t / $0.071 | 3t / $0.049 |
| `project_ref` | 2t / $0.044 | 5t / $0.063 | 3t / $0.046 |
| `project_status` | 2t / $0.037 | 8t / $0.087 | 3t / $0.040 |

The cause is supabase-axi's *minimal-by-default* output: `supabase projects list`
returns one verbose JSON blob with every field (ref, region, status, Postgres
version), so the raw CLI answers in 2 turns, whereas the agent on `supabase-axi`
fetches the trimmed list, then reaches for `projects get`/extra calls to recover
the detail — extra turns. (This is a genuine tool-design tradeoff, now measured
fairly: both binaries are globally installed and invoked directly, so there is no
`npx`/startup penalty involved — an earlier iteration that invoked axi via
`npx -y` was discarded for exactly that reason.) The SQL wins in Finding 2 and
these lookup losses roughly cancel, which is why total cost ends up even.

### 4. MCP is competitive but loses 18 points to two gaps

`mcp` is clean and cheap on most tasks (3 turns, ~$0.05) and ties on the
management lookups. Its 82% comes entirely from two tasks:

- **`list_secrets` (0/3):** the Supabase MCP exposes no secrets/function-env
  tool, and with no shell the agent cannot list them — it correctly explains the
  limitation but cannot complete the task. `cli`/`axi` do it in 2 turns.
- **`project_api_url` (0/3):** the agent retrieves the API URL via
  `get_project_url` but gives an incomplete answer on the key types the task
  asks to enumerate. A presentation/completeness miss rather than a hard tool
  gap.

### 5. Takeaway

On supabase-axi's real domain, measured with a globally-installed binary on equal
footing with the raw CLI, the picture is honest and mixed: **axi matches the raw
CLI on reliability (100%) and total cost, and wins clearly on SQL via `db
query`**, but **costs more on detail-heavy project lookups** because its
minimal-by-default output makes the agent take extra turns to recover fields the
CLI's verbose JSON returns at once. The Supabase MCP is competitive on cost but
capped at 82% by a missing secrets tool and weaker multi-part answers. No
interface dominates; each owns a category.

## Methodology

- One throwaway free-tier cloud project (`supabase-axi-bench`) is provisioned
  with the synthetic blog schema (`supabase db push`) and seeded via the
  Management API; two edge functions are deployed. All runs hit it.
- `supabase-axi` is installed globally (`npm i -g supabase-axi@1.1.0`) so the
  `axi` condition invokes `supabase-axi` directly, exactly as the `cli`
  condition invokes `supabase`.
- Each run gets a task prompt prefixed with a condition-specific tool preamble
  (the "AGENTS.md") carrying the project ref. Tools are restricted per condition
  via `--allowedTools`/`--disallowedTools`.
- Agent output is captured as `claude` stream-json and parsed for token / turn /
  command / cost metrics (Claude's own reported `total_cost_usd` is used when
  present).
- A separate `claude-sonnet-4-6` judge evaluates the trajectory against the
  task's `grading_hint` and returns `{pass, reason}`.
- All trajectories and grades are written (with cloud key material redacted) to a
  gitignored `results/{condition}/{task}/run{N}/` directory; the canonical
  `results.jsonl` carries every reported metric (see [Files](#files)).

## Reproducing the target

```sh
export SUPABASE_ACCESS_TOKEN=sbp_…   # a personal access token; never commit it
ORG=$(supabase orgs list -o json | jq -r '.[0].id')   # your org
npm i -g supabase-axi@1.1.0          # the axi condition uses the global binary

# 1. Create the throwaway free-tier project (eu-central-1)
supabase projects create supabase-axi-bench --org-id "$ORG" \
  --region eu-central-1 --size nano --db-password "<generated>"

# 2. Link bench/fixtures/demo and push the synthetic schema
cd bench/fixtures/demo
supabase link --project-ref <new-ref> --password "<generated>"
supabase db push --password "<generated>"

# 3. Seed (Management API database/query endpoint, seed = supabase/seed.sql) and
#    deploy the two edge functions
supabase functions deploy hello-world --project-ref <new-ref> --no-verify-jwt
supabase functions deploy post-stats  --project-ref <new-ref> --no-verify-jwt

# 4. Run the matrix
cd ../../ && BENCH_PROJECT_REF=<new-ref> pnpm bench matrix --repeat 3
```

Each throwaway project is **deleted after the benchmark**
(`supabase projects delete <ref>`); it exists only for the duration of the study.

## Files

- `results.jsonl` — Raw results (one JSON object per run). **This is the
  canonical record** — every number in `report.md`/`report.csv` and this study is
  derived from it.
- `report.md` — Summary tables with per-task breakdowns
- `report.csv` — Full CSV export for analysis

These four files are the only committed benchmark output. When you run the
matrix locally, the runner also writes raw per-run artifacts to a **gitignored**
`results/{condition}/{task}/run{N}/` directory (`agent_output.txt`,
`grade.json`, `judge_output.txt`, `judge_model.txt`) — useful for spot-checking
a single trajectory, but never committed. Every reported metric is derived from
the canonical `results.jsonl`, so the per-run files are not needed to reproduce
or audit the numbers.
