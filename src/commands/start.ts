import { preview } from "../format.js";
import { supaText } from "../supa.js";

export const START_HELP = `usage: supabase-axi start [flags]

Start the local Supabase stack (Postgres, Auth, Storage, Studio, …) via Docker.
Flags are forwarded verbatim (e.g. \`start --exclude imgproxy\`).

examples:
  supabase-axi start
`;

export async function startCommand(args: string[]) {
  const out = await supaText(["start", ...args]);
  return {
    started: true,
    output: preview(out).text || "(local stack started)",
    help: [
      "Run `supabase-axi status` for service URLs and keys",
      "Run `supabase-axi stop` to shut it down",
    ],
  };
}
