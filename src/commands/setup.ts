import { installSessionStartHooks } from "axi-sdk-js";
import { usage } from "../errors.js";

export const SETUP_HELP = `usage: supabase-axi setup hooks

Install session-start hooks so coding agents (Claude Code, Codex, OpenCode)
load a compact Supabase overview at the start of each session.

examples:
  supabase-axi setup hooks
`;

export async function setupCommand(args: string[]) {
  if (args[0] !== "hooks") {
    throw usage(
      "Unknown setup command",
      "Run `supabase-axi setup hooks` to install agent session-start hooks",
    );
  }

  installSessionStartHooks({
    marker: "supabase-axi",
    binaryNames: ["supabase-axi"],
  });

  return {
    setup: "session-start hooks installed (or already up to date)",
    detail:
      "Claude Code / Codex / OpenCode will now run `supabase-axi` at session start to inject a compact Supabase overview.",
    help: ["Restart your agent session for hooks to take effect"],
  };
}
