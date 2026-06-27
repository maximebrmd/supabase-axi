import { preview } from "../format.js";
import { supaText } from "../supa.js";

export const STOP_HELP = `usage: supabase-axi stop [flags]

Stop the local Supabase stack. Flags are forwarded verbatim (e.g.
\`stop --no-backup\` to discard local data).

examples:
  supabase-axi stop
  supabase-axi stop --no-backup
`;

export async function stopCommand(args: string[]) {
  const out = await supaText(["stop", ...args]);
  return {
    stopped: true,
    output: preview(out).text || "(local stack stopped)",
    help: ["Run `supabase-axi start` to bring it back up"],
  };
}
