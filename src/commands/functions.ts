import { parseArgs } from "../args.js";
import { usage } from "../errors.js";
import { asArray, preview, shortDate, type Obj } from "../format.js";
import { supaJson, supaText } from "../supa.js";

export const FUNCTIONS_HELP = `usage: supabase-axi functions <list|new|deploy|delete|download> [name] [flags]

subcommands:
  list                     List deployed Edge Functions (slug, status, version).
  new <name>               Scaffold a new function locally under supabase/functions.
  deploy [name]            Deploy one function, or all when no name is given.
  delete <name>            Delete a deployed function.
  download <name>          Download a deployed function's source.

Flags after the name are forwarded verbatim (e.g. \`deploy api --no-verify-jwt\`,
\`deploy --project-ref <ref>\`).

examples:
  supabase-axi functions list
  supabase-axi functions new hello-world
  supabase-axi functions deploy hello-world
  supabase-axi functions delete hello-world
`;

export async function functionsCommand(args: string[]) {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case "list":
    case "ls":
      return functionsList();
    case "new":
      return mutate("new", rest, "Created", [
        "Edit the function under supabase/functions, then `supabase-axi functions deploy <name>`",
      ]);
    case "deploy":
      return deploy(rest);
    case "delete":
      return mutate("delete", rest, "Deleted", [
        "Run `supabase-axi functions list` to confirm",
      ]);
    case "download":
      return mutate("download", rest, "Downloaded", [
        "The source is now under supabase/functions",
      ]);
    default:
      throw usage(
        sub
          ? `Unknown functions subcommand "${sub}"`
          : "Missing functions subcommand",
        "Run `supabase-axi functions list` to see deployed functions",
        "Run `supabase-axi functions new <name>` to scaffold one",
      );
  }
}

async function functionsList() {
  const fns = asArray<Obj>(await supaJson<Obj[]>(["functions", "list"])).map(
    (f) => ({
      slug: f.slug ?? f.name,
      status: f.status,
      version: f.version,
      updated: shortDate(f.updated_at),
    }),
  );

  if (fns.length === 0) {
    return {
      functions: [],
      result: "no Edge Functions deployed",
      help: ["Run `supabase-axi functions new <name>` to scaffold one"],
    };
  }
  return {
    functions: fns,
    count: fns.length,
    help: ["Run `supabase-axi functions deploy <name>` to redeploy one"],
  };
}

async function deploy(rest: string[]) {
  const out = await supaText(["functions", "deploy", ...rest]);
  const named = parseArgs(rest).positionals[0];
  return {
    deployed: named ?? "all functions",
    output: preview(out).text,
    help: ["Run `supabase-axi functions list` to confirm the new version"],
  };
}

async function mutate(
  sub: string,
  rest: string[],
  verb: string,
  help: string[],
) {
  const name = parseArgs(rest).positionals[0];
  if (!name) {
    throw usage(
      `functions ${sub} needs a function name`,
      `Run \`supabase-axi functions ${sub} <name>\``,
    );
  }
  const out = await supaText(["functions", sub, ...rest]);
  return { [verb.toLowerCase()]: name, output: preview(out).text, help };
}
