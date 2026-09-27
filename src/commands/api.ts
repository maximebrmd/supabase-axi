import { parseArgs, strFlag } from "../args.js";
import { usage } from "../errors.js";
import type { Obj } from "../format.js";
import { redactApiPayload } from "../redact.js";
import { mgmtApi } from "../supa.js";

export const API_HELP = `usage: supabase-axi api <path> [flags]
       supabase-axi api <method> <path> [flags]

Call the Supabase Management API directly — the escape hatch for anything the
dedicated commands don't cover (organizations, custom domains, postgres config).

Recognized credential values are withheld by default: secret API-key values
and /secrets values retain a short suffix, while public API keys remain visible.
On other responses, fields named like keys, secrets, tokens, passwords, or
connection strings are masked, including nested values. Signing-key identity
metadata remains visible. Pass --reveal-secrets to print the values; the output
then contains a live credential.

Authentication uses SUPABASE_ACCESS_TOKEN (the Management API has no browser
login). Create one at https://supabase.com/dashboard/account/tokens.

flags:
  --method <get|post|patch|put|delete>   HTTP method (default: get; or pass it as the first arg)
  --body <json>                          JSON request body (for post/patch/put)
  --reveal-secrets                       Print credential values in full (default: masked)

examples:
  supabase-axi api v1/organizations
  supabase-axi api v1/projects
  supabase-axi api post v1/projects/<ref>/secrets --body '[{"name":"K","value":"v"}]'
  supabase-axi api delete v1/projects/<ref>/network-bans
  supabase-axi api v1/projects/<ref>/api-keys --reveal-secrets
`;

const METHODS = new Set(["get", "post", "patch", "put", "delete"]);

export async function apiCommand(args: string[]) {
  const { positionals, flags } = parseArgs(args, ["reveal-secrets"]);

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
  if (body !== undefined && method === "get") {
    throw usage(
      "GET requests cannot have a body",
      "Use --method post/patch/put to send a request body",
    );
  }

  const reveal = flags["reveal-secrets"] === true;
  const response: Obj = await mgmtApi(path, {
    method,
    ...(body !== undefined ? { body } : {}),
  });

  // Run the redactor even when revealing: the count drives the credential
  // warning, and the unredacted payload is only used behind the explicit flag.
  const { payload, secrets } = redactApiPayload(path, response);
  const out: Obj = { result: reveal ? response : payload };
  if (secrets > 0) {
    if (reveal) {
      out.revealed = `${secrets} secret value(s) printed in full above — this output is a credential; do not paste it into logs, tickets, or transcripts`;
    } else {
      out.withheld = secrets;
    }
  }
  out.help = [
    secrets > 0 && !reveal
      ? "Secret values are withheld — rerun with `--reveal-secrets` to print them"
      : undefined,
    secrets > 0 && reveal
      ? "This output contains a live credential; keep it out of logs, tickets, and transcripts"
      : undefined,
  ].filter(Boolean);
  return out;
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
