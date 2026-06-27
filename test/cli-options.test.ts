import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

describe("main option branches", () => {
  let argv: string[];

  beforeEach(() => {
    argv = process.argv;
  });
  afterEach(() => {
    process.argv = argv;
    vi.restoreAllMocks();
  });

  it("reads argv from process.argv when none is passed", async () => {
    process.argv = ["node", "supabase-axi", "--version"];
    let out = "";
    await main({ stdout: { write: (c: string) => ((out += c), true) } });
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("writes to process.stdout when no stdout is passed", async () => {
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    await main({ argv: ["--version"] });
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0]![0]).trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
