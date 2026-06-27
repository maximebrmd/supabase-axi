import { parseArgs, strFlag } from "../args.js";
import { usage } from "../errors.js";
import { mgmtApi } from "../supa.js";
import type { Obj } from "../format.js";

export const API_HELP = `usage: supabase-axi api <path> [flags]
       supabase-axi api <method> <path> [flags]

Call the Supabase Management API directly — the escape hatch for anything the
dedicated commands don't cover (organizations, custom domains, postgres config).

Authentication uses SUPABASE_ACCESS_TOKEN (the Management API has no browser
login). Create one at https://supabase.com/dashboard/account/tokens.

flags:
  --method <get|post|patch|put|delete>   HTTP method (default: get; or pass it as the first arg)
  --body <json>                          JSON request body (for post/patch/put)

examples:
  supabase-axi api v1/organizations
  supabase-axi api v1/projects
  supabase-axi api post v1/projects/<ref>/secrets --body '[{"name":"K","value":"v"}]'
  supabase-axi api delete v1/projects/<ref>/network-bans
`;

const METHODS = new Set(["get", "post", "patch", "put", "delete"]);

export async function apiCommand(args: string[]) {
  const { positionals, flags } = parseArgs(args);

  let method = strFlag(flags.method)?.toLowerCase();
  let path: string;
  if (positionals.length >= 2 && METHODS.has(positionals[0].toLowerCase())) {
    method = positionals[0].toLowerCase();
    path = positionals[1];
  } else {
    path = positionals[0];
  }
  method = method ?? "get";

  if (!path) {
    throw usage(
      "Missing path",
      "Run `supabase-axi api <path>` (e.g. `v1/organizations`)",
    );
  }
  if (!METHODS.has(method)) {
    throw usage(
      `Unknown method "${method}"`,
      "Use one of: get, post, patch, put, delete",
    );
  }

  const body = parseJson(strFlag(flags.body), "--body");

  const result: Obj = await mgmtApi(path, {
    method,
    ...(body !== undefined ? { body } : {}),
  });
  return { result };
}

function parseJson(raw: string | undefined, flag: string): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw usage(
      `Invalid JSON in ${flag}`,
      `Pass valid JSON, e.g. ${flag} '{"key":"value"}'`,
    );
  }
}
