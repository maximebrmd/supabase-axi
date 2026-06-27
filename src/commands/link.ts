import { parseArgs, strFlag } from "../args.js";
import { usage } from "../errors.js";
import { preview } from "../format.js";
import { supaText } from "../supa.js";

export const LINK_HELP = `usage: supabase-axi link --project-ref <ref> [--password <db_password>]

Link the current directory to a remote Supabase project so db/migration/functions
commands target it. The ref is the project id from \`supabase-axi projects list\`.

examples:
  supabase-axi link --project-ref abcdefghijklmnop
`;

export async function linkCommand(args: string[]) {
  const { flags } = parseArgs(args);
  const ref = strFlag(flags["project-ref"]);
  if (!ref) {
    throw usage(
      "Missing --project-ref",
      "Run `supabase-axi link --project-ref <ref>`",
      "Find the ref with `supabase-axi projects list`",
    );
  }
  const password = strFlag(flags.password);
  const out = await supaText([
    "link",
    "--project-ref",
    ref,
    ...(password ? ["--password", password] : []),
  ]);
  return {
    linked: ref,
    output: preview(out).text || "(linked)",
    help: [
      "Run `supabase-axi db pull` to import the remote schema",
      "Run `supabase-axi status` to check the local stack",
    ],
  };
}
