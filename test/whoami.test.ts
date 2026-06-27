import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supa.js", () => ({ supaJson: vi.fn() }));

import { whoamiCommand } from "../src/commands/whoami.js";
import { supaJson } from "../src/supa.js";
import { AxiError } from "../src/errors.js";

const json = vi.mocked(supaJson);
afterEach(() => {
  vi.clearAllMocks();
  delete process.env.SUPABASE_ACCESS_TOKEN;
});

describe("whoamiCommand", () => {
  it("reports a login-based identity with a project count", async () => {
    json.mockResolvedValue([{ id: "p1" }, { id: "p2" }] as never);
    const out: any = await whoamiCommand();
    expect(out.authenticated).toBe(true);
    expect(out.projects).toBe(2);
    expect(out.token_source).toContain("supabase login");
  });

  it("notes when the token comes from the environment", async () => {
    process.env.SUPABASE_ACCESS_TOKEN = "tok";
    json.mockResolvedValue([] as never);
    const out: any = await whoamiCommand();
    expect(out.token_source).toContain("SUPABASE_ACCESS_TOKEN");
    expect(out.projects).toBe(0);
  });

  it("surfaces an auth error when not logged in", async () => {
    json.mockRejectedValue(new AxiError("nope", "AUTH_REQUIRED"));
    await expect(whoamiCommand()).rejects.toBeInstanceOf(AxiError);
  });
});
