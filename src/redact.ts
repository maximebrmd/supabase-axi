import type { Obj } from "./format.js";

// Shared credential-withholding logic. `projects get` classifies API keys and
// masks secret values; the raw `api` escape hatch must apply the same rule to
// Management API responses, so both commands import from here.

/**
 * Fallback for payloads without a `type` field: key names Supabase designs to
 * be shipped in client code.
 */
const PUBLIC_KEY_NAMES = new Set(["anon", "publishable"]);

function lower(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

/**
 * A key is public only when positively recognised as such. `type` is
 * authoritative — names are user-chosen in the dashboard, and both new-model
 * keys arrive named `default` — so classify on it: `publishable` is public,
 * `legacy` is public only for `anon`, and any other type (`secret`, or a type
 * Supabase adds later) is secret. Only when the payload carries no type at all
 * do we fall back to the name allow-list. Unknown ⇒ secret, so a new key type
 * is withheld on the day it appears rather than leaked once.
 */
export function isPublicKey(key: Obj): boolean {
  const type = lower(key.type);
  const name = lower(key.name);
  if (type === "publishable") return true;
  if (type === "legacy") return name === "anon";
  if (type) return false;
  return PUBLIC_KEY_NAMES.has(name);
}

/**
 * Identity for a withheld secret: enough to tell two keys apart, or to match
 * one against a value the caller already holds, without being usable.
 */
export function withheld(value: unknown): string {
  const v = typeof value === "string" ? value : "";
  return v.length > 4 ? `hidden (…${v.slice(-4)})` : "hidden";
}

/**
 * Field-name words that mark a value as credential-class. Matching is
 * deliberately generous: a false positive only hides a harmless value, while a
 * false negative prints a live credential into the agent's transcript.
 */
const CREDENTIAL_WORDS = new Set([
  "key",
  "keys",
  "apikey",
  "secret",
  "secrets",
  "token",
  "tokens",
  "password",
  "passwd",
  "pass",
  "pwd",
  "credential",
  "credentials",
  "jwt",
  "dsn",
]);

const CREDENTIAL_SUBSTRINGS = ["key", "secret", "token", "password"];

/** Compact spellings that tokenisation would split (`connectionString`). */
const CREDENTIAL_COMPACT = ["connectionstring", "connstr"];
const SIGNING_KEY_METADATA = new Set([
  "id",
  "algorithm",
  "status",
  "created_at",
  "updated_at",
]);

/** Split a field name into lowercase words: `db_password`, `db-password`, `dbPassword`. */
function fieldWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * True when a response field name looks like it carries a credential. Used as
 * the fail-closed fallback on endpoints we have no explicit rule for.
 */
export function isCredentialField(name: string): boolean {
  const words = fieldWords(name);
  if (
    words.some(
      (word) =>
        CREDENTIAL_WORDS.has(word) ||
        (word !== "keyword" &&
          CREDENTIAL_SUBSTRINGS.some((needle) => word.includes(needle))),
    )
  )
    return true;
  const compact = words.join("");
  return CREDENTIAL_COMPACT.some((needle) => compact.includes(needle));
}

/** Case-insensitive path test that ignores query strings and stray slashes. */
function endsWithSegment(
  path: string,
  segment: string,
  allowChild = false,
): boolean {
  const clean = path
    .toLowerCase()
    .split(/[?#]/)[0]
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  return (
    clean === segment ||
    clean.endsWith(`/${segment}`) ||
    (allowChild && clean.split("/").at(-2) === segment)
  );
}

interface RedactionContext {
  /** `/…/api-keys` shape: classify `api_key` with isPublicKey. */
  apiKeys: boolean;
  /** `/…/secrets` shape: every `value` string is a secret. */
  secrets: boolean;
  signingKeys: boolean;
}

interface RedactionState {
  count: number;
}

function redactValue(
  value: unknown,
  context: RedactionContext,
  state: RedactionState,
  insideCredential = false,
  signingKeyEntry = false,
): unknown {
  if (typeof value === "string") {
    // Only reachable from a credential-named container: a bare string there
    // (e.g. `{"tokens": ["…"]}`) has no field name to judge it by.
    if (!insideCredential) return value;
    state.count++;
    return withheld(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      redactValue(item, context, state, insideCredential, signingKeyEntry),
    );
  }
  if (value === null || typeof value !== "object") return value;

  const out: Obj = {};
  for (const [field, raw] of Object.entries(value)) {
    if (signingKeyEntry && SIGNING_KEY_METADATA.has(field)) {
      out[field] = raw;
      continue;
    }
    if (context.signingKeys && !insideCredential && field === "keys") {
      out[field] = redactValue(raw, context, state, true, true);
      continue;
    }
    if (context.apiKeys && field === "api_key") {
      // Known /api-keys shape: mask a key unless it is positively public, so
      // the generic field rule can never over-mask a publishable value.
      if (typeof raw === "string" && !isPublicKey(value as Obj)) {
        out[field] = withheld(raw);
        state.count++;
      } else {
        out[field] = redactValue(raw, context, state, insideCredential);
      }
      continue;
    }
    if (context.secrets && field === "value") {
      // Known /secrets shape: the value is always a credential, whatever its
      // JSON shape; a non-string subtree is masked entirely.
      if (typeof raw === "string") {
        out[field] = withheld(raw);
        state.count++;
      } else {
        out[field] = redactValue(raw, context, state, true);
      }
      continue;
    }
    const credential = insideCredential || isCredentialField(field);
    if (typeof raw === "string" && credential) {
      out[field] = withheld(raw);
      state.count++;
      continue;
    }
    out[field] = redactValue(raw, context, state, credential);
  }
  return out;
}

export interface Redaction {
  /** A copy of the payload with credential values masked. */
  payload: unknown;
  /** How many credential values the payload carried. */
  secrets: number;
}

/**
 * Mask credential values in a Management API response before it is rendered.
 * Known secret-bearing paths (`/api-keys`, `/secrets`) get their dedicated
 * shapes; every other field is judged by name so unknown endpoints fail
 * closed. Recurses through nested objects and arrays, masking bare strings
 * inside a credential-named container too.
 */
export function redactApiPayload(path: string, payload: unknown): Redaction {
  const state: RedactionState = { count: 0 };
  const context: RedactionContext = {
    apiKeys: endsWithSegment(path, "api-keys", true),
    secrets: endsWithSegment(path, "secrets"),
    signingKeys: endsWithSegment(path, "signing-keys"),
  };
  return {
    payload: redactValue(payload, context, state),
    secrets: state.count,
  };
}
