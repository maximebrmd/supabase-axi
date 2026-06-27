import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supa.js", () => ({ supaJson: vi.fn(), supaText: vi.fn() }));

import { functionsCommand } from "../src/commands/functions.js";
import { supaJson, supaText } from "../src/supa.js";
import { AxiError } from "../src/errors.js";

const json = vi.mocked(supaJson);
const text = vi.mocked(supaText);
afterEach(() => vi.clearAllMocks());

describe("functions routing", () => {
  it("rejects a missing or unknown subcommand", async () => {
    await expect(functionsCommand([])).rejects.toBeInstanceOf(AxiError);
    await expect(functionsCommand(["frob"])).rejects.toBeInstanceOf(AxiError);
  });
});

describe("functions list", () => {
  it("returns an empty state", async () => {
    json.mockResolvedValue([] as never);
    const out: any = await functionsCommand(["list"]);
    expect(out.functions).toEqual([]);
    expect(out.result).toContain("no Edge Functions");
  });

  it("shapes deployed functions (slug fallback, alias ls)", async () => {
    json.mockResolvedValue([
      {
        slug: "api",
        status: "ACTIVE",
        version: 3,
        updated_at: "2026-02-03T00:00:00Z",
      },
      { name: "cron", status: "ACTIVE", version: 1 },
    ] as never);
    const out: any = await functionsCommand(["ls"]);
    expect(out.count).toBe(2);
    expect(out.functions[0]).toEqual({
      slug: "api",
      status: "ACTIVE",
      version: 3,
      updated: "2026-02-03",
    });
    expect(out.functions[1].slug).toBe("cron");
  });
});

describe("functions deploy", () => {
  it("deploys a named function", async () => {
    text.mockResolvedValue("Deployed api\n");
    const out: any = await functionsCommand([
      "deploy",
      "api",
      "--no-verify-jwt",
    ]);
    expect(text.mock.calls[0][0]).toEqual([
      "functions",
      "deploy",
      "api",
      "--no-verify-jwt",
    ]);
    expect(out.deployed).toBe("api");
  });

  it("deploys all functions when no name is given", async () => {
    text.mockResolvedValue("Deployed all\n");
    const out: any = await functionsCommand(["deploy", "--project-ref", "r"]);
    expect(out.deployed).toBe("all functions");
  });
});

describe("functions new/delete/download", () => {
  it("scaffolds a new function", async () => {
    text.mockResolvedValue("Created\n");
    const out: any = await functionsCommand(["new", "hello"]);
    expect(out.created).toBe("hello");
  });

  it("requires a name for delete", async () => {
    await expect(functionsCommand(["delete"])).rejects.toBeInstanceOf(AxiError);
    await expect(
      functionsCommand(["delete", "--project-ref", "r"]),
    ).rejects.toBeInstanceOf(AxiError);
  });

  it("deletes a function", async () => {
    text.mockResolvedValue("Deleted\n");
    const out: any = await functionsCommand(["delete", "hello"]);
    expect(out.deleted).toBe("hello");
  });

  it("downloads a function", async () => {
    text.mockResolvedValue("Downloaded\n");
    const out: any = await functionsCommand(["download", "hello"]);
    expect(out.downloaded).toBe("hello");
  });
});
