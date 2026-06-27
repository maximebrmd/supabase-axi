# supabase-axi benchmark

A reproducible agent benchmark comparing three ways an AI agent can drive
**Supabase's cloud-management surface**, all hitting the **same throwaway
Supabase cloud project**:

| Condition | Interface | How the agent works |
| --------- | --------- | ------------------- |
| `cli` | raw `supabase` CLI | Runs `supabase …` shell commands (baseline). |
| `axi` | `supabase-axi` | Runs the **globally-installed** `supabase-axi` (`npm i -g supabase-axi@1.1.0`) directly — token-efficient TOON output, pre-computed summaries, `help:` hints, and the `db query` SQL command. Installed and invoked exactly like the raw CLI, for a fair comparison (mirrors gh-axi's methodology). |
| `mcp` | Supabase MCP server | Calls the **official Supabase MCP** (`@supabase/mcp-server-supabase`, read-only) spawned as a stdio subprocess. No shell access. |

The agent backend and the LLM judge are both the **`claude` CLI**
(`claude-sonnet-4-6`) — no OpenAI key required. The harness mirrors the
structure of the `bench-github` study (runner / grader / usage / reporter /
cli + YAML configs).

> **Track B.** An earlier iteration of this benchmark targeted a local
> `supabase start` stack on raw schema-introspection tasks, where `supabase db
> dump | grep` is hard to beat and the wrapper showed little benefit. This
> version benchmarks the domain an AXI wrapper is actually designed for — the
> **cloud-management surface** (projects, keys, branches, secrets, edge
> functions, status) plus SQL via the new `db query` command — mirroring how
> the gh-axi benchmark exercised GitHub management.

The published results of a real run live in
[`published-results/`](./published-results/) — start with
[`published-results/report.md`](./published-results/report.md) and
[`published-results/STUDY.md`](./published-results/STUDY.md).

## The target: a throwaway cloud project (synthetic data)

All conditions run against **one disposable free-tier Supabase cloud project**
(`supabase-axi-bench`, region `eu-central-1`). **There is no real, private, or
production data** — the schema and rows are entirely synthetic (a tiny blog
domain), which is why the results are safe to publish in this public repo. The
project is deleted after the run; see
[`published-results/STUDY.md`](./published-results/STUDY.md) for the ref and
recreation steps.

### Demo schema (`fixtures/demo/supabase/`)

The cloud project's database is provisioned from these migrations + seed via
`supabase db push` and the Management API:

- `20250101000000_init_blog_schema.sql`
  - **`authors`** — `id` (bigint PK), `email` (unique), `display_name`, `bio`, `created_at`
  - **`posts`** — `id` (bigint PK), `author_id` → `authors.id`, `title`, `slug` (unique), `body`, `status` (`draft`/`published`/`archived`), `view_count` (integer), `published_at`, `created_at`; index `posts_author_id_idx`
  - **`tags`** — `id` (bigint PK), `name` (unique), `slug` (unique)
  - **`post_tags`** — join table (`post_id` → `posts.id`, `tag_id` → `tags.id`), composite PK
  - **`comments`** — `id` (bigint PK), `post_id` → `posts.id`, `author_id` → `authors.id`, `body`, `created_at`
  - SQL function **`post_comment_count(p_post_id bigint) → integer`**
- `20250101000100_rls_policies.sql` — enables RLS and adds SELECT policies.

Seed: 4 authors, 4 tags, 5 posts, 7 post-tag links, 5 comments — all fictional
(Ada Lovelace, Grace Hopper, Alan Turing, Katherine Johnson). Two edge
functions are deployed: **`hello-world`** and **`post-stats`**.

This known state is what the task `grading_hint`s in
[`config/tasks.yaml`](./config/tasks.yaml) are keyed to.

## Tasks

11 read-only cloud-management tasks (see [`config/tasks.yaml`](./config/tasks.yaml)):
project listing / ref / status+Postgres version / API URL, preview branches,
secret names, edge functions, plus 4 SQL tasks (`list_tables`, count authors,
column types, foreign-key relationships) that exercise `db query` /
`execute_sql`. Nothing writes, deploys, resets, or changes settings.

## Running it

Prerequisites: the `supabase` CLI, the `claude` CLI logged in, and
`SUPABASE_ACCESS_TOKEN` exported (so it propagates to the agent and MCP
subprocesses). The throwaway project must already exist and be linked from
`fixtures/demo/` (see STUDY.md for setup). The `axi` condition uses a
**globally-installed** `supabase-axi` — install it first so the agent can invoke
it directly, on equal footing with the raw CLI:

```sh
npm i -g supabase-axi@1.1.0   # the axi condition invokes `supabase-axi` directly
```

```sh
cd bench
pnpm install            # isolated workspace (its own pnpm-workspace.yaml)
pnpm run build

export SUPABASE_ACCESS_TOKEN=sbp_…           # never committed
export BENCH_PROJECT_REF=<your-project-ref>  # optional; defaults to the run's ref

# single task, one condition
pnpm bench run --condition axi --task list_projects

# the full matrix (3 conditions × 11 tasks × 3 runs)
pnpm bench matrix --repeat 3

# regenerate report.md / report.csv from results/results.jsonl
pnpm bench report
```

Live artifacts are written under `results/` (git-ignored); the committed
snapshot of a real run is in `published-results/`.

## How it works

- **`src/runner.ts`** — per run: composes the prompt (condition tool preamble +
  task), spawns `claude` (stream-json) in the linked fixture dir with the
  condition-appropriate `--allowedTools`/`--disallowedTools` (and, for `mcp`, an
  `--mcp-config` spawning the read-only Supabase MCP server), captures output,
  parses usage, grades, and appends to `results/results.jsonl`. It forwards
  `SUPABASE_ACCESS_TOKEN` from the environment but never reads or persists its
  value.
- **`src/usage.ts`** — parses Claude stream-json into token/turn/command/cost
  metrics.
- **`src/grader.ts`** — LLM-as-judge: formats the trajectory and asks
  `claude-sonnet-4-6` for a `{pass, reason}` verdict against the task's
  `grading_hint`.
- **`src/reporter.ts`** — aggregates `results.jsonl` into `report.md` +
  `report.csv`.
- **`src/cli.ts`** — `run` / `matrix` / `report` commands.

`pnpm test` runs unit tests for the usage parser and the grader (the grader's
`claude` subprocess is mocked — tests never hit the network or the CLI).
