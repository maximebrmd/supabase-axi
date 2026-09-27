import { parseArgs, strFlag } from "../args.js";
import { AxiError, usage } from "../errors.js";
import { asArray, preview, type Obj } from "../format.js";
import {
  linkedProjectRef,
  mgmtApi,
  notLinkedError,
  supaText,
} from "../supa.js";

export const DB_HELP = `usage: supabase-axi db <push|pull|diff|reset|dump> [flags] [--full]
       supabase-axi db query "<sql>" [--project-ref <ref>] [--limit <n>] [--full] [--write]

subcommands:
  push    Apply local migrations to the linked/remote database.
  pull    Pull the remote schema into a new local migration.
  diff    Diff the database against local migrations (prints the SQL).
  reset   Recreate the LOCAL database from migrations + seed (needs Docker).
  dump    Dump the database schema (or --data-only) to stdout.
  query   Run a SQL statement against the linked project and return the rows.
          Read-only by default; pass --write to allow mutations.

Flags after push/pull/diff/reset/dump are forwarded to the Supabase CLI
verbatim, e.g. \`db push --dry-run\`, \`db diff --schema public\`, \`db dump
--data-only\`. Blob output (diff/dump) is previewed; add --full to return the
complete output, or pass -f <file> to write it straight to a file.

\`db query\` runs arbitrary SQL through the Management API (like the Supabase
MCP's execute_sql); it needs a linked project (or --project-ref) and reads the
access token from \`supabase login\` / SUPABASE_ACCESS_TOKEN. By default it uses
the Management API's read-only endpoint, which runs the query as Postgres's
read-only \`supabase_read_only_user\` role: a write fails with a structured
READ_ONLY error whose help points at --write. The read-only endpoint requires
schema-qualified relation references (e.g. \`public.todos\`). \`--write\` sends
the SQL unchanged to the normal read-write endpoint, restoring the previous
behavior. Rows are capped by default — add --full for every row, or --limit <n>
to cap explicitly.

examples:
  supabase-axi db push --dry-run
  supabase-axi db diff --schema public
  supabase-axi db dump --data-only --full
  supabase-axi db pull
  supabase-axi db query "select id, email from auth.users limit 5"
  supabase-axi db query "select count(*) from public.todos" --project-ref abcd
  supabase-axi db query "update public.todos set done = true" --write
`;

// Rows shown by default when neither --full nor --limit is given.
const DEFAULT_ROW_CAP = 50;

const MIGRATION_HINT =
  "Persist schema changes as migrations (`supabase-axi migration new <name>`)";
const READ_ONLY_HINT =
  "Read-only query — re-run with --write to allow mutations";

/** Help hints for a query result, varied by the mode it ran in. */
function queryHints(write: boolean): string[] {
  return write ? [MIGRATION_HINT] : [READ_ONLY_HINT, MIGRATION_HINT];
}

const SUBS = new Set(["push", "pull", "diff", "reset", "dump"]);

const HINTS: Record<string, string[]> = {
  push: ["Run `supabase-axi migration list` to confirm what was applied"],
  pull: ["Run `supabase-axi migration list` to see the new migration"],
  diff: [
    "Capture the diff as a migration: `supabase-axi db diff -f <name>`",
    "Then apply it with `supabase-axi db push`",
  ],
  reset: ["This rebuilt the LOCAL database only — remote is untouched"],
  dump: ["Pass `-f <file>` to write the full dump straight to a file"],
};

export async function dbCommand(args: string[]) {
  const sub = args[0];
  if (sub === "query") return dbQuery(args.slice(1));
  if (!sub || !SUBS.has(sub)) {
    throw usage(
      sub ? `Unknown db subcommand "${sub}"` : "Missing db subcommand",
      "Run `supabase-axi db push` to apply local migrations",
      "Run `supabase-axi db diff` to see pending schema changes",
      'Run `supabase-axi db query "<sql>"` to run SQL and read rows',
      "Run `supabase-axi db dump` to export the schema",
    );
  }

  const rest = args.slice(1);
  const full = parseArgs(rest, ["full"]).flags.full === true;
  const forwarded = rest.filter((a) => a !== "--full");
  const out = await supaText(["db", sub, ...forwarded]);
  const p = preview(out, full ? Infinity : undefined);
  const result: Obj = { db: sub, lines: p.lines, output: p.text };
  if (p.truncated) {
    result.truncated = true;
    result.chars = p.chars;
  }
  if (p.lines === 0) result.output = "(no output — nothing to do)";
  result.help = p.truncated
    ? ["Add --full to return the complete output", ...HINTS[sub]]
    : HINTS[sub];
  return result;
}

