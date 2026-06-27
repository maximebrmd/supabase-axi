# supabase-axi benchmark

A reproducible agent benchmark comparing three ways an AI agent can drive
**Supabase**, all hitting the **same local Supabase stack**:

| Condition | Interface | How the agent works |
| --------- | --------- | ------------------- |
| `cli` | raw `supabase` CLI | Runs `supabase …` shell commands (baseline). |
| `axi` | `supabase-axi` | Runs `supabase-axi …` — token-efficient TOON output, pre-computed summaries, `help:` hints. |
| `mcp` | Supabase MCP server | Calls the **official Supabase MCP** tools served by the local stack at `<api_url>/mcp`. No shell access. |

The agent backend and the LLM judge are both the **`claude` CLI**
(`claude-sonnet-4-6`) — no OpenAI key required. The harness mirrors the
structure of the `bench-github` study (runner / grader / usage / reporter /
cli + YAML configs), adapted from GitHub to Supabase.

The published results of a real run live in
[`published-results/`](./published-results/) — start with
[`published-results/report.md`](./published-results/report.md) and
[`published-results/STUDY.md`](./published-results/STUDY.md).

## The target: a local, synthetic demo stack

Everything runs against a self-contained local stack defined in
[`fixtures/demo/`](./fixtures/demo/). **There is no real, cloud, or private
data** — the schema and rows are entirely synthetic (a tiny blog domain), which
is why the results are safe to publish in this public repo.

### Demo schema (`fixtures/demo/supabase/`)

Migrations (`migrations/`):

- `20250101000000_init_blog_schema.sql`
  - **`authors`** — `id` (bigint PK), `email` (unique), `display_name`, `bio`, `created_at`
  - **`posts`** — `id` (bigint PK), `author_id` → `authors.id`, `title`, `slug` (unique), `body`, `status` (`draft`/`published`/`archived`), `view_count` (integer), `published_at`, `created_at`; index `posts_author_id_idx` on `author_id`
  - **`tags`** — `id` (bigint PK), `name` (unique), `slug` (unique)
  - **`post_tags`** — join table: (`post_id` → `posts.id`, `tag_id` → `tags.id`), composite PK
  - **`comments`** — `id` (bigint PK), `post_id` → `posts.id`, `author_id` → `authors.id`, `body`, `created_at`
  - SQL function **`post_comment_count(p_post_id bigint) → integer`**
- `20250101000100_rls_policies.sql` — enables RLS and adds SELECT policies on
  `posts` (2), `comments` (1), and `authors` (1).

Seed (`seed.sql`): 4 authors, 4 tags, 5 posts, 7 post-tag links, 5 comments —
all fictional (Ada Lovelace, Grace Hopper, Alan Turing, Katherine Johnson).

Edge functions (`functions/`): **`hello-world`** and **`post-stats`**.

This known schema is what the task `grading_hint`s in
[`config/tasks.yaml`](./config/tasks.yaml) are keyed to.

## Tasks

10 read-only tasks (see [`config/tasks.yaml`](./config/tasks.yaml)) covering
schema introspection (list tables, columns, foreign keys, RLS policies, find a
column, a SQL function), data (count seeded authors), migrations, generated
TypeScript types, and edge functions. Nothing writes, resets, or deploys.

## Running it

Prerequisites: Docker running, the `supabase` CLI, and the `claude` CLI logged
in. Build the main `supabase-axi` package first so the `axi` condition resolves
the local build via the `bin/supabase-axi` shim:

```sh
# from the repo root
pnpm install && pnpm run build

# then, in this directory
cd bench
pnpm install            # isolated workspace (its own pnpm-workspace.yaml)
pnpm run build

# single task, one condition (leaves the stack up for inspection)
pnpm bench run --condition axi --task list_tables --no-stop

# the full matrix (3 conditions × 10 tasks × 3 runs)
pnpm bench matrix --repeat 3

# regenerate report.md / report.csv from results/results.jsonl
pnpm bench report
```

The runner brings the local stack up (`supabase start`) before runs and stops
it afterward unless `--no-stop` is passed. Live artifacts are written under
`results/` (git-ignored); the committed snapshot of a real run is in
`published-results/`.

## How it works

- **`src/runner.ts`** — per run: composes the prompt (condition tool preamble +
  task), spawns `claude` (stream-json) in the fixture dir with the
  condition-appropriate `--allowedTools` (and, for `mcp`, an `--mcp-config`
  pointing at the local Supabase MCP), captures output, parses usage, grades,
  and appends to `results/results.jsonl`.
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
