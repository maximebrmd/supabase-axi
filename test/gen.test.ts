import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supa.js", () => ({ supaText: vi.fn() }));

import { genCommand } from "../src/commands/gen.js";
import { supaText } from "../src/supa.js";
import { AxiError } from "../src/errors.js";

const text = vi.mocked(supaText);
afterEach(() => vi.clearAllMocks());

describe("genCommand", () => {
  it("rejects a missing or unknown subcommand", async () => {
    await expect(genCommand([])).rejects.toBeInstanceOf(AxiError);
    await expect(genCommand(["frob"])).rejects.toBeInstanceOf(AxiError);
  });

  it("defaults to typescript + --local", async () => {
    text.mockResolvedValue("export type X = {}\n");
    const out: any = await genCommand(["types"]);
    expect(text.mock.calls[0][0]).toEqual([
      "gen",
      "types",
      "typescript",
      "--local",
    ]);
    expect(out.language).toBe("typescript");
    expect(out.types).toContain("export type");
  });

  it("strips a redundant leading 'typescript' token", async () => {
    text.mockResolvedValue("types\n");
    await genCommand(["types", "typescript", "--linked"]);
    expect(text.mock.calls[0][0]).toEqual([
      "gen",
      "types",
      "typescript",
      "--linked",
    ]);
  });

  it("does not inject --local when a target is supplied", async () => {
    text.mockResolvedValue("types\n");
    await genCommand(["types", "--project-id", "ref"]);
    expect(text.mock.calls[0][0]).toEqual([
      "gen",
      "types",
      "typescript",
      "--project-id",
      "ref",
    ]);
  });

  it("reports an empty result", async () => {
    text.mockResolvedValue("\n");
    const out: any = await genCommand(["types", "--linked"]);
    expect(out.types).toContain("no types");
  });

  it("truncates very large type output", async () => {
    text.mockResolvedValue("y".repeat(2000));
    const out: any = await genCommand(["types", "--linked"]);
    expect(out.truncated).toBe(true);
    expect(out.chars).toBe(2000);
    expect(out.types).toHaveLength(1500);
    expect(out.help[0]).toContain("--full");
  });

  it("returns untruncated output with --full and strips the flag", async () => {
    text.mockResolvedValue("y".repeat(2000));
    const out: any = await genCommand(["types", "--linked", "--full"]);
    expect(text.mock.calls[0][0]).toEqual([
      "gen",
      "types",
      "typescript",
      "--linked",
    ]);
    expect(out.truncated).toBeUndefined();
    expect(out.types).toHaveLength(2000);
    expect(out.help[0]).toContain("database.types.ts");
  });
});
