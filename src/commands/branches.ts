import { parseArgs } from "../args.js";
import { usage } from "../errors.js";
import { asArray, preview, type Obj } from "../format.js";
import { supaJson, supaText } from "../supa.js";

export const BRANCHES_HELP = `usage: supabase-axi branches <list|create|get|delete|disable> [args] [flags]

subcommands:
  list                 List preview branches (id, name, status).
  create <name>        Create a preview branch.
  get <id>             Show one branch's details.
  delete <id>          Delete a preview branch.
  disable              Disable branching for the linked project.

examples:
  supabase-axi branches list
  supabase-axi branches create staging
  supabase-axi branches get <branch_id>
  supabase-axi branches delete <branch_id>
`;

export async function branchesCommand(args: string[]) {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case "list":
    case "ls":
      return branchesList();
    case "get":
      return branchesGet(rest);
    case "create":
      return needsId("create", rest, "Created", [
        "Run `supabase-axi branches list` to see it",
      ]);
    case "delete":
      return needsId("delete", rest, "Deleted", [
        "Run `supabase-axi branches list` to confirm",
      ]);
    case "disable":
      return disable(rest);
    default:
      throw usage(
        sub
          ? `Unknown branches subcommand "${sub}"`
          : "Missing branches subcommand",
        "Run `supabase-axi branches list` to see branches",
        "Run `supabase-axi branches create <name>` to create one",
      );
  }
}

function shape(b: Obj) {
  return { id: b.id ?? b.ref, name: b.name, status: b.status };
}

async function branchesList() {
  const branches = asArray<Obj>(
    await supaJson<Obj[]>(["branches", "list"]),
  ).map(shape);
  if (branches.length === 0) {
    return {
      branches: [],
      result: "no preview branches",
      help: ["Run `supabase-axi branches create <name>` to create one"],
    };
  }
  return {
    branches,
    count: branches.length,
    help: ["Run `supabase-axi branches get <id>` for details"],
  };
}

async function branchesGet(rest: string[]) {
  const id = parseArgs(rest).positionals[0];
  if (!id) {
    throw usage("Missing branch id", "Run `supabase-axi branches get <id>`");
  }
  const branch = (await supaJson<Obj>(["branches", "get", id])) ?? {};
  return {
    branch: { ...shape(branch), project_ref: branch.project_ref },
    help: ["Run `supabase-axi branches delete <id>` to remove it"],
  };
}

async function needsId(
  sub: string,
  rest: string[],
  verb: string,
  help: string[],
) {
  const id = parseArgs(rest).positionals[0];
  if (!id) {
    throw usage(
      `branches ${sub} needs a ${sub === "create" ? "name" : "branch id"}`,
      `Run \`supabase-axi branches ${sub} <${sub === "create" ? "name" : "id"}>\``,
    );
  }
  const out = await supaText(["branches", sub, ...rest]);
  return { [verb.toLowerCase()]: id, output: preview(out).text, help };
}

async function disable(rest: string[]) {
  const out = await supaText(["branches", "disable", ...rest]);
  return {
    disabled: true,
    output: preview(out).text || "(no output)",
    help: ["Branching is now off for the linked project"],
  };
}
