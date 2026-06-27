import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supa.js", () => ({
  supaJson: vi.fn(),
  supaText: vi.fn(),
  mgmtApi: vi.fn(),
}));

import { main } from "../src/cli.js";
import { supaJson } from "../src/supa.js";
import { AxiError } from "../src/errors.js";

const json = vi.mocked(supaJson);

function capture() {
  let out = "";
  return {
    stdout: { write: (c: string) => ((out += c), true) },
    read: () => out,
  };
}

describe("main", () => {
  beforeEach(() => {
    process.exitCode = undefined;
    json.mockReset();
  });
  afterEach(() => {
    process.exitCode = undefined;
  });

  it("prints the version", async () => {
    const c = capture();
    await main({ argv: ["--version"], stdout: c.stdout });
    expect(c.read().trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("shows a content-first setup home view when not logged in", async () => {
    json.mockRejectedValue(new AxiError("nope", "AUTH_REQUIRED"));
    const c = capture();
    await main({ argv: [], stdout: c.stdout });
    const out = c.read();
    expect(out).toContain("bin:");
    expect(out).toContain("not logged in to Supabase");
  });

  it("returns a structured auth error for data commands when not logged in", async () => {
    json.mockRejectedValue(new AxiError("nope", "AUTH_REQUIRED"));
    const c = capture();
    await main({ argv: ["projects", "list"], stdout: c.stdout });
    expect(c.read()).toContain("AUTH_REQUIRED");
    expect(process.exitCode).toBe(1);
  });

  it("reports unknown commands as usage errors", async () => {
    const c = capture();
    await main({ argv: ["frobnicate"], stdout: c.stdout });
    expect(c.read()).toContain("Unknown command");
    expect(process.exitCode).toBe(2);
  });

  it("serves per-command help", async () => {
    const c = capture();
    await main({ argv: ["db", "--help"], stdout: c.stdout });
    expect(c.read()).toContain("supabase-axi db <push|pull|diff|reset|dump>");
  });
});
