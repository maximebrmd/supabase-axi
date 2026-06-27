import { AxiError } from "../errors.js";
import { asArray, type Obj } from "../format.js";
import { supaJson } from "../supa.js";

/** Content-first home view: your projects, plus local migration state if linked. */
export async function homeCommand() {
  let projects: Obj[];
  try {
    projects = asArray(await supaJson<Obj[]>(["projects", "list"]));
  } catch (e) {
    if (e instanceof AxiError && e.code === "SUPABASE_NOT_INSTALLED") {
      return {
        status: "the Supabase CLI (supabase) is not installed",
        setup: [
          "1. Install it: brew install supabase/tap/supabase",
          "2. Authenticate: supabase login",
        ],
        help: ["Run `supabase-axi --help` to see all commands"],
      };
    }
    if (e instanceof AxiError && e.code === "AUTH_REQUIRED") {
      return {
        status: "not logged in to Supabase",
        setup: [
          "1. Run: supabase login (opens a browser; token stored locally)",
          "2. Or export SUPABASE_ACCESS_TOKEN with a personal access token",
        ],
        help: ["Run `supabase-axi --help` to see all commands"],
      };
    }
    throw e;
  }

  const recent = projects.slice(0, 5).map((p) => ({
    ref: p.id ?? p.ref,
    name: p.name,
    region: p.region,
  }));

  // Local migration state is only available from a linked project directory;
  // surface it when present, but never let its absence break the home view.
  let migrations: string | Obj[];
  try {
    migrations = asArray(await supaJson<Obj[]>(["migration", "list"])).map(
      (m) => ({ version: m.version ?? m.name, name: m.name }),
    );
  } catch (e) {
    if (e instanceof AxiError) {
      migrations = "run from a linked project directory to list migrations";
    } else {
      throw e;
    }
  }

  if (projects.length === 0) {
    return {
      projects: [],
      result: "no Supabase projects yet",
      help: [
        "Run `supabase-axi projects create <name> --org <id> --db-password <pw> --region <r>`",
        "Or link an existing one: `supabase-axi link --project-ref <ref>`",
      ],
    };
  }

  return {
    projects: recent,
    count: projects.length,
    migrations,
    help: [
      "Run `supabase-axi projects get <ref>` for keys & connection info",
      "Run `supabase-axi link --project-ref <ref>` to link this directory",
      "Run `supabase-axi status` for local stack health",
    ],
  };
}
