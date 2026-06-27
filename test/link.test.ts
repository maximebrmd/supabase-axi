import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supa.js", () => ({ supaText: vi.fn() }));

import { linkCommand } from "../src/commands/link.js";
import { supaText } from "../src/supa.js";
import { AxiError } from "../src/errors.js";

const text = vi.mocked(supaText);
afterEach(() => vi.clearAllMocks());

describe("linkCommand", () => {
  it("requires --project-ref", async () => {
    await expect(linkCommand([])).rejects.toBeInstanceOf(AxiError);
  });

  it("links a project and previews output", async () => {
    text.mockResolvedValue("Finished supabase link.\n");
    const out: any = await linkCommand(["--project-ref", "p1"]);
    expect(text.mock.calls[0][0]).toEqual(["link", "--project-ref", "p1"]);
    expect(out.linked).toBe("p1");
  });

  it("passes a password through and falls back when output is empty", async () => {
    text.mockResolvedValue("");
    const out: any = await linkCommand([
      "--project-ref",
      "p1",
      "--password",
      "pw",
    ]);
    expect(text.mock.calls[0][0]).toEqual([
      "link",
      "--project-ref",
      "p1",
      "--password",
      "pw",
    ]);
    expect(out.output).toBe("(linked)");
  });
});
