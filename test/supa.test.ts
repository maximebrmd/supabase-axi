import { afterEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

import {
  mapMgmtError,
  mapSupaError,
  mgmtApi,
  mgmtAuthError,
  supaJson,
  supaNotInstalledError,
  supaText,
} from "../src/supa.js";
import { AxiError } from "../src/errors.js";

interface ExecResult {
  error?: (Error & { code?: string | number }) | null;
  stdout?: string;
  stderr?: string;
}

/** Make the mocked execFile invoke its callback with a controlled result. */
function mockExec({ error = null, stdout = "", stderr = "" }: ExecResult) {
  const end = vi.fn();
  execFileMock.mockImplementation(
    (
      _file: string,
      _args: string[],
      _opts: unknown,
      cb: (e: unknown, o: string, s: string) => void,
    ) => {
      cb(error, stdout, stderr);
      return { stdin: { end } };
    },
  );
  return { end };
}

afterEach(() => vi.clearAllMocks());

describe("supaText / run", () => {
  it("returns raw stdout and forwards args to supabase", async () => {
    mockExec({ stdout: "applied 3 migrations\n" });
    const out = await supaText(["db", "push"]);
    expect(out).toBe("applied 3 migrations\n");
    expect(execFileMock.mock.calls[0][0]).toBe("supabase");
    expect(execFileMock.mock.calls[0][1]).toEqual(["db", "push"]);
  });

  it("closes stdin to avoid hanging", async () => {
    const { end } = mockExec({ stdout: "ok" });
    await supaText(["status"]);
    expect(end).toHaveBeenCalled();
  });

  it("throws SUPABASE_NOT_INSTALLED when the binary is missing", async () => {
    mockExec({ error: Object.assign(new Error("nope"), { code: "ENOENT" }) });
    const err = await supaText(["status"]).catch((e) => e);
    expect(err).toBeInstanceOf(AxiError);
    expect(err.code).toBe("SUPABASE_NOT_INSTALLED");
  });

  it("maps a numeric non-zero exit via stderr", async () => {
    mockExec({
      error: Object.assign(new Error("x"), { code: 1 }),
      stderr: "error: Project not found",
    });
    const err = await supaText(["projects", "get", "x"]).catch((e) => e);
    expect(err.code).toBe("OBJECT_NOT_FOUND");
  });

  it("falls back to stdout when stderr is empty on failure", async () => {
    mockExec({
      error: Object.assign(new Error("x"), { code: 1 }),
      stdout: "Cannot connect to the Docker daemon",
      stderr: "",
    });
    const err = await supaText(["start"]).catch((e) => e);
    expect(err.code).toBe("DOCKER_REQUIRED");
  });

  it("treats a non-numeric exit code as a generic failure", async () => {
    mockExec({
      error: Object.assign(new Error("killed"), { code: "SIGTERM" }),
      stderr: "error: something broke",
    });
    const err = await supaText(["db", "push"]).catch((e) => e);
    expect(err.code).toBe("SUPABASE_ERROR");
  });

  it("tolerates a child process with no stdin handle", async () => {
    execFileMock.mockImplementation(
      (
        _file: string,
        _args: string[],
        _opts: unknown,
        cb: (e: unknown, o: string, s: string) => void,
      ) => {
        cb(null, "ok", "");
        return {};
      },
    );
    expect(await supaText(["status"])).toBe("ok");
  });

  it("defaults missing stdout/stderr to empty strings", async () => {
    execFileMock.mockImplementation(
      (
        _file: string,
        _args: string[],
        _opts: unknown,
        cb: (e: unknown, o?: string, s?: string) => void,
      ) => {
        cb(null, undefined, undefined);
        return { stdin: { end: vi.fn() } };
      },
    );
    expect(await supaText(["status"])).toBe("");
  });
});

describe("supaJson", () => {
  it("appends --output-format json and parses stdout", async () => {
    mockExec({ stdout: '[{"id":"p1"}]' });
    const out = await supaJson(["projects", "list"]);
    expect(out).toEqual([{ id: "p1" }]);
    expect(execFileMock.mock.calls[0][1]).toEqual([
      "projects",
      "list",
      "--output-format",
      "json",
    ]);
  });

  it("returns undefined when stdout is blank", async () => {
    mockExec({ stdout: "   \n" });
    expect(await supaJson(["secrets", "list"])).toBeUndefined();
  });

  it("throws on unparseable JSON", async () => {
    mockExec({ stdout: "not json" });
    const err = await supaJson(["projects", "list"]).catch((e) => e);
    expect(err).toBeInstanceOf(AxiError);
    expect(err.code).toBe("SUPABASE_ERROR");
    expect(err.message).toMatch(/Unexpected supabase output/);
  });
});

describe("mapSupaError", () => {
  it("flags auth failures with login guidance", () => {
    const e = mapSupaError(
      "error: Access token not found, run supabase login",
      1,
    );
    expect(e.code).toBe("AUTH_REQUIRED");
    expect(e.suggestions.join(" ")).toMatch(/supabase login/);
  });

  it("flags an unlinked project", () => {
    const e = mapSupaError(
      "Cannot find project ref. Have you run supabase link?",
      1,
    );
    expect(e.code).toBe("NOT_LINKED");
  });

  it("flags missing Docker", () => {
    expect(mapSupaError("Is the docker daemon running?", 1).code).toBe(
      "DOCKER_REQUIRED",
    );
  });

  it("flags not-found and validation errors", () => {
    expect(mapSupaError("error: branch does not exist", 1).code).toBe(
      "OBJECT_NOT_FOUND",
    );
    expect(mapSupaError("error: region must be provided", 1).code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("uses the first line for an unclassified error", () => {
    const e = mapSupaError("weird unexpected output", 2);
    expect(e.code).toBe("SUPABASE_ERROR");
    expect(e.message).toBe("weird unexpected output");
    expect(e.suggestions).toEqual([]);
  });

  it("falls back to the exit code when stderr is empty", () => {
    expect(mapSupaError("", 7).message).toBe("supabase exited with code 7");
  });
});

describe("supaNotInstalledError", () => {
  it("carries install + login suggestions", () => {
    const e = supaNotInstalledError();
    expect(e.code).toBe("SUPABASE_NOT_INSTALLED");
    expect(e.suggestions.join(" ")).toMatch(/brew install/);
  });
});

describe("mgmtApi", () => {
  const fetchMock = vi.fn();
  function withToken(token?: string) {
    if (token === undefined) delete process.env.SUPABASE_ACCESS_TOKEN;
    else process.env.SUPABASE_ACCESS_TOKEN = token;
  }
  afterEach(() => {
    delete process.env.SUPABASE_ACCESS_TOKEN;
    vi.unstubAllGlobals();
  });

  function stubFetch(res: { ok: boolean; status?: number; text: string }) {
    fetchMock.mockResolvedValue({
      ok: res.ok,
      status: res.status ?? (res.ok ? 200 : 400),
      text: async () => res.text,
    });
    vi.stubGlobal("fetch", fetchMock);
  }

  it("throws AUTH_REQUIRED when no token is set", async () => {
    withToken(undefined);
    const err = await mgmtApi("v1/organizations").catch((e) => e);
    expect(err).toBeInstanceOf(AxiError);
    expect(err.code).toBe("AUTH_REQUIRED");
  });

  it("performs an authenticated GET and parses JSON", async () => {
    withToken("tok");
    stubFetch({ ok: true, text: '[{"id":"o1"}]' });
    const out = await mgmtApi("/v1/organizations");
    expect(out).toEqual([{ id: "o1" }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.supabase.com/v1/organizations");
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(init.body).toBeUndefined();
  });

  it("sends a JSON body for POST and sets content-type", async () => {
    withToken("tok");
    stubFetch({ ok: true, text: "{}" });
    await mgmtApi("v1/projects/x/secrets", {
      method: "post",
      body: [{ name: "K", value: "v" }],
    });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe('[{"name":"K","value":"v"}]');
  });

  it("returns {} for an empty 2xx body", async () => {
    withToken("tok");
    stubFetch({ ok: true, text: "" });
    expect(await mgmtApi("v1/projects/x", { method: "delete" })).toEqual({});
  });

  it("returns text for a non-JSON 2xx body", async () => {
    withToken("tok");
    stubFetch({ ok: true, text: "plain ok" });
    expect(await mgmtApi("v1/health")).toBe("plain ok");
  });

  it("maps a non-2xx response to a structured error", async () => {
    withToken("tok");
    stubFetch({ ok: false, status: 404, text: '{"message":"not found"}' });
    const err = await mgmtApi("v1/projects/missing").catch((e) => e);
    expect(err.code).toBe("OBJECT_NOT_FOUND");
    expect(err.message).toBe("not found");
  });
});

describe("mapMgmtError", () => {
  it("maps 401/403 to AUTH_REQUIRED", () => {
    expect(mapMgmtError(401, { message: "no" }).code).toBe("AUTH_REQUIRED");
    expect(mapMgmtError(403, {}).code).toBe("AUTH_REQUIRED");
  });

  it("maps 404 to OBJECT_NOT_FOUND", () => {
    expect(mapMgmtError(404, { error: "gone" }).message).toBe("gone");
  });

  it("maps other 4xx to VALIDATION_ERROR", () => {
    expect(mapMgmtError(422, "bad input").code).toBe("VALIDATION_ERROR");
    expect(mapMgmtError(422, "bad input").message).toBe("bad input");
  });

  it("falls back for 5xx and bodyless responses", () => {
    const e = mapMgmtError(500, null);
    expect(e.code).toBe("SUPABASE_ERROR");
    expect(e.message).toMatch(/500/);
  });
});

describe("mgmtAuthError", () => {
  it("explains how to get a token", () => {
    expect(mgmtAuthError().suggestions.join(" ")).toMatch(
      /SUPABASE_ACCESS_TOKEN/,
    );
  });
});
