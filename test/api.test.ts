import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supa.js", () => ({
  mgmtApi: vi.fn(),
  supaJson: vi.fn(),
  supaText: vi.fn(),
}));

import { apiCommand } from "../src/commands/api.js";
import { main } from "../src/cli.js";
import { mgmtApi } from "../src/supa.js";
import { AxiError } from "../src/errors.js";

const api = vi.mocked(mgmtApi);
afterEach(() => vi.clearAllMocks());

/** Collect what the CLI actually renders, so leaks are caught in the output. */
function capture() {
  let out = "";
  return {
    stdout: { write: (c: string) => ((out += c), true) },
    read: () => out,
  };
}

const API_KEYS_FIXTURE = [
  { name: "anon", type: "legacy", api_key: "fixture-public-anon-key" },
  {
    name: "service_role",
    type: "legacy",
    api_key: "FIXTURE-SERVICE-ROLE-SECRET",
  },
  { name: "default", type: "secret", api_key: "sb_secret_FIXTURE" },
];

describe("apiCommand", () => {
  it("defaults to GET and forwards the path", async () => {
    api.mockResolvedValue([{ id: "o1" }]);
    const out: any = await apiCommand(["v1/organizations"]);
    expect(api.mock.calls[0][0]).toBe("v1/organizations");
    expect(api.mock.calls[0][1]).toMatchObject({ method: "get" });
    expect(out.result).toEqual([{ id: "o1" }]);
  });

  it("accepts `<method> <path>` form with a JSON body", async () => {
    api.mockResolvedValue({});
    await apiCommand([
      "post",
      "v1/projects/x/secrets",
      "--body",
      '[{"name":"K"}]',
    ]);
    expect(api.mock.calls[0][0]).toBe("v1/projects/x/secrets");
    expect(api.mock.calls[0][1]).toMatchObject({
      method: "post",
      body: [{ name: "K" }],
    });
  });

  it("accepts --method", async () => {
    api.mockResolvedValue({});
    await apiCommand(["v1/projects/x", "--method", "DELETE"]);
    expect(api.mock.calls[0][1]).toMatchObject({ method: "delete" });
  });

  it("treats a non-method first positional as the path", async () => {
    api.mockResolvedValue({});
    await apiCommand(["v1/projects", "ignored"]);
    expect(api.mock.calls[0][0]).toBe("v1/projects");
    expect(api.mock.calls[0][1]).toMatchObject({ method: "get" });
  });

  it("requires a path", async () => {
    await expect(apiCommand([])).rejects.toBeInstanceOf(AxiError);
  });

  it("rejects an unknown method", async () => {
    await expect(
      apiCommand(["v1/projects", "--method", "fetch"]),
    ).rejects.toBeInstanceOf(AxiError);
  });

  it("rejects invalid JSON in --body", async () => {
    await expect(
      apiCommand(["post", "v1/projects", "--body", "{nope"]),
    ).rejects.toBeInstanceOf(AxiError);
  });

  it("rejects a body on a GET request", async () => {
    await expect(
      apiCommand(["v1/projects", "--body", "{}"]),
    ).rejects.toBeInstanceOf(AxiError);
    expect(api).not.toHaveBeenCalled();
  });

  it("withholds secret key values from /api-keys by default (issue #12)", async () => {
    api.mockResolvedValue(API_KEYS_FIXTURE);
    const c = capture();
    await main({ argv: ["api", "v1/projects/p1/api-keys"], stdout: c.stdout });
    const rendered = c.read();
    // The public key stays readable...
    expect(rendered).toContain("fixture-public-anon-key");
    // ...the secret ones keep only their identity suffix...
    expect(rendered).toContain("hidden (\u2026CRET)");
    expect(rendered).toContain("hidden (\u2026TURE)");
    // ...and the usable values are nowhere in what we printed.
    expect(rendered).not.toContain("FIXTURE-SERVICE-ROLE-SECRET");
    expect(rendered).not.toContain("sb_secret_FIXTURE");
  });

  it("prints the withheld count and a reveal hint", async () => {
    api.mockResolvedValue(API_KEYS_FIXTURE);
    const out: any = await apiCommand(["v1/projects/p1/api-keys"]);
    expect(out.withheld).toBe(2);
    expect(out.revealed).toBeUndefined();
    expect(out.help.some((h: string) => h.includes("--reveal-secrets"))).toBe(
      true,
    );
  });

  it("reveals values only with --reveal-secrets, plus the credential warning", async () => {
    api.mockResolvedValue(API_KEYS_FIXTURE);
    const c = capture();
    await main({
      argv: ["api", "v1/projects/p1/api-keys", "--reveal-secrets"],
      stdout: c.stdout,
    });
    const rendered = c.read();
    expect(rendered).toContain("FIXTURE-SERVICE-ROLE-SECRET");
    expect(rendered).toContain("sb_secret_FIXTURE");
    expect(rendered).toContain("2 secret value(s) printed in full above");
    expect(rendered).toContain(
      "do not paste it into logs, tickets, or transcripts",
    );
    expect(rendered).toContain("live credential");
    expect(rendered).not.toContain("withheld:");
  });

  it("adds no withholding metadata when nothing credential-shaped is present", async () => {
    api.mockResolvedValue({ id: "org1", name: "Acme" });
    const out: any = await apiCommand(["v1/organizations"]);
    expect(out.result).toEqual({ id: "org1", name: "Acme" });
    expect(out.withheld).toBeUndefined();
    expect(out.revealed).toBeUndefined();
    expect(out.help).toEqual([]);
  });

  it("masks credential-named fields on an unknown endpoint, recursively", async () => {
    api.mockResolvedValue({
      ref: "p1",
      connection_string: "postgresql://user:FIXTURE-DB-PASSWORD@db.p1",
      nested: {
        serviceToken: "FIXTURE-TOKEN",
        rows: [
          { db_password: "FIXTURE-NESTED-PASSWORD", note: "visible note" },
        ],
      },
    });
    const c = capture();
    await main({
      argv: ["api", "v1/projects/p1/config/database/postgres"],
      stdout: c.stdout,
    });
    const rendered = c.read();
    expect(rendered).not.toContain("FIXTURE-DB-PASSWORD");
    expect(rendered).not.toContain("FIXTURE-TOKEN");
    expect(rendered).not.toContain("FIXTURE-NESTED-PASSWORD");
    expect(rendered).toContain("visible note");
    expect(rendered).toContain("withheld: 3");
  });

  it("masks /secrets values by default", async () => {
    api.mockResolvedValue([
      { name: "STRIPE_KEY", value: "FIXTURE-STRIPE-SECRET" },
      { name: "SENTRY_DSN", value: "FIXTURE-SENTRY-DSN" },
    ]);
    const c = capture();
    await main({ argv: ["api", "v1/projects/p1/secrets"], stdout: c.stdout });
    const rendered = c.read();
    expect(rendered).not.toContain("FIXTURE-STRIPE-SECRET");
    expect(rendered).not.toContain("FIXTURE-SENTRY-DSN");
    expect(rendered).toContain("STRIPE_KEY");
    expect(rendered).toContain("withheld: 2");
  });

  it("still masks a secret-typed key renamed `anon`", async () => {
    api.mockResolvedValue([
      { name: "anon", type: "secret", api_key: "FIXTURE-RENAMED-SECRET" },
    ]);
    const out: any = await apiCommand(["v1/projects/p1/api-keys"]);
    expect(out.result[0].api_key).toBe("hidden (\u2026CRET)");
    expect(out.withheld).toBe(1);
  });

  it("recognises /api-keys through slashes, case, and query strings", async () => {
    api.mockResolvedValue([
      {
        name: "publishable",
        type: "publishable",
        api_key: "fixture-public-value",
      },
      { name: "default", type: "secret", api_key: "FIXTURE-SECRET-VALUE" },
    ]);
    const out: any = await apiCommand([
      "/V1/PROJECTS/p1/API-KEYS/?per_page=10",
    ]);
    expect(out.result[0].api_key).toBe("fixture-public-value");
    expect(out.result[1].api_key).toBe("hidden (\u2026ALUE)");
    expect(out.withheld).toBe(1);
  });

  it("fails closed when an unknown endpoint carries an api_key field", async () => {
    api.mockResolvedValue({ api_key: "FIXTURE-UNKNOWN" });
    const out: any = await apiCommand(["v1/organizations/o1"]);
    expect(out.result.api_key).toBe("hidden (\u2026NOWN)");
    expect(out.withheld).toBe(1);
  });

  it("withholds compound credential fields in rendered API output", async () => {
    api.mockResolvedValue({
      accesskey: "FIXTURE-ACCESS-KEY",
      clientsecret: "FIXTURE-CLIENT-SECRET",
      refreshtoken: "FIXTURE-REFRESH-TOKEN",
      masterpassword: "FIXTURE-MASTER-PASSWORD",
      metadata: { keyword: "public-search-term", label: "public-label" },
    });
    const c = capture();
    await main({ argv: ["api", "v1/organizations/o1"], stdout: c.stdout });
    const rendered = c.read();
    for (const credential of [
      "FIXTURE-ACCESS-KEY",
      "FIXTURE-CLIENT-SECRET",
      "FIXTURE-REFRESH-TOKEN",
      "FIXTURE-MASTER-PASSWORD",
    ]) {
      expect(rendered).not.toContain(credential);
    }
    expect(rendered).toContain("public-search-term");
    expect(rendered).toContain("public-label");
    expect(rendered).toContain("withheld: 4");
  });

  it("masks bare strings inside credential-named containers", async () => {
    api.mockResolvedValue({
      tokens: ["FIXTURE-TOKEN-A", "FIXTURE-TOKEN-B"],
    });
    const c = capture();
    await main({ argv: ["api", "v1/organizations/o1"], stdout: c.stdout });
    const rendered = c.read();
    expect(rendered).not.toContain("FIXTURE-TOKEN-A");
    expect(rendered).not.toContain("FIXTURE-TOKEN-B");
    expect(rendered).toContain("withheld: 2");
  });
});
