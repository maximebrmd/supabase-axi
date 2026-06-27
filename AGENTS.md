# Agent instructions

Use `supabase-axi` for Supabase: list & inspect projects and their API keys/connection info; push, pull, diff, reset & dump databases; manage migrations, Edge Functions, preview branches, and secrets; generate TypeScript types; link a project; drive the local stack; or call any Management API endpoint with `api`.

- Auth: supabase-axi wraps the official Supabase CLI (`supabase`). Install it (`brew install supabase/tap/supabase`) and run `supabase login` (browser; token stored locally, acts as you). For headless use or the `api` escape hatch, export `SUPABASE_ACCESS_TOKEN`.
- Run `supabase-axi` (no args) for a content-first overview of your projects; `supabase-axi --help` for commands.
- Output is TOON on stdout. Exit codes: 0 success, 1 error, 2 usage. Errors carry a `code` and a `help` list.
- Structured error codes: `SUPABASE_NOT_INSTALLED`, `AUTH_REQUIRED` (run `supabase login`), `NOT_LINKED` (run `supabase-axi link --project-ref <ref>`), `DOCKER_REQUIRED` (local-stack commands need Docker), `OBJECT_NOT_FOUND`, `VALIDATION_ERROR`.
- Lists are minimal by default — pass `--full` or `--fields <list>` to widen. Large blobs (`db dump`, `db diff`, `gen types`) are previewed; add `--full` to return the complete output (or pass `-f <file>` to `db dump`/`db diff` to write it straight to a file).
- `projects create` provisions billable cloud infrastructure; `db reset`/`start`/`stop` act on the local stack.

## Repo conventions for contributors

- Node 20+, TypeScript, ESM-only; `pnpm` for everything.
- `src/supa.ts` is the only module that shells out to `supabase` (or hits the Management API). Commands import from it and return plain objects the SDK renders to TOON. Each command ends with a `help:` array.
- `pnpm test` enforces 100% coverage. Mock `../src/supa.js` in command tests; mock `node:child_process`/`fetch` in `supa.test.ts`. Never call the real CLI/network in tests.
- `skills/supabase-axi/SKILL.md` is generated from `src/skill.ts` — run `pnpm run build:skill` and commit; never hand-edit it. Likewise never hand-edit `CHANGELOG.md` or `.release-please-manifest.json`.
- Before pushing: `pnpm run build && pnpm run build:skill && pnpm run lint && pnpm test`.
