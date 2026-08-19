import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supa.js", () => ({
  supaJson: vi.fn(),
  supaText: vi.fn(),
  mgmtApi: vi.fn(),
}));

import { projectsCommand } from "../src/commands/projects.js";
import { main } from "../src/cli.js";
import { supaJson, supaText } from "../src/supa.js";
import { AxiError } from "../src/errors.js";

/** Collect what the CLI actually renders, so leaks are caught in the output. */
function capture() {
  let out = "";
  return {
    stdout: { write: (c: string) => ((out += c), true) },
    read: () => out,
  };
}

const json = vi.mocked(supaJson);
const text = vi.mocked(supaText);
afterEach(() => vi.clearAllMocks());

const projects = [
  {
    id: "p1",
    name: "App",
    region: "us-east-1",
    organization_id: "org1",
    created_at: "2026-01-02T00:00:00Z",
    status: "ACTIVE_HEALTHY",
  },
];

describe("projects routing", () => {
  it("rejects a missing or unknown subcommand", async () => {
    await expect(projectsCommand([])).rejects.toBeInstanceOf(AxiError);
    await expect(projectsCommand(["frob"])).rejects.toBeInstanceOf(AxiError);
  });
});

describe("projects list", () => {
  it("returns ref/name/region by default with a --full hint", async () => {
    json.mockResolvedValue(projects as never);
    const out: any = await projectsCommand(["list"]);
    expect(out.count).toBe(1);
    expect(out.projects[0]).toEqual({
      ref: "p1",
      name: "App",
      region: "us-east-1",
    });
    expect(out.help.some((h: string) => h.includes("--full"))).toBe(true);
  });

  it("adds org/created/status with --full", async () => {
    json.mockResolvedValue(projects as never);
    const out: any = await projectsCommand(["list", "--full"]);
    expect(out.projects[0]).toMatchObject({
      org: "org1",
      created: "2026-01-02",
      status: "ACTIVE_HEALTHY",
    });
    expect(out.help.some((h: string) => h.includes("--full"))).toBe(false);
  });

  it("supports --fields and rejects unknown columns", async () => {
    json.mockResolvedValue(projects as never);
    const out: any = await projectsCommand(["list", "--fields", "org"]);
    expect(Object.keys(out.projects[0])).toEqual([
      "ref",
      "name",
      "region",
      "org",
    ]);
    await expect(
      projectsCommand(["list", "--fields", "nope,bad"]),
    ).rejects.toThrow(/Unknown columns/);
    await expect(projectsCommand(["list", "--fields", "nope"])).rejects.toThrow(
      /Unknown column:/,
    );
  });

  it("uses a project's ref field when id is absent", async () => {
    json.mockResolvedValue([{ ref: "p9", name: "R", region: "x" }] as never);
    const out: any = await projectsCommand(["list"]);
    expect(out.projects[0].ref).toBe("p9");
  });

  it("gives a definitive empty state", async () => {
    json.mockResolvedValue([] as never);
    const out: any = await projectsCommand(["list"]);
    expect(out.projects).toEqual([]);
    expect(out.result).toContain("no Supabase projects");
  });
});

