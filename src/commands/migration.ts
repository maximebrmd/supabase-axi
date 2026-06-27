import { parseArgs } from "../args.js";
import { usage } from "../errors.js";
import { asArray, preview, type Obj } from "../format.js";
import { supaJson, supaText } from "../supa.js";

export const MIGRATION_HELP = `usage: supabase-axi migration <list|new|up|repair|squash> [args] [flags]

subcommands:
  list
      List local and remote migration versions and their applied status.

  new <name>
      Create a new, empty timestamped migration file under supabase/migrations.

  up
      Apply pending local migrations to the local database.

  repair <version> --status <applied|reverted>
      Mark a migration as applied or reverted in the remote history table.

  squash
      Squash all local migrations into a single base migration.

examples:
  supabase-axi migration list
  supabase-axi migration new add_users_table
  supabase-axi migration repair 20240101000000 --status applied
`;

export async function migrationCommand(args: string[]) {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case "list":
    case "ls":
      return migrationList();
    case "new":
      return migrationNew(rest);
    case "up":
      return passthrough("up", rest, [
        "Run `supabase-axi migration list` to confirm",
      ]);
    case "repair":
      if (rest.length === 0) {
        throw usage(
          "migration repair needs a version",
          "Run `supabase-axi migration repair <version> --status applied`",
        );
      }
      return passthrough("repair", rest, [
        "Run `supabase-axi migration list` to confirm the new status",
      ]);
    case "squash":
      return passthrough("squash", rest, [
        "Review the squashed base migration before pushing",
      ]);
    default:
      throw usage(
        sub
          ? `Unknown migration subcommand "${sub}"`
          : "Missing migration subcommand",
        "Run `supabase-axi migration list` to see migrations",
        "Run `supabase-axi migration new <name>` to create one",
      );
  }
}

async function migrationList() {
  const migrations = asArray<Obj>(
    await supaJson<Obj[]>(["migration", "list"]),
  ).map((m) => ({
    version: m.version ?? m.name,
    name: m.name,
    applied: m.applied ?? m.status ?? undefined,
  }));

  if (migrations.length === 0) {
    return {
      migrations: [],
      result: "no migrations found",
      help: ["Run `supabase-axi migration new <name>` to create one"],
    };
  }
  return {
    migrations,
    count: migrations.length,
    help: [
      "Run `supabase-axi db push` to apply pending migrations remotely",
      "Run `supabase-axi migration up` to apply them locally",
    ],
  };
}

async function migrationNew(args: string[]) {
  const { positionals } = parseArgs(args);
  const name = positionals[0];
  if (!name) {
    throw usage(
      "Missing migration name",
      "Run `supabase-axi migration new <name>`",
    );
  }
  const out = await supaText(["migration", "new", name]);
  return {
    created: name,
    output: preview(out).text,
    help: [
      "Edit the new file under supabase/migrations, then `supabase-axi db push`",
    ],
  };
}

async function passthrough(sub: string, rest: string[], help: string[]) {
  const out = await supaText(["migration", sub, ...rest]);
  const p = preview(out);
  return {
    migration: sub,
    output: p.lines === 0 ? "(no output)" : p.text,
    help,
  };
}
