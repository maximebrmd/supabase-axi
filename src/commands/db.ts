import { usage } from "../errors.js";
import { preview, type Obj } from "../format.js";
import { supaText } from "../supa.js";

export const DB_HELP = `usage: supabase-axi db <push|pull|diff|reset|dump> [flags]

subcommands:
  push    Apply local migrations to the linked/remote database.
  pull    Pull the remote schema into a new local migration.
  diff    Diff the database against local migrations (prints the SQL).
  reset   Recreate the LOCAL database from migrations + seed (needs Docker).
  dump    Dump the database schema (or --data-only) to stdout.

Flags after the subcommand are forwarded to the Supabase CLI verbatim, e.g.
\`db push --dry-run\`, \`db diff --schema public\`, \`db dump --data-only\`.

examples:
  supabase-axi db push --dry-run
  supabase-axi db diff --schema public
  supabase-axi db pull
  supabase-axi db dump --data-only
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
  dump: ["Redirect stdout to a file to save the dump"],
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

  const out = await supaText(["db", sub, ...args.slice(1)]);
  const p = preview(out);
  const result: Obj = { db: sub, lines: p.lines, output: p.text };
  if (p.truncated) {
    result.truncated = true;
    result.chars = p.chars;
  }
  if (p.lines === 0) result.output = "(no output — nothing to do)";
  result.help = HINTS[sub];
  return result;
}
