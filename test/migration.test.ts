import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supa.js", () => ({ supaJson: vi.fn(), supaText: vi.fn() }));

import { migrationCommand } from "../src/commands/migration.js";
import { supaJson, supaText } from "../src/supa.js";
import { AxiError } from "../src/errors.js";

const json = vi.mocked(supaJson);
const text = vi.mocked(supaText);
afterEach(() => vi.clearAllMocks());

describe("migration routing", () => {
  it("rejects a missing or unknown subcommand", async () => {
    await expect(migrationCommand([])).rejects.toBeInstanceOf(AxiError);
    await expect(migrationCommand(["frob"])).rejects.toBeInstanceOf(AxiError);
  });
});

describe("migration list", () => {
  it("returns an empty state", async () => {
    json.mockResolvedValue([] as never);
    const out: any = await migrationCommand(["list"]);
    expect(out.migrations).toEqual([]);
    expect(out.result).toContain("no migrations");
  });

  it("maps version/name/applied, defaulting version to name (alias ls)", async () => {
    json.mockResolvedValue([
      { version: "20240101", name: "init", applied: true },
      { name: "second", status: "reverted" },
      { name: "third" },
    ] as never);
    const out: any = await migrationCommand(["ls"]);
    expect(out.count).toBe(3);
    expect(out.migrations[2]).toEqual({
      version: "third",
      name: "third",
      applied: undefined,
    });
    expect(out.migrations[0]).toEqual({
      version: "20240101",
      name: "init",
      applied: true,
    });
    expect(out.migrations[1]).toEqual({
      version: "second",
      name: "second",
      applied: "reverted",
    });
  });
});

describe("migration new", () => {
  it("requires a name", async () => {
    await expect(migrationCommand(["new"])).rejects.toBeInstanceOf(AxiError);
  });
  it("creates a migration file", async () => {
    text.mockResolvedValue("Created supabase/migrations/0001_add.sql\n");
    const out: any = await migrationCommand(["new", "add"]);
    expect(text.mock.calls[0][0]).toEqual(["migration", "new", "add"]);
    expect(out.created).toBe("add");
  });
});

describe("migration up/repair/squash", () => {
  it("applies pending migrations locally", async () => {
    text.mockResolvedValue("Applied 2 migrations\n");
    const out: any = await migrationCommand(["up"]);
    expect(out.migration).toBe("up");
    expect(out.output).toContain("Applied");
  });

  it("requires a version for repair", async () => {
    await expect(migrationCommand(["repair"])).rejects.toBeInstanceOf(AxiError);
  });

  it("repairs history and forwards flags", async () => {
    text.mockResolvedValue("");
    const out: any = await migrationCommand([
      "repair",
      "20240101",
      "--status",
      "applied",
    ]);
    expect(text.mock.calls[0][0]).toEqual([
      "migration",
      "repair",
      "20240101",
      "--status",
      "applied",
    ]);
    expect(out.output).toBe("(no output)");
  });

  it("squashes migrations", async () => {
    text.mockResolvedValue("Squashed\n");
    const out: any = await migrationCommand(["squash"]);
    expect(out.migration).toBe("squash");
  });
});
