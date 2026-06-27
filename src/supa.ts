import { execFile, type ExecFileException } from "node:child_process";
import { readFileSync } from "node:fs";
import { AxiError } from "./errors.js";

// supabase-axi shells out to the official Supabase CLI (`supabase`) for every
// operation it can express, then reshapes the CLI's raw output into compact
// TOON. `supabase login` (or the `SUPABASE_ACCESS_TOKEN` env var) owns
// authentication, so supabase-axi never handles a token itself — this mirrors
// how notion-axi wraps the `ntn` binary and how gh-axi wraps `gh`.
//
// Only the `api` escape hatch talks to the Supabase Management API directly
// (over HTTPS), for the handful of things the CLI cannot express.

const MAX_BUFFER_BYTES = 20 * 1024 * 1024; // 20 MB — dumps & generated types
const MGMT_API_BASE = "https://api.supabase.com";

interface SupaResult {
  stdout: string;
  stderr: string;
  code: number;
  enoent: boolean;
}

function run(args: string[]): Promise<SupaResult> {
  return new Promise((resolve) => {
    const child = execFile(
      "supabase",
      args,
      { maxBuffer: MAX_BUFFER_BYTES, encoding: "utf8" },
      (error: ExecFileException | null, stdout, stderr) => {
        if (error && error.code === "ENOENT") {
          resolve({ stdout: "", stderr: "", code: 127, enoent: true });
          return;
        }
        const code = error
          ? typeof error.code === "number"
            ? error.code
            : 1
          : 0;
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          code,
          enoent: false,
        });
      },
    );
    // Some `supabase` subcommands read stdin when run non-interactively and
    // block on EOF; close it immediately so calls never hang.
    child.stdin?.end();
  });
}

/** Run the CLI, surfacing a missing binary or non-zero exit as an AxiError. */
async function exec(args: string[]): Promise<string> {
  const res = await run(args);
  if (res.enoent) throw supaNotInstalledError();
  if (res.code !== 0) throw mapSupaError(res.stderr || res.stdout, res.code);
  return res.stdout;
}

/**
 * Run a CLI subcommand asking for JSON (`--output-format json`) and return the
 * parsed value. Use for list/get subcommands that support structured output.
 */
export async function supaJson<T = any>(args: string[]): Promise<T> {
  const out = (await exec([...args, "--output-format", "json"])).trim();
  if (!out) return undefined as unknown as T;
  try {
    return JSON.parse(out) as T;
  } catch {
    throw new AxiError(
      `Unexpected supabase output: ${out.slice(0, 200)}`,
      "SUPABASE_ERROR",
    );
  }
}

/** Run a CLI subcommand and return its raw stdout (for text-only commands). */
export async function supaText(args: string[]): Promise<string> {
  return exec(args);
}

/** The structured error raised when the `supabase` binary is not on PATH. */
export function supaNotInstalledError(): AxiError {
  return new AxiError(
    "The Supabase CLI (`supabase`) is required but was not found on PATH",
    "SUPABASE_NOT_INSTALLED",
    [
      "Install it: brew install supabase/tap/supabase",
      "Or see other options: https://supabase.com/docs/guides/local-development/cli/getting-started",
      "Then authenticate: supabase login",
    ],
  );
}

