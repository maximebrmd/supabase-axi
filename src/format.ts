/**
 * Loosely-typed Supabase object. The CLI's JSON payloads vary by subcommand and
 * version, so command code reads the handful of fields it needs defensively.
 */
export type Obj = Record<string, any>;

/** ISO timestamp → YYYY-MM-DD (empty string when absent). */
export function shortDate(iso?: string): string {
  return iso ? iso.slice(0, 10) : "";
}

export interface Preview {
  /** The (possibly truncated) text. */
  text: string;
  /** Number of lines in the original output. */
  lines: number;
  /** True when `text` was cut to `max` characters. */
  truncated: boolean;
  /** Original character length, present only when truncated. */
  chars?: number;
}

/**
 * Reduce a large text output (a dump, a diff, generated types) to a bounded
 * preview with line/char counts — the AXI default-minimal pattern for blobs.
 */
export function preview(raw: string, max = 1500): Preview {
  const text = raw.replace(/\s+$/, "");
  const lines = text === "" ? 0 : text.split("\n").length;
  if (text.length <= max) return { text, lines, truncated: false };
  return {
    text: text.slice(0, max),
    lines,
    truncated: true,
    chars: text.length,
  };
}

/** Coerce an unknown CLI value into an array (CLI JSON is sometimes null). */
export function asArray<T = Obj>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
