import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supa.js", () => ({
  supaJson: vi.fn(),
  supaText: vi.fn(),
  mgmtApi: vi.fn(),
}));

import { main } from "../src/cli.js";
import { supaJson, supaText, mgmtApi } from "../src/supa.js";
import { AxiError } from "../src/errors.js";

// Exercises each command arrow in src/cli.ts's COMMANDS map. With supa rejecting,
// the data commands surface AUTH_REQUIRED; `setup` (no subcommand) fails
// validation before touching the filesystem — both prove the arrow dispatched.
describe("command dispatch", () => {
  beforeEach(() => {
    process.exitCode = undefined;
    const err = new AxiError("nope", "AUTH_REQUIRED");
    vi.mocked(supaJson).mockRejectedValue(err);
    vi.mocked(supaText).mockRejectedValue(err);
    vi.mocked(mgmtApi).mockRejectedValue(err);
  });
  afterEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();
  });

  async function run(argv: string[]) {
    let out = "";
    await main({ argv, stdout: { write: (c: string) => ((out += c), true) } });
    return out;
  }

  it("routes every data command to its handler (auth required without a token)", async () => {
    expect(await run(["whoami"])).toContain("AUTH_REQUIRED");
    expect(await run(["projects", "list"])).toContain("AUTH_REQUIRED");
    expect(await run(["db", "push"])).toContain("AUTH_REQUIRED");
    expect(await run(["migration", "list"])).toContain("AUTH_REQUIRED");
    expect(await run(["migrations", "list"])).toContain("AUTH_REQUIRED");
    expect(await run(["functions", "list"])).toContain("AUTH_REQUIRED");
    expect(await run(["branches", "list"])).toContain("AUTH_REQUIRED");
    expect(await run(["secrets", "list"])).toContain("AUTH_REQUIRED");
    expect(await run(["gen", "types"])).toContain("AUTH_REQUIRED");
    expect(await run(["link", "--project-ref", "p"])).toContain(
      "AUTH_REQUIRED",
    );
    expect(await run(["status"])).toContain("AUTH_REQUIRED");
    expect(await run(["start"])).toContain("AUTH_REQUIRED");
    expect(await run(["stop"])).toContain("AUTH_REQUIRED");
    expect(await run(["api", "v1/organizations"])).toContain("AUTH_REQUIRED");
  });

  it("routes setup to its handler (validation error, no side effects)", async () => {
    expect(await run(["setup"])).toContain("Unknown setup command");
  });
});