/** Translate `supabase`'s stderr into a structured AxiError with hints. */
export function mapSupaError(stderr: string, code: number): AxiError {
  const lines = stderr
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const errLine =
    lines.find((l) => /error|failed|unauthorized/i.test(l)) ?? lines[0] ?? "";
  const message =
    errLine.replace(/^error:\s*/i, "").trim() ||
    `supabase exited with code ${code}`;
  const lower = stderr.toLowerCase();
  const suggestions: string[] = [];
  let errCode = "SUPABASE_ERROR";

  if (
    /not logged in|access token|login first|unauthorized|401|supabase login/.test(
      lower,
    )
  ) {
    errCode = "AUTH_REQUIRED";
    suggestions.push(
      "Run `supabase login` to authenticate (opens a browser; the token is stored locally)",
      "Or export SUPABASE_ACCESS_TOKEN with a personal access token from https://supabase.com/dashboard/account/tokens",
    );
  } else if (
    /not linked|cannot find project ref|run supabase link/.test(lower)
  ) {
    errCode = "NOT_LINKED";
    suggestions.push(
      "Run `supabase link --project-ref <ref>` to link this directory to a project",
      "Run `supabase-axi projects list` to find the project ref",
    );
  } else if (/docker|daemon|is the docker/.test(lower)) {
    errCode = "DOCKER_REQUIRED";
    suggestions.push(
      "Start Docker Desktop (or another Docker engine) — local-stack commands need a running Docker daemon",
    );
  } else if (/not found|does not exist|no such/.test(lower)) {
    errCode = "OBJECT_NOT_FOUND";
    suggestions.push("Check the id/ref is correct and that it exists");
  } else if (/invalid|must be|required|malformed/.test(lower)) {
    errCode = "VALIDATION_ERROR";
  }

  return new AxiError(message, errCode, suggestions);
}

// After `supabase link`, the CLI records the linked project ref in this file
// under the working directory — the same source the CLI itself reads to target
// `db`/`migration`/`gen` commands. Reading it lets Management-API commands
// resolve the ref without an extra round-trip.
const LINKED_REF_FILE = "supabase/.temp/project-ref";

/** The linked project ref (from `supabase/.temp/project-ref`), or null. */
export function linkedProjectRef(): string | null {
  try {
    const ref = readFileSync(LINKED_REF_FILE, "utf8").trim();
    return ref || null;
  } catch {
    return null;
  }
}

/** The structured error raised when no project ref can be resolved. */
export function notLinkedError(): AxiError {
  return new AxiError(
    "No project ref — this directory is not linked to a Supabase project",
    "NOT_LINKED",
    [
      "Run `supabase-axi link --project-ref <ref>` to link this directory",
      "Or pass `--project-ref <ref>` to target a project directly",
      "Run `supabase-axi projects list` to find the ref",
    ],
  );
}

interface MgmtOptions {
  method?: string;
  body?: unknown;
}

/** The structured error raised when no Management API token is available. */
export function mgmtAuthError(): AxiError {
  return new AxiError(
    "A Supabase access token is required for the Management API",
    "AUTH_REQUIRED",
    [
      "Export SUPABASE_ACCESS_TOKEN with a personal access token from https://supabase.com/dashboard/account/tokens",
      "The same token `supabase login` uses; the Management API has no browser-login fallback",
    ],
  );
}

/**
 * Call the Supabase Management API directly — the escape hatch for anything the
 * CLI does not cover. Reads the token from `SUPABASE_ACCESS_TOKEN`.
 */
export async function mgmtApi(
  path: string,
  opts: MgmtOptions = {},
): Promise<any> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw mgmtAuthError();

  const url = `${MGMT_API_BASE}/${path.replace(/^\//, "")}`;
  const method = (opts.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }

  const res = await fetch(url, init);
  const text = (await res.text()).trim();
  let parsed: any = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    throw mapMgmtError(res.status, parsed);
  }
  return parsed ?? {};
}

/** Map a non-2xx Management API response to a structured AxiError. */
export function mapMgmtError(status: number, body: any): AxiError {
  const message =
    (body && typeof body === "object" && (body.message || body.error)) ||
    (typeof body === "string" && body) ||
    `Management API request failed (${status})`;
  const suggestions: string[] = [];
  let code = "SUPABASE_ERROR";
  if (status === 401 || status === 403) {
    code = "AUTH_REQUIRED";
    suggestions.push(
      "Check SUPABASE_ACCESS_TOKEN is set and has access to this resource",
    );
  } else if (status === 404) {
    code = "OBJECT_NOT_FOUND";
    suggestions.push("Check the path and any ids in it are correct");
  } else if (status >= 400 && status < 500) {
    code = "VALIDATION_ERROR";
  }
  return new AxiError(String(message), code, suggestions);
}
