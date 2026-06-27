<h1 align="center">supabase-axi</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/supabase-axi"><img alt="npm" src="https://img.shields.io/npm/v/supabase-axi?style=flat-square" /></a>
  <a href="https://github.com/maximebrmd/supabase-axi/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/maximebrmd/supabase-axi/ci.yml?style=flat-square&label=ci" /></a>
  <a href="https://github.com/maximebrmd/supabase-axi/actions/workflows/release-please.yml"><img alt="Release" src="https://img.shields.io/github/actions/workflow/status/maximebrmd/supabase-axi/release-please.yml?style=flat-square&label=release" /></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue?style=flat-square" />
  <a href="https://opensource.org/licenses/MIT"><img alt="License" src="https://img.shields.io/badge/license-MIT-green?style=flat-square" /></a>
</p>

Supabase CLI for agents — designed with [AXI](https://github.com/kunchenguid/axi) (Agent eXperience Interface).

Wraps the official [Supabase CLI (`supabase`)](https://supabase.com/docs/guides/local-development/cli/getting-started) with token-efficient [TOON](https://toonformat.dev/) output, contextual next-step suggestions, and structured error handling. `supabase` handles authentication and the heavy lifting; supabase-axi makes its output ergonomic for autonomous agents driving Supabase via shell execution. Anything the CLI can't express is reachable through the Supabase **Management API** with the `api` command.

## Quick Start

**1. Install and log in to the Supabase CLI** (Node 20+ also required):

```sh
brew install supabase/tap/supabase   # or see the docs for other platforms
supabase login                        # opens a browser; the token is stored locally
```

`supabase login` acts as you — it can already reach every project your account can.

**2. Install the supabase-axi skill** in the [Agent Skills](https://agentskills.io) format with [`npx skills`](https://github.com/vercel-labs/skills):

```sh
npx skills add maximebrmd/supabase-axi --skill supabase-axi -g
```

That is the entire supabase-axi setup — no global install needed. The skill teaches your agent to run supabase-axi through `npx -y supabase-axi`, which shells out to `supabase` under the hood.

`-g` installs the skill for all projects (`~/.claude/skills/`); drop it to install for the current project only (`.claude/skills/`).

## Other Ways to Install

The skill is the recommended path, but it is not the only one.

### Zero setup

supabase-axi is an AXI, so any capable agent can run the CLI directly with nothing installed via npm. Once `supabase` is installed and logged in (see above), just tell your agent:

```
Execute `npx -y supabase-axi` to get Supabase tools.
```

### Session hook

Want ambient Supabase context — your projects, and local migration state when run from a linked directory — fed into every agent session instead of loading on demand? Install the CLI globally and opt into the hook:

```sh
npm install -g supabase-axi
supabase-axi setup hooks
```

This installs a `SessionStart` hook for **Claude Code**, **Codex**, and **OpenCode** that surfaces a compact Supabase overview at the start of each session. **Restart your agent session after running this** so the new hook takes effect.

## Authentication

supabase-axi delegates authentication entirely to the official **Supabase CLI (`supabase`)** — it never handles a token itself.

### `supabase login` — recommended

```sh
brew install supabase/tap/supabase
supabase login
```

`supabase login` opens a browser, authorizes your account, and stores the access token locally. It **acts as you**, so it can reach every project your account can.

### `SUPABASE_ACCESS_TOKEN` — for CI / headless / the Management API

For non-interactive environments — and for the `api` escape hatch, which talks to the Management API directly — export a [personal access token](https://supabase.com/dashboard/account/tokens):

```sh
export SUPABASE_ACCESS_TOKEN=sbp_…
```

> The `api` command has no browser-login fallback: it always reads `SUPABASE_ACCESS_TOKEN`.

## Usage

```bash
supabase-axi                                  # home — your projects (+ local migrations if linked)
supabase-axi projects list                    # all projects (ref, name, region)
supabase-axi projects get <ref>               # API keys + connection info (REST URL)
supabase-axi link --project-ref <ref>         # link this directory to a project
supabase-axi db push --dry-run                # apply local migrations remotely
supabase-axi db diff --schema public          # pending schema changes as SQL
supabase-axi db dump --data-only              # dump the database
supabase-axi migration list                   # local & remote migration status
supabase-axi migration new add_users_table    # scaffold a migration
supabase-axi functions list                   # deployed Edge Functions
supabase-axi functions deploy <name>          # deploy one (or all with no name)
supabase-axi branches list                    # preview branches
supabase-axi secrets set KEY=value            # set Edge Function secrets
supabase-axi gen types --linked               # TypeScript types for the DB
supabase-axi status                           # local stack health (Docker)
supabase-axi api v1/organizations             # raw Management API call
supabase-axi whoami                           # confirm the active identity
```

Run `supabase-axi --help` for the full command list, or `supabase-axi <command> --help` for per-command usage.

## Command reference

| Command                                           | What it does                                                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `(none)` / home                                   | Content-first overview: your projects, plus local migrations when run from a linked directory. |
| `whoami`                                          | Confirm the active identity by listing reachable projects; `AUTH_REQUIRED` when not logged in. |
| `projects <list\|get\|create>`                    | List projects, fetch one's keys + connection info, or create a new cloud project.              |
| `db <push\|pull\|diff\|reset\|dump>`              | Apply/import/diff/rebuild/export the database.                                                 |
| `migration <list\|new\|up\|repair\|squash>`       | Manage migration scripts and history.                                                          |
| `functions <list\|new\|deploy\|delete\|download>` | Manage Edge Functions.                                                                         |
| `branches <list\|create\|get\|delete\|disable>`   | Manage preview branches.                                                                       |
| `secrets <list\|set\|unset>`                      | Manage Edge Function secrets (values never printed back).                                      |
| `gen types`                                       | Generate TypeScript types (`--local` default, or `--linked` / `--project-id <ref>`).           |
| `link`                                            | Link the current directory to a remote project.                                                |
| `status` / `start` / `stop`                       | Drive the local development stack (Docker required).                                           |
| `api <method> <path> [--body <json>]`             | Call any Supabase Management API endpoint directly.                                            |
| `setup hooks`                                     | Install agent session-start hooks.                                                             |

## AXI design notes

supabase-axi follows the [AXI](https://github.com/kunchenguid/axi) conventions, the same way [`notion-axi`](https://github.com/maximebrmd/notion-axi) and `gh-axi` do:

- **TOON output** — every command returns a plain object that the AXI SDK renders to token-efficient TOON on stdout.
- **Minimal by default** — lists show a few key columns; widen with `--full` or `--fields <a,b>`. Large blobs (`db dump`, `db diff`, `gen types`) are previewed with line/char counts; add `--full` to return the complete output (or pass `-f <file>` to `db dump`/`db diff` to write it straight to a file).
- **Definitive empty states** — an empty list returns an explicit "no … yet" result, not a bare `[]`.
- **Contextual suggestions** — every response ends with a `help:` array of next-step commands.
- **Structured errors** — failures carry a `code` (`SUPABASE_NOT_INSTALLED`, `AUTH_REQUIRED`, `NOT_LINKED`, `DOCKER_REQUIRED`, `OBJECT_NOT_FOUND`, `VALIDATION_ERROR`) and actionable suggestions. Exit codes: `0` success, `1` error, `2` usage.
- **Single boundary** — `src/supa.ts` is the only module that shells out to `supabase` (or hits the Management API), which keeps the command layer pure and the test suite hermetic at 100% coverage.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Pull requests to `main` must be raised through [`no-mistakes`](https://github.com/kunchenguid/no-mistakes).

## License

[MIT](./LICENSE) © Maxime Bourmaud
