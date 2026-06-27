import { type Obj } from "../format.js";
import { supaJson } from "../supa.js";

export const STATUS_HELP = `usage: supabase-axi status

Show the status of the local Supabase stack (API URL, DB URL, Studio, and the
local anon/service keys). Requires the local stack to be running (\`start\`).

examples:
  supabase-axi status
`;

export async function statusCommand() {
  const services = (await supaJson<Obj>(["status"])) ?? {};
  const keys = Object.keys(services);
  return {
    running: keys.length > 0,
    services,
    help: [
      keys.length === 0
        ? "Run `supabase-axi start` to bring the local stack up"
        : "Run `supabase-axi stop` to shut the local stack down",
    ],
  };
}