describe("projects get", () => {
  it("requires a ref", async () => {
    await expect(projectsCommand(["get"])).rejects.toBeInstanceOf(AxiError);
  });

  it("returns project metadata, connection info, and keys", async () => {
    json.mockImplementation(async (args: string[]) => {
      if (args[1] === "api-keys")
        return [
          { name: "anon", api_key: "anon-key" },
          { name: "service_role", api_key: "svc-key-tail" },
        ];
      return projects;
    });
    const out: any = await projectsCommand(["get", "p1"]);
    expect(out.project).toMatchObject({ ref: "p1", name: "App", org: "org1" });
    expect(out.connection.url).toBe("https://p1.supabase.co");
    expect(out.api_keys).toEqual([
      { name: "anon", class: "public", key: "anon-key" },
      { name: "service_role", class: "secret", key: "hidden (\u2026tail)" },
    ]);
    expect(out.revealed).toBeUndefined();
    expect(out.help.some((h: string) => h.includes("--reveal-secrets"))).toBe(
      true,
    );
  });

  it("never renders a secret key value by default", async () => {
    json.mockImplementation(async (args: string[]) => {
      if (args[1] === "api-keys")
        return [
          { name: "anon", api_key: "anon-key" },
          { name: "service_role", api_key: "SVC-SECRET-VALUE" },
          { name: "secret", api_key: "sb_secret_9999" },
        ];
      return projects;
    });
    const c = capture();
    await main({ argv: ["projects", "get", "p1"], stdout: c.stdout });
    const rendered = c.read();
    // Public key and both secret identities are still there...
    expect(rendered).toContain("anon-key");
    expect(rendered).toContain("service_role,secret,hidden (\u2026ALUE)");
    expect(rendered).toContain("secret,secret,hidden (\u20269999)");
    // ...but neither usable secret value is anywhere in what we printed.
    expect(rendered).not.toContain("SVC-SECRET-VALUE");
    expect(rendered).not.toContain("sb_secret_9999");
  });

  it("reveals secret values only with --reveal-secrets", async () => {
    json.mockImplementation(async (args: string[]) => {
      if (args[1] === "api-keys")
        return [
          { name: "publishable", api_key: "pub-key" },
          { name: "service_role", api_key: "SVC-SECRET-VALUE" },
        ];
      return projects;
    });
    const out: any = await projectsCommand(["get", "p1", "--reveal-secrets"]);
    expect(out.api_keys).toEqual([
      { name: "publishable", class: "public", key: "pub-key" },
      { name: "service_role", class: "secret", key: "SVC-SECRET-VALUE" },
    ]);
    expect(out.revealed).toContain("1 secret key value(s) printed in full");
    expect(out.help.some((h: string) => h.includes("--reveal-secrets"))).toBe(
      false,
    );
  });

  it("treats an unrecognised key name as secret", async () => {
    json.mockImplementation(async (args: string[]) => {
      if (args[1] === "api-keys")
        return [
          { name: "quantum_key_v3", api_key: "FUTURE-SECRET" },
          { name: undefined, api_key: undefined },
        ];
      return projects;
    });
    const out: any = await projectsCommand(["get", "p1"]);
    expect(out.api_keys).toEqual([
      {
        name: "quantum_key_v3",
        class: "secret",
        key: "hidden (\u2026CRET)",
      },
      { name: undefined, class: "secret", key: "hidden" },
    ]);
  });

  it("classifies new-model keys by type, not by their shared `default` name", async () => {
    json.mockImplementation(async (args: string[]) => {
      if (args[1] === "api-keys")
        return [
          { name: "anon", type: "legacy", api_key: "anon-key" },
          { name: "service_role", type: "legacy", api_key: "SVC-SECRET-VALUE" },
          { name: "default", type: "publishable", api_key: "sb_publishable_1" },
          { name: "default", type: "secret", api_key: "sb_secret_9999" },
        ];
      return projects;
    });
    const c = capture();
    await main({ argv: ["projects", "get", "p1"], stdout: c.stdout });
    const rendered = c.read();
    expect(rendered).toContain("anon,public,anon-key");
    expect(rendered).toContain("default,public,sb_publishable_1");
    expect(rendered).toContain("default,secret,hidden (\u20269999)");
    expect(rendered).toContain("service_role,secret,hidden (\u2026ALUE)");
    expect(rendered).not.toContain("SVC-SECRET-VALUE");
    expect(rendered).not.toContain("sb_secret_9999,");
  });

  it("never renders a secret-typed key renamed `anon` or `publishable`", async () => {
    json.mockImplementation(async (args: string[]) => {
      if (args[1] === "api-keys")
        return [
          { name: "anon", type: "secret", api_key: "RENAMED-SECRET-VALUE" },
          {
            name: "publishable",
            type: "quantum_v3",
            api_key: "FUTURE-SECRET-VALUE",
          },
        ];
      return projects;
    });
    const c = capture();
    await main({ argv: ["projects", "get", "p1"], stdout: c.stdout });
    const rendered = c.read();
    expect(rendered).toContain("anon,secret,hidden (\u2026ALUE)");
    expect(rendered).toContain("publishable,secret,hidden (\u2026ALUE)");
    expect(rendered).not.toContain("RENAMED-SECRET-VALUE");
    expect(rendered).not.toContain("FUTURE-SECRET-VALUE");
  });

  it("falls back to just the ref when the project is not in the list", async () => {
    json.mockImplementation(async (args: string[]) =>
      args[1] === "api-keys" ? [] : [],
    );
    const out: any = await projectsCommand(["get", "unknown"]);
    expect(out.project).toEqual({ ref: "unknown" });
    expect(out.api_keys).toEqual([]);
    expect(out.revealed).toBeUndefined();
    expect(out.help.some((h: string) => h.includes("--reveal-secrets"))).toBe(
      false,
    );
  });
});

describe("projects create", () => {
  it("validates the required name and flags", async () => {
    await expect(projectsCommand(["create"])).rejects.toBeInstanceOf(AxiError);
    await expect(
      projectsCommand(["create", "app", "--org", "o"]),
    ).rejects.toBeInstanceOf(AxiError);
  });

  it("provisions a project and forwards the flags", async () => {
    text.mockResolvedValue("Created project app (ref p2)\n");
    const out: any = await projectsCommand([
      "create",
      "app",
      "--org",
      "o1",
      "--db-password",
      "pw",
      "--region",
      "us-east-1",
    ]);
    expect(text.mock.calls[0][0]).toEqual([
      "projects",
      "create",
      "app",
      "--org-id",
      "o1",
      "--db-password",
      "pw",
      "--region",
      "us-east-1",
    ]);
    expect(out.created).toBe("app");
    expect(out.output).toContain("Created project");
  });
});
