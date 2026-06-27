import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supa.js", () => ({ supaJson: vi.fn() }));

import { homeCommand } from "../src/commands/home.js";
import { supaJson } from "../src/supa.js";
import { AxiError } from "../src/errors.js";
import { route } from "./support.js";

const json = vi.mocked(supaJson);
afterEach(() => vi.clearAllMocks());

describe("homeCommand", () => {
  it("shows install guidance when the CLI is missing", async () => {
    json.mockRejectedValue(new AxiError("x", "SUPABASE_NOT_INSTALLED"));
    const out: any = await homeCommand();
    expect(out.status).toContain("not installed");
    expect(out.setup[0]).toContain("brew install");
  });

  it("shows login guidance when not authenticated", async () => {
    json.mockRejectedValue(new AxiError("x", "AUTH_REQUIRED"));
    const out: any = await homeCommand();
    expect(out.status).toContain("not logged in");
  });

  it("rethrows an unexpected error from projects list", async () => {
    json.mockRejectedValue(new Error("boom"));
    await expect(homeCommand()).rejects.toThrow("boom");
  });

  it("gives an empty state when there are no projects", async () => {
    route(json, { projects: [], migration: [] });
    const out: any = await homeCommand();
    expect(out.projects).toEqual([]);
    expect(out.result).toContain("no Supabase projects");
  });

  it("lists recent projects and local migrations", async () => {
    route(json, {
      projects: [
        { id: "p1", name: "App", region: "us-east-1" },
        { ref: "p2", name: "Two", region: "eu-west-1" },
      ],
      migration: [{ version: "2024", name: "init" }, { name: "second" }],
    });
    const out: any = await homeCommand();
    expect(out.count).toBe(2);
    expect(out.projects[0]).toEqual({
      ref: "p1",
      name: "App",
      region: "us-east-1",
    });
    expect(out.projects[1].ref).toBe("p2");
    expect(out.migrations).toEqual([
      { version: "2024", name: "init" },
      { version: "second", name: "second" },
    ]);
  });

  it("notes when migrations cannot be listed (not linked)", async () => {
    route(json, {
      projects: [{ id: "p1", name: "App", region: "us" }],
      migration: () => {
        throw new AxiError("not linked", "NOT_LINKED");
      },
    });
    const out: any = await homeCommand();
    expect(out.migrations).toContain("linked project directory");
  });

  it("rethrows a non-AxiError raised while listing migrations", async () => {
    route(json, {
      projects: [{ id: "p1", name: "App", region: "us" }],
      migration: () => {
        throw new Error("network down");
      },
    });
    await expect(homeCommand()).rejects.toThrow("network down");
  });
});
