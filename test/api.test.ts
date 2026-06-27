import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supa.js", () => ({ mgmtApi: vi.fn() }));

import { apiCommand } from "../src/commands/api.js";
import { mgmtApi } from "../src/supa.js";
import { AxiError } from "../src/errors.js";

const api = vi.mocked(mgmtApi);
afterEach(() => vi.clearAllMocks());

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
});
