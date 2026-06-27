import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supa.js", () => ({ supaJson: vi.fn() }));

import { statusCommand } from "../src/commands/status.js";
import { supaJson } from "../src/supa.js";

const json = vi.mocked(supaJson);
afterEach(() => vi.clearAllMocks());

describe("statusCommand", () => {
  it("reports a running stack with its services", async () => {
    json.mockResolvedValue({
      API_URL: "http://localhost:54321",
      ANON_KEY: "anon",
    } as never);
    const out: any = await statusCommand();
    expect(out.running).toBe(true);
    expect(out.services.API_URL).toContain("54321");
    expect(out.help[0]).toContain("stop");
  });

  it("reports a stopped stack when nothing is returned", async () => {
    json.mockResolvedValue(undefined as never);
    const out: any = await statusCommand();
    expect(out.running).toBe(false);
    expect(out.help[0]).toContain("start");
  });
});
