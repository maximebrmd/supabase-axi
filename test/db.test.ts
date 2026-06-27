import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supa.js", () => ({ supaText: vi.fn() }));

import { dbCommand } from "../src/commands/db.js";
import { supaText } from "../src/supa.js";
import { AxiError } from "../src/errors.js";

const text = vi.mocked(supaText);
afterEach(() => vi.clearAllMocks());

describe("dbCommand", () => {
  it("rejects a missing or unknown subcommand", async () => {
    await expect(dbCommand([])).rejects.toBeInstanceOf(AxiError);
    await expect(dbCommand(["frob"])).rejects.toBeInstanceOf(AxiError);
  });

  it("runs push, forwards flags, and previews the output", async () => {
    text.mockResolvedValue("Applying migration 0001...\nDone\n");
    const out: any = await dbCommand(["push", "--dry-run"]);
    expect(text.mock.calls[0][0]).toEqual(["db", "push", "--dry-run"]);
    expect(out.db).toBe("push");
    expect(out.lines).toBe(2);
    expect(out.help[0]).toContain("migration list");
  });

  it("reports a no-output state for an empty diff", async () => {
    text.mockResolvedValue("\n");
    const out: any = await dbCommand(["diff"]);
    expect(out.output).toContain("no output");
  });

  it("truncates a large dump and records the char count", async () => {
    text.mockResolvedValue("x".repeat(2000));
    const out: any = await dbCommand(["dump"]);
    expect(out.truncated).toBe(true);
    expect(out.chars).toBe(2000);
    expect(out.output).toHaveLength(1500);
  });
});
