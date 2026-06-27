import { parseArgs } from "../args.js";
import { usage } from "../errors.js";
import { asArray, preview, type Obj } from "../format.js";
import { supaJson, supaText } from "../supa.js";

export const SECRETS_HELP = `usage: supabase-axi secrets <list|set|unset> [args] [flags]

subcommands:
  list                       List secret names and their value digests.
  set KEY=value [KEY=value]  Set one or more Edge Function secrets.
  unset KEY [KEY ...]        Remove one or more secrets.

Secret values are never printed back — \`list\` shows a digest only.

examples:
  supabase-axi secrets list
  supabase-axi secrets set STRIPE_KEY=sk_live_123 SENTRY_DSN=https://...
  supabase-axi secrets unset STRIPE_KEY
`;

export async function secretsCommand(args: string[]) {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case "list":
    case "ls":
      return secretsList();
    case "set":
      return secretsSet(rest);
    case "unset":
      return secretsUnset(rest);
    default:
      throw usage(
        sub
          ? `Unknown secrets subcommand "${sub}"`
          : "Missing secrets subcommand",
        "Run `supabase-axi secrets list` to see secrets",
        "Run `supabase-axi secrets set KEY=value` to set one",
      );
  }
}

async function secretsList() {
  const secrets = asArray<Obj>(await supaJson<Obj[]>(["secrets", "list"])).map(
    (s) => ({ name: s.name, digest: s.value }),
  );
  if (secrets.length === 0) {
    return {
      secrets: [],
      result: "no secrets set",
      help: ["Run `supabase-axi secrets set KEY=value` to set one"],
    };
  }
  return {
    secrets,
    count: secrets.length,
    help: ["Run `supabase-axi secrets unset KEY` to remove one"],
  };
}

async function secretsSet(rest: string[]) {
  const { positionals } = parseArgs(rest);
  if (positionals.length === 0) {
    throw usage(
      "secrets set needs at least one KEY=value pair",
      "Run `supabase-axi secrets set KEY=value`",
    );
  }
  const bad = positionals.filter((p) => !p.includes("="));
  if (bad.length) {
    throw usage(
      `Not KEY=value: ${bad.join(", ")}`,
      "Each argument must look like NAME=value",
    );
  }
  const out = await supaText(["secrets", "set", ...rest]);
  return {
    set: positionals.map((p) => p.slice(0, p.indexOf("="))),
    output: preview(out).text || "(no output)",
    help: ["Run `supabase-axi secrets list` to confirm"],
  };
}

async function secretsUnset(rest: string[]) {
  const { positionals } = parseArgs(rest);
  if (positionals.length === 0) {
    throw usage(
      "secrets unset needs at least one KEY",
      "Run `supabase-axi secrets unset KEY`",
    );
  }
  const out = await supaText(["secrets", "unset", ...rest]);
  return {
    unset: positionals,
    output: preview(out).text || "(no output)",
    help: ["Run `supabase-axi secrets list` to confirm"],
  };
}
