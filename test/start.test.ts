import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supa.js", () => ({ supaText: vi.fn() }));

import { startCommand } from "../src/commands/start.js";
import { stopCommand } from "../src/commands/stop.js";
import { supaText } from "../src/supa.js";

const text = vi.mocked(supaText);
afterEach(() => vi.clearAllMocks());

describe("startCommand", () => {
  it("starts the stack and forwards flags", async () => {
    text.mockResolvedValue("Started supabase local development setup.\n");
    const out: any = await startCommand(["--exclude", "imgproxy"]);
    expect(text.mock.calls[0][0]).toEqual(["start", "--exclude", "imgproxy"]);
    expect(out.started).toBe(true);
  });

  it("falls back to a default message when output is empty", async () => {
    text.mockResolvedValue("");
    const out: any = await startCommand([]);
    expect(out.output).toContain("started");
  });
});

describe("stopCommand", () => {
  it("stops the stack and forwards flags", async () => {
    text.mockResolvedValue("Stopped supabase local development setup.\n");
    const out: any = await stopCommand(["--no-backup"]);
    expect(text.mock.calls[0][0]).toEqual(["stop", "--no-backup"]);
    expect(out.stopped).toBe(true);
  });

  it("falls back to a default message when output is empty", async () => {
    text.mockResolvedValue("");
    const out: any = await stopCommand([]);
    expect(out.output).toContain("stopped");
  });
});
