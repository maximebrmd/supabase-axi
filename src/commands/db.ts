import { parseArgs, strFlag } from "../args.js";
import { usage } from "../errors.js";
import { asArray, preview, type Obj } from "../format.js";
import { linkedProjectRef, mgmtApi, notLinkedError, supaText } from "../supa.js";

export const DB_HELP = `usage: supabase-axi db <push|pull|diff|reset|dump> [flags] [--full]
       supabase-axi db query "<sql>" [--project-ref <ref>] [--limit <n>] [--full]

subcommands:
  push    Apply local migrations to the linked/remote database.
  pull    Pull the remote schema into a new local migration.
  diff    Diff the database against local migrations (prints the SQL).
  reset   Recreate the LOCAL database from migrations + seed (needs Docker).
  dump    Dump the database schema (or --data-only) to stdout.
  query   Run a SQL statement against the linked project and return the rows.

Flags after push/pull/diff/reset/dump are forwarded to the Supabase CLI
verbatim, e.g. \`db push --dry-run\`, \`db diff --schema public\`, \`db dump
--data-only\`. Blob output (diff/dump) is previewed; add --full to return the
complete output, or pass -f <file> to write it straight to a file.

\`db query\` runs arbitrary SQL through the Management API (like the Supabase
MCP's execute_sql); it needs a linked project (or --project-ref) and reads the
access token from \`supabase login\` / SUPABASE_ACCESS_TOKEN. Rows are capped by
default — add --full for every row, or --limit <n> to cap explicitly.

examples:
  supabase-axi db push --dry-run
  supabase-axi db diff --schema public
  supabase-axi db dump --data-only --full
  supabase-axi db pull
  supabase-axi db query "select id, email from auth.users limit 5"
  supabase-axi db query "select count(*) from public.todos" --project-ref abcd
`;

// Rows shown by default when neither --full nor --limit is given.
const DEFAULT_ROW_CAP = 50;

const QUERY_HINTS = [
  "This runs raw SQL — persist schema changes as migrations (`supabase-axi migration new <name>`)",
];

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
 * Execute arbitrary SQL against the project's database via the Management API
 * (`POST /v1/projects/{ref}/database/query`) and return the rows as a TOON
 * table. Faithful to the Supabase MCP's execute_sql: the SQL runs as-is.
 */
async function dbQuery(args: string[]) {
  const { positionals, flags } = parseArgs(args, ["full"]);
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
  const limit = parseLimit(flags.limit);

  const rows = asArray<Obj>(
    await mgmtApi(`v1/projects/${ref}/database/query`, {
      method: "post",
      body: { query: sql },
    }),
  );
  const total = rows.length;

  if (total === 0) {
    return { db: "query", ref, rows: 0, result: "0 rows", help: QUERY_HINTS };
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
      ...QUERY_HINTS,
    ];
  } else {
    result.help = QUERY_HINTS;
  }
  return result;
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
