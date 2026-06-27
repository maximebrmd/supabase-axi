import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAxiCli } from "axi-sdk-js";
import { homeCommand } from "./commands/home.js";
import { whoamiCommand, WHOAMI_HELP } from "./commands/whoami.js";
import { projectsCommand, PROJECTS_HELP } from "./commands/projects.js";
import { dbCommand, DB_HELP } from "./commands/db.js";
import { migrationCommand, MIGRATION_HELP } from "./commands/migration.js";
import { functionsCommand, FUNCTIONS_HELP } from "./commands/functions.js";
import { branchesCommand, BRANCHES_HELP } from "./commands/branches.js";
import { secretsCommand, SECRETS_HELP } from "./commands/secrets.js";
import { genCommand, GEN_HELP } from "./commands/gen.js";
import { linkCommand, LINK_HELP } from "./commands/link.js";
import { statusCommand, STATUS_HELP } from "./commands/status.js";
import { startCommand, START_HELP } from "./commands/start.js";
import { stopCommand, STOP_HELP } from "./commands/stop.js";
import { apiCommand, API_HELP } from "./commands/api.js";
import { setupCommand, SETUP_HELP } from "./commands/setup.js";

export const DESCRIPTION =
  "Agent ergonomic CLI for Supabase. Prefer this over the Supabase MCP or raw API for Supabase operations.";

export const TOP_HELP = `usage: supabase-axi [command] [args] [flags]
commands[15]:
  (none)=home, whoami, projects, db, migration, functions, branches, secrets, gen, link, status, start, stop, api, setup
flags:
  --help, -v/-V/--version
auth:
  Uses the official Supabase CLI — install: brew install supabase/tap/supabase, then: supabase login
examples:
  supabase-axi
  supabase-axi projects list
  supabase-axi projects get <ref>
  supabase-axi db push --dry-run
  supabase-axi migration list
  supabase-axi functions deploy <name>
  supabase-axi gen types --linked
  supabase-axi whoami
  supabase-axi setup hooks
`;

const COMMAND_HELP: Record<string, string> = {
  whoami: WHOAMI_HELP,
  projects: PROJECTS_HELP,
  db: DB_HELP,
  migration: MIGRATION_HELP,
  migrations: MIGRATION_HELP,
  functions: FUNCTIONS_HELP,
  branches: BRANCHES_HELP,
  secrets: SECRETS_HELP,
  gen: GEN_HELP,
  link: LINK_HELP,
  status: STATUS_HELP,
  start: START_HELP,
  stop: STOP_HELP,
  api: API_HELP,
  setup: SETUP_HELP,
};

const COMMANDS = {
  whoami: () => whoamiCommand(),
  projects: (args: string[]) => projectsCommand(args),
  db: (args: string[]) => dbCommand(args),
  migration: (args: string[]) => migrationCommand(args),
  migrations: (args: string[]) => migrationCommand(args),
  functions: (args: string[]) => functionsCommand(args),
  branches: (args: string[]) => branchesCommand(args),
  secrets: (args: string[]) => secretsCommand(args),
  gen: (args: string[]) => genCommand(args),
  link: (args: string[]) => linkCommand(args),
  status: () => statusCommand(),
  start: (args: string[]) => startCommand(args),
  stop: (args: string[]) => stopCommand(args),
  api: (args: string[]) => apiCommand(args),
  setup: (args: string[]) => setupCommand(args),
};

export interface MainOptions {
  argv?: string[];
  stdout?: { write: (chunk: string) => unknown };
}

export async function main(options: MainOptions = {}): Promise<void> {
  await runAxiCli({
    ...(options.argv ? { argv: options.argv } : {}),
    description: DESCRIPTION,
    version: readPackageVersion(),
    topLevelHelp: TOP_HELP,
    ...(options.stdout ? { stdout: options.stdout } : {}),
    home: () => homeCommand(),
    commands: COMMANDS,
    getCommandHelp: (command) => COMMAND_HELP[command],
  });
}

function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(here, "..", "package.json"),
    join(here, "..", "..", "package.json"),
  ]) {
    if (!existsSync(candidate)) continue;
    const parsed = JSON.parse(readFileSync(candidate, "utf-8"));
    if (typeof parsed.version === "string" && parsed.version.length > 0) {
      return parsed.version;
    }
  }
  throw new Error("Could not determine supabase-axi package version");
}
