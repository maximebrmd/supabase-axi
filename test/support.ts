import { type Mock } from "vitest";

/**
 * Route a mocked `supaJson`/`supaText` by the first CLI arg (e.g. "projects",
 * "migration") to a value or a thrower. Unmatched calls throw, surfacing gaps.
 */
export function route(
  mock: Mock,
  map: Record<string, unknown | (() => unknown)>,
): void {
  mock.mockImplementation(async (args: string[]) => {
    const key = args[0];
    if (!(key in map)) throw new Error(`unmocked supa call: ${args.join(" ")}`);
    const v = map[key];
    return typeof v === "function" ? (v as () => unknown)() : v;
  });
}
