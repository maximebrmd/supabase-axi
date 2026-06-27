import { parseArgs } from "../args.js";
import { usage } from "../errors.js";
import { preview, type Obj } from "../format.js";
import { supaText } from "../supa.js";

export const DB_HELP = `usage: supabase-axi db <push|pull|diff|reset|dump> [flags] [--full]

subcommands:
  push    Apply local migrations to the linked/remote database.
  pull    Pull the remote schema into a new local migration.
  diff    Diff the database against local migrations (prints the SQL).
  reset   Recreate the LOCAL database from migrations + seed (needs Docker).
  dump    Dump the database schema (or --data-only) to stdout.

Flags after the subcommand are forwarded to the Supabase CLI verbatim, e.g.
\`db push --dry-run\`, \`db diff --schema public\`, \`db dump --data-only\`. Blob
output (diff/dump) is previewed; add --full to return the complete output, or
pass -f <file> to write it straight to a file.

examples:
  supabase-axi db push --dry-run
  supabase-axi db diff --schema public
  supabase-axi db dump --data-only --full
  supabase-axi db pull
`;

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
  if (!sub || !SUBS.has(sub)) {
    throw usage(
      sub ? `Unknown db subcommand "${sub}"` : "Missing db subcommand",
      "Run `supabase-axi db push` to apply local migrations",
      "Run `supabase-axi db diff` to see pending schema changes",
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
