import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supa.js", () => ({ supaJson: vi.fn(), supaText: vi.fn() }));

import { secretsCommand } from "../src/commands/secrets.js";
import { supaJson, supaText } from "../src/supa.js";
import { AxiError } from "../src/errors.js";

const json = vi.mocked(supaJson);
const text = vi.mocked(supaText);
afterEach(() => vi.clearAllMocks());

describe("secrets routing", () => {
  it("rejects a missing or unknown subcommand", async () => {
    await expect(secretsCommand([])).rejects.toBeInstanceOf(AxiError);
    await expect(secretsCommand(["frob"])).rejects.toBeInstanceOf(AxiError);
  });
});

describe("secrets list", () => {
  it("returns an empty state", async () => {
    json.mockResolvedValue([] as never);
    const out: any = await secretsCommand(["list"]);
    expect(out.secrets).toEqual([]);
    expect(out.result).toContain("no secrets");
  });

  it("shows names and digests (alias ls)", async () => {
    json.mockResolvedValue([
      { name: "STRIPE_KEY", value: "abc123digest" },
    ] as never);
    const out: any = await secretsCommand(["ls"]);
    expect(out.secrets[0]).toEqual({
      name: "STRIPE_KEY",
      digest: "abc123digest",
    });
    expect(out.count).toBe(1);
  });
});

describe("secrets set", () => {
  it("requires at least one pair", async () => {
    await expect(secretsCommand(["set"])).rejects.toBeInstanceOf(AxiError);
  });

  it("rejects arguments that are not KEY=value", async () => {
    await expect(secretsCommand(["set", "NOPE"])).rejects.toThrow(/KEY=value/);
  });

  it("sets secrets and reports the keys", async () => {
    text.mockResolvedValue("");
    const out: any = await secretsCommand(["set", "A=1", "B=2"]);
    expect(text.mock.calls[0][0]).toEqual(["secrets", "set", "A=1", "B=2"]);
    expect(out.set).toEqual(["A", "B"]);
    expect(out.output).toBe("(no output)");
  });
});

describe("secrets unset", () => {
  it("requires at least one key", async () => {
    await expect(secretsCommand(["unset"])).rejects.toBeInstanceOf(AxiError);
  });

  it("unsets secrets with a no-output fallback", async () => {
    text.mockResolvedValue("");
    const out: any = await secretsCommand(["unset", "A", "B"]);
    expect(out.unset).toEqual(["A", "B"]);
    expect(out.output).toBe("(no output)");
  });
});
