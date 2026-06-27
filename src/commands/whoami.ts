import { asArray, type Obj } from "../format.js";
import { supaJson } from "../supa.js";

export const WHOAMI_HELP = `usage: supabase-axi whoami

Confirm the active Supabase identity by listing the projects the current
credentials can reach. Fails with AUTH_REQUIRED when not logged in.

examples:
  supabase-axi whoami
`;

export async function whoamiCommand() {
  const projects = asArray<Obj>(await supaJson<Obj[]>(["projects", "list"]));
  const tokenSource = process.env.SUPABASE_ACCESS_TOKEN
    ? "SUPABASE_ACCESS_TOKEN env var"
    : "supabase login (stored locally)";

  return {
    authenticated: true,
    token_source: tokenSource,
    projects: projects.length,
    help: [
      "Run `supabase-axi projects list` to see them",
      "Run `supabase-axi projects get <ref>` for keys & connection info",
    ],
  };
}
