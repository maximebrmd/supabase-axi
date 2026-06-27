import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supa.js", () => ({ supaJson: vi.fn(), supaText: vi.fn() }));

import { branchesCommand } from "../src/commands/branches.js";
import { supaJson, supaText } from "../src/supa.js";
import { AxiError } from "../src/errors.js";

const json = vi.mocked(supaJson);
const text = vi.mocked(supaText);
afterEach(() => vi.clearAllMocks());

describe("branches routing", () => {
  it("rejects a missing or unknown subcommand", async () => {
    await expect(branchesCommand([])).rejects.toBeInstanceOf(AxiError);
    await expect(branchesCommand(["frob"])).rejects.toBeInstanceOf(AxiError);
  });
});

describe("branches list", () => {
  it("returns an empty state", async () => {
    json.mockResolvedValue([] as never);
    const out: any = await branchesCommand(["list"]);
    expect(out.branches).toEqual([]);
    expect(out.result).toContain("no preview branches");
  });

  it("shapes branches (id fallback, alias ls)", async () => {
    json.mockResolvedValue([
      { id: "b1", name: "staging", status: "FUNCTIONS_DEPLOYED" },
      { ref: "b2", name: "feat", status: "CREATING" },
    ] as never);
    const out: any = await branchesCommand(["ls"]);
    expect(out.count).toBe(2);
    expect(out.branches[0]).toEqual({
      id: "b1",
      name: "staging",
      status: "FUNCTIONS_DEPLOYED",
    });
    expect(out.branches[1].id).toBe("b2");
  });
});

describe("branches get", () => {
  it("requires an id", async () => {
    await expect(branchesCommand(["get"])).rejects.toBeInstanceOf(AxiError);
  });

  it("returns one branch's details", async () => {
    json.mockResolvedValue({
      id: "b1",
      name: "staging",
      status: "ACTIVE",
      project_ref: "p1",
    } as never);
    const out: any = await branchesCommand(["get", "b1"]);
    expect(out.branch).toEqual({
      id: "b1",
      name: "staging",
      status: "ACTIVE",
      project_ref: "p1",
    });
  });

  it("tolerates an empty get response", async () => {
    json.mockResolvedValue(undefined as never);
    const out: any = await branchesCommand(["get", "b1"]);
    expect(out.branch.id).toBeUndefined();
  });
});

describe("branches create/delete/disable", () => {
  it("requires a name for create", async () => {
    await expect(branchesCommand(["create"])).rejects.toBeInstanceOf(AxiError);
  });

  it("creates a branch", async () => {
    text.mockResolvedValue("Created\n");
    const out: any = await branchesCommand(["create", "staging"]);
    expect(out.created).toBe("staging");
  });

  it("requires an id for delete", async () => {
    await expect(branchesCommand(["delete"])).rejects.toBeInstanceOf(AxiError);
  });

  it("deletes a branch", async () => {
    text.mockResolvedValue("Deleted\n");
    const out: any = await branchesCommand(["delete", "b1"]);
    expect(out.deleted).toBe("b1");
  });

  it("disables branching with a no-output fallback", async () => {
    text.mockResolvedValue("");
    const out: any = await branchesCommand(["disable"]);
    expect(out.disabled).toBe(true);
    expect(out.output).toBe("(no output)");
  });
});
