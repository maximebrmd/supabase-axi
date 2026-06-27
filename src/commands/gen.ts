import { usage } from "../errors.js";
import { preview, type Obj } from "../format.js";
import { supaText } from "../supa.js";

export const GEN_HELP = `usage: supabase-axi gen types [--local | --linked | --project-id <ref>] [--schema <list>]

Generate TypeScript types for your database. Targets the local stack by default;
pass --linked or --project-id <ref> for a remote database.

examples:
  supabase-axi gen types
  supabase-axi gen types --linked
  supabase-axi gen types --project-id abcd --schema public
`;

export async function genCommand(args: string[]) {
  const sub = args[0];
  if (sub !== "types") {
    throw usage(
      sub ? `Unknown gen subcommand "${sub}"` : "Missing gen subcommand",
      "Run `supabase-axi gen types` to generate TypeScript types",
    );
  }

  let rest = args.slice(1);
  if (rest[0] === "typescript") rest = rest.slice(1);
  const hasTarget = rest.some(
    (a) => a === "--local" || a === "--linked" || a.startsWith("--project-id"),
  );
  if (!hasTarget) rest = ["--local", ...rest];

  const out = await supaText(["gen", "types", "typescript", ...rest]);
  const p = preview(out);
  const result: Obj = {
    gen: "types",
    language: "typescript",
    lines: p.lines,
    types: p.lines === 0 ? "(no types generated)" : p.text,
  };
  if (p.truncated) {
    result.truncated = true;
    result.chars = p.chars;
    result.help = ["Redirect stdout to a file to capture the full output"];
  } else {
    result.help = ["Save these to e.g. src/database.types.ts"];
  }
  return result;
}