/**
 * Failure signatures that mean the read-only database role refused the
 * statement because it writes. Postgres refuses writes inside a read-only
 * transaction (SQLSTATE 25006) or for lack of grants (42501 — the read-only
 * role only holds pg_read_all_data), and the endpoint may also refuse
 * non-SELECT statements before they ever reach Postgres.
 */
const READ_ONLY_REFUSAL_PATTERNS = [
  /read[-\s]?only transaction/i, // Postgres 25006: cannot execute ... in a read-only transaction
  /permission denied/i, // read-only role lacks write privileges (42501)
  /(?:only|just)\s+(?:select|read)/i, // endpoint: only SELECT/read queries are allowed
  /(?:writes?|mutations?|modifications?)\s+(?:are\s+)?(?:not allowed|forbidden|blocked|denied|refused)/i,
];

/**
 * Execute SQL against the project's database via the Management API and return
 * the rows as a TOON table. Read-only by default: the statement is sent to
 * `/database/query/read-only`, which runs it as Postgres's
 * `supabase_read_only_user` role. `--write` restores raw SQL execution on
 * `/database/query`.
 */
async function dbQuery(args: string[]) {
  const { positionals, flags } = parseArgs(args, ["full", "write"]);
  const sql = (positionals[0] ?? "").trim();
  if (!sql) {
    throw usage(
      "Missing SQL to run",
      'Run `supabase-axi db query "select 1"`',
      "Wrap the statement in quotes so the shell passes it as one argument",
    );
  }

  const ref = strFlag(flags["project-ref"]) ?? linkedProjectRef();
  if (!ref) throw notLinkedError();

  const full = flags.full === true;
  const write = flags.write === true;
  const limit = parseLimit(flags.limit);

  // The read-only endpoint is parser-backed, so drop trailing semicolons and
  // whitespace (an empty trailing statement can be rejected); --write keeps
  // today's byte-for-byte SQL.
  const query = write ? sql : stripTrailingSemicolons(sql);
  if (!query) {
    throw usage(
      "Missing SQL to run",
      'Run `supabase-axi db query "select 1"`',
      "Wrap the statement in quotes so the shell passes it as one argument",
    );
  }

  const path = write
    ? `v1/projects/${ref}/database/query`
    : `v1/projects/${ref}/database/query/read-only`;

  let rows: Obj[];
  try {
    rows = asArray<Obj>(
      await mgmtApi(path, { method: "post", body: { query } }),
    );
  } catch (error) {
    if (!write) throw mapReadOnlyError(error);
    throw error;
  }
  const total = rows.length;

  if (total === 0) {
    return {
      db: "query",
      ref,
      rows: 0,
      result: "0 rows",
      help: queryHints(write),
    };
  }

  const cap = limit ?? (full ? Infinity : DEFAULT_ROW_CAP);
  const shown = rows.slice(0, cap);
  const truncated = shown.length < total;

  const result: Obj = { db: "query", ref, rows: total, result: shown };
  if (truncated) {
    result.shown = shown.length;
    result.truncated = true;
    result.help = [
      `Showing ${shown.length} of ${total} rows — add --full for all, or --limit <n>`,
      ...queryHints(write),
    ];
  } else {
    result.help = queryHints(write);
  }
  return result;
}

/** Drop trailing semicolons/whitespace so the read-only parser sees one statement. */
function stripTrailingSemicolons(sql: string): string {
  return sql.replace(/[\s;]+$/, "");
}

/**
 * Turn a read-only query failure that shows the database refused a write into
 * a structured READ_ONLY error pointing at --write; keep every other failure
 * (syntax errors, missing relations, auth) untouched.
 */
function mapReadOnlyError(error: unknown): unknown {
  if (
    error instanceof AxiError &&
    READ_ONLY_REFUSAL_PATTERNS.some((pattern) => pattern.test(error.message))
  ) {
    return new AxiError(
      `Read-only query blocked a write: ${error.message}`,
      "READ_ONLY",
      [
        'Re-run with `--write` if you intend to modify the database: `supabase-axi db query "<sql>" --write`',
        MIGRATION_HINT,
      ],
    );
  }
  return error;
}

/** Parse `--limit <n>` into a positive integer, or undefined when absent. */
function parseLimit(raw: string | boolean | undefined): number | undefined {
  const value = strFlag(raw);
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw usage(
      `Invalid --limit "${value}"`,
      "Pass a positive integer, e.g. --limit 20",
    );
  }
  return n;
}
