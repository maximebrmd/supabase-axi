import { listFlag, parseArgs, strFlag } from "../args.js";
import { usage } from "../errors.js";
import { asArray, shortDate, type Obj } from "../format.js";
import { supaJson, supaText } from "../supa.js";

export const PROJECTS_HELP = `usage: supabase-axi projects <list|get|create> [args] [flags]

subcommands:
  list [--full] [--fields <a,b>]
      List all projects you can reach (ref, name, region). --full adds the
      organization and creation date; --fields picks specific columns.

  get <ref>
      Show a project's details, API keys, and connection info (REST URL).

  create <name> --org <org_id> --db-password <pw> --region <region>
      Create a NEW cloud project. This provisions billable infrastructure on
      your Supabase organization — use deliberately.

examples:
  supabase-axi projects list
  supabase-axi projects get abcdefghijklmnop
  supabase-axi projects create my-app --org abcd --db-password 's3cret' --region us-east-1
`;

const COLUMNS: Record<string, (p: Obj) => unknown> = {
  org: (p) => p.organization_id,
  created: (p) => shortDate(p.created_at),
  status: (p) => p.status,
};

export async function projectsCommand(args: string[]) {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return projectsList(rest);
    case "get":
      return projectsGet(rest);
    case "create":
      return projectsCreate(rest);
    default:
      throw usage(
        sub
          ? `Unknown projects subcommand "${sub}"`
          : "Missing projects subcommand",
        "Run `supabase-axi projects list` to list projects",
        "Run `supabase-axi projects get <ref>` for keys & connection info",
      );
  }
}

function ref(p: Obj): string {
  return p.id ?? p.ref;
}

async function projectsList(args: string[]) {
  const { flags } = parseArgs(args, ["full"]);
  const full = flags.full === true;
  const asked = listFlag(flags.fields);
  const unknown = asked.filter((c) => !(c in COLUMNS));
  if (unknown.length) {
    throw usage(
      `Unknown column${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`,
      `Valid columns: ${Object.keys(COLUMNS).join(", ")}`,
    );
  }
  const cols = asked.length ? asked : full ? Object.keys(COLUMNS) : [];

  const projects = asArray<Obj>(await supaJson<Obj[]>(["projects", "list"]));
  const rows = projects.map((p) => {
    const row: Obj = { ref: ref(p), name: p.name, region: p.region };
    for (const c of cols) row[c] = COLUMNS[c](p);
    return row;
  });

  if (rows.length === 0) {
    return {
      projects: [],
      result: "no Supabase projects yet",
      help: [
        "Run `supabase-axi projects create <name> --org <id> --db-password <pw> --region <r>`",
      ],
    };
  }

  return {
    projects: rows,
    count: rows.length,
    help: [
      "Run `supabase-axi projects get <ref>` for keys & connection info",
      cols.length === 0 ? "Add `--full` for org & creation date" : undefined,
    ].filter(Boolean),
  };
}

async function projectsGet(args: string[]) {
  const { positionals } = parseArgs(args);
  const ref0 = positionals[0];
  if (!ref0) {
    throw usage("Missing project ref", "Run `supabase-axi projects get <ref>`");
  }

  const keys = asArray<Obj>(
    await supaJson<Obj[]>(["projects", "api-keys", "--project-ref", ref0]),
  );
  const projects = asArray<Obj>(await supaJson<Obj[]>(["projects", "list"]));
  const project = projects.find((p) => ref(p) === ref0);

  return {
    project: project
      ? {
          ref: ref0,
          name: project.name,
          region: project.region,
          org: project.organization_id,
          created: shortDate(project.created_at),
        }
      : { ref: ref0 },
    connection: {
      url: `https://${ref0}.supabase.co`,
      rest: `https://${ref0}.supabase.co/rest/v1`,
    },
    api_keys: keys.map((k) => ({ name: k.name, key: k.api_key })),
    help: [
      "Use the `anon` key in browser/client code; keep `service_role` server-side only",
      "Run `supabase-axi link --project-ref " +
        ref0 +
        "` to link this directory",
    ],
  };
}

async function projectsCreate(args: string[]) {
  const { positionals, flags } = parseArgs(args);
  const name = positionals[0];
  const org = strFlag(flags.org);
  const password = strFlag(flags["db-password"]);
  const region = strFlag(flags.region);
  if (!name || !org || !password || !region) {
    throw usage(
      "projects create needs a name, --org, --db-password, and --region",
      "Run `supabase-axi projects create <name> --org <org_id> --db-password <pw> --region <region>`",
      "Find your org id with `supabase-axi api GET v1/organizations`",
    );
  }

  const out = await supaText([
    "projects",
    "create",
    name,
    "--org-id",
    org,
    "--db-password",
    password,
    "--region",
    region,
  ]);

  return {
    created: name,
    org,
    region,
    output: out.trim(),
    help: [
      "Provisioning takes a few minutes; run `supabase-axi projects list` to watch for it",
      "Run `supabase-axi projects get <ref>` once it appears for keys",
    ],
  };
}
