import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supa.js", () => ({
  supaText: vi.fn(),
  mgmtApi: vi.fn(),
  linkedProjectRef: vi.fn(),
  notLinkedError: vi.fn(),
}));

import { dbCommand } from "../src/commands/db.js";
import {
  supaText,
  mgmtApi,
  linkedProjectRef,
  notLinkedError,
} from "../src/supa.js";
import { AxiError } from "../src/errors.js";

const text = vi.mocked(supaText);
const api = vi.mocked(mgmtApi);
const linked = vi.mocked(linkedProjectRef);
const notLinked = vi.mocked(notLinkedError);
notLinked.mockImplementation(
  () => new AxiError("not linked", "NOT_LINKED", ["link it"]),
);
afterEach(() => vi.clearAllMocks());

describe("dbCommand", () => {
  it("rejects a missing or unknown subcommand", async () => {
    await expect(dbCommand([])).rejects.toBeInstanceOf(AxiError);
    await expect(dbCommand(["frob"])).rejects.toBeInstanceOf(AxiError);
  });

  it("runs push, forwards flags, and previews the output", async () => {
    text.mockResolvedValue("Applying migration 0001...\nDone\n");
    const out: any = await dbCommand(["push", "--dry-run"]);
    expect(text.mock.calls[0][0]).toEqual(["db", "push", "--dry-run"]);
    expect(out.db).toBe("push");
    expect(out.lines).toBe(2);
    expect(out.help[0]).toContain("migration list");
  });

  it("reports a no-output state for an empty diff", async () => {
    text.mockResolvedValue("\n");
    const out: any = await dbCommand(["diff"]);
    expect(out.output).toContain("no output");
  });

  it("truncates a large dump and records the char count", async () => {
    text.mockResolvedValue("x".repeat(2000));
    const out: any = await dbCommand(["dump"]);
    expect(out.truncated).toBe(true);
    expect(out.chars).toBe(2000);
    expect(out.output).toHaveLength(1500);
    expect(out.help[0]).toContain("--full");
  });

  it("returns the full dump with --full and strips the flag", async () => {
    text.mockResolvedValue("x".repeat(2000));
    const out: any = await dbCommand(["dump", "--data-only", "--full"]);
    expect(text.mock.calls[0][0]).toEqual(["db", "dump", "--data-only"]);
    expect(out.truncated).toBeUndefined();
    expect(out.output).toHaveLength(2000);
    expect(out.help[0]).not.toContain("--full");
  });

  it("suggests db query in the unknown-subcommand help", async () => {
    const err: AxiError = await dbCommand(["frob"]).catch((e) => e);
    expect(err.suggestions.join(" ")).toContain("db query");
  });
});

describe("dbCommand query", () => {
  it("runs SQL through the read-only endpoint and returns rows", async () => {
    linked.mockReturnValue("abcd");
    api.mockResolvedValue([{ id: 1, name: "a" }]);
    const out: any = await dbCommand(["query", "  select * from t  "]);
    expect(api.mock.calls[0][0]).toBe(
      "v1/projects/abcd/database/query/read-only",
    );
    expect(api.mock.calls[0][1]).toEqual({
      method: "post",
      body: { query: "select * from t" },
    });
    expect(out).toMatchObject({ db: "query", ref: "abcd", rows: 1 });
    expect(out.result).toEqual([{ id: 1, name: "a" }]);
    expect(out.truncated).toBeUndefined();
    expect(out.help.join(" ")).toContain("--write");
  });

  it("still requires SQL text", async () => {
    const err: AxiError = await dbCommand(["query", "   "]).catch((e) => e);
    expect(err).toBeInstanceOf(AxiError);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(api).not.toHaveBeenCalled();
  });

  it("treats a missing SQL positional as empty", async () => {
    await expect(dbCommand(["query"])).rejects.toBeInstanceOf(AxiError);
  });

  it("errors with NOT_LINKED when no ref resolves", async () => {
    linked.mockReturnValue(null);
    const err: AxiError = await dbCommand(["query", "select 1"]).catch(
      (e) => e,
    );
    expect(err.code).toBe("NOT_LINKED");
    expect(notLinked).toHaveBeenCalled();
    expect(api).not.toHaveBeenCalled();
  });

  it("prefers an explicit --project-ref over the linked ref", async () => {
    linked.mockReturnValue("linked-ref");
    api.mockResolvedValue([]);
    await dbCommand(["query", "select 1", "--project-ref", "flag-ref"]);
    expect(api.mock.calls[0][0]).toBe(
      "v1/projects/flag-ref/database/query/read-only",
    );
    expect(linked).not.toHaveBeenCalled();
  });

  it("drops trailing semicolons for the read-only endpoint", async () => {
    linked.mockReturnValue("abcd");
    api.mockResolvedValue([]);
    await dbCommand(["query", "select 1;\n;; "]);
    expect(api.mock.calls[0][1]).toEqual({
      method: "post",
      body: { query: "select 1" },
    });
  });

  it("rejects SQL that is only semicolons", async () => {
    const err: AxiError = await dbCommand(["query", " ; ; "]).catch((e) => e);
    expect(err).toBeInstanceOf(AxiError);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(api).not.toHaveBeenCalled();
  });

  it("sends --write SQL unchanged to the read-write endpoint", async () => {
    linked.mockReturnValue("abcd");
    api.mockResolvedValue([{ id: 1 }]);
    const out: any = await dbCommand([
      "query",
      "  update public.t set x = 1;  ",
      "--write",
    ]);
    expect(api.mock.calls[0][0]).toBe("v1/projects/abcd/database/query");
    expect(api.mock.calls[0][1]).toEqual({
      method: "post",
      body: { query: "update public.t set x = 1;" },
    });
    expect(out.help.join(" ")).not.toContain("Read-only query");
    expect(out.help.join(" ")).toContain("migration");
  });

  it("maps a refused write to a structured READ_ONLY error", async () => {
    linked.mockReturnValue("abcd");
    api.mockRejectedValue(
      new AxiError(
        "permission denied for schema public",
        "VALIDATION_ERROR",
        [],
      ),
    );
    const err: AxiError = await dbCommand([
      "query",
      "create table x (id int)",
    ]).catch((e) => e);
    expect(err).toBeInstanceOf(AxiError);
    expect(err.code).toBe("READ_ONLY");
    expect(err.message).toContain("permission denied for schema public");
    expect(err.suggestions.join(" ")).toContain("--write");
  });

  it("maps a Postgres read-only transaction refusal", async () => {
    linked.mockReturnValue("abcd");
    api.mockRejectedValue(
      new AxiError(
        "cannot execute UPDATE in a read-only transaction",
        "SUPABASE_ERROR",
        [],
      ),
    );
    const err: AxiError = await dbCommand([
      "query",
      "update public.t set x = 1",
    ]).catch((e) => e);
    expect(err.code).toBe("READ_ONLY");
  });

  it("maps an endpoint that only allows SELECT statements", async () => {
    linked.mockReturnValue("abcd");
    api.mockRejectedValue(
      new AxiError("Only SELECT statements are allowed", "SUPABASE_ERROR", []),
    );
    const err: AxiError = await dbCommand([
      "query",
      "update public.t set x = 1",
    ]).catch((e) => e);
    expect(err.code).toBe("READ_ONLY");
  });

  it("maps a writes-are-not-allowed refusal", async () => {
    linked.mockReturnValue("abcd");
    api.mockRejectedValue(
      new AxiError(
        "writes are not allowed in read-only mode",
        "SUPABASE_ERROR",
        [],
      ),
    );
    const err: AxiError = await dbCommand([
      "query",
      "update public.t set x = 1",
    ]).catch((e) => e);
    expect(err.code).toBe("READ_ONLY");
  });

  it("keeps non-write query failures unchanged", async () => {
    linked.mockReturnValue("abcd");
    api.mockRejectedValue(
      new AxiError('syntax error at or near "selct"', "VALIDATION_ERROR", []),
    );
    const err: AxiError = await dbCommand(["query", "selct 1"]).catch((e) => e);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toBe('syntax error at or near "selct"');
    expect(err.suggestions).toEqual([]);
  });

  it("rethrows non-AxiError read-only failures", async () => {
    linked.mockReturnValue("abcd");
    api.mockRejectedValue(new Error("socket hang up"));
    await expect(dbCommand(["query", "select 1"])).rejects.toThrow(
      "socket hang up",
    );
  });

  it("keeps --write failures unchanged", async () => {
    linked.mockReturnValue("abcd");
    api.mockRejectedValue(
      new AxiError("permission denied for table t", "AUTH_REQUIRED", []),
    );
    const err: AxiError = await dbCommand([
      "query",
      "update public.t set x = 1",
      "--write",
    ]).catch((e) => e);
    expect(err.code).toBe("AUTH_REQUIRED");
  });

  it("reports a definitive empty state for 0 rows", async () => {
    linked.mockReturnValue("abcd");
    api.mockResolvedValue([]);
    const out: any = await dbCommand(["query", "select 0"]);
    expect(out).toMatchObject({ rows: 0, result: "0 rows" });
    expect(out.truncated).toBeUndefined();
    expect(out.help.join(" ")).toContain("migration");
  });

  it("tolerates a non-array Management API response", async () => {
    linked.mockReturnValue("abcd");
    api.mockResolvedValue({ unexpected: true });
    const out: any = await dbCommand(["query", "select 1"]);
    expect(out).toMatchObject({ rows: 0, result: "0 rows" });
  });

  it("caps rows by default and flags truncation", async () => {
    linked.mockReturnValue("abcd");
    api.mockResolvedValue(Array.from({ length: 60 }, (_, i) => ({ i })));
    const out: any = await dbCommand(["query", "select * from t"]);
    expect(out.rows).toBe(60);
    expect(out.shown).toBe(50);
    expect(out.result).toHaveLength(50);
    expect(out.truncated).toBe(true);
    expect(out.help[0]).toContain("Showing 50 of 60 rows");
  });

  it("returns every row with --full", async () => {
    linked.mockReturnValue("abcd");
    api.mockResolvedValue(Array.from({ length: 60 }, (_, i) => ({ i })));
    const out: any = await dbCommand(["query", "select * from t", "--full"]);
    expect(out.result).toHaveLength(60);
    expect(out.truncated).toBeUndefined();
    expect(out.shown).toBeUndefined();
  });

  it("caps rows to an explicit --limit", async () => {
    linked.mockReturnValue("abcd");
    api.mockResolvedValue(Array.from({ length: 60 }, (_, i) => ({ i })));
    const out: any = await dbCommand([
      "query",
      "select * from t",
      "--limit",
      "5",
    ]);
    expect(out.result).toHaveLength(5);
    expect(out.shown).toBe(5);
    expect(out.truncated).toBe(true);
  });

  it("rejects a non-positive or non-integer --limit", async () => {
    linked.mockReturnValue("abcd");
    await expect(
      dbCommand(["query", "select 1", "--limit", "0"]),
    ).rejects.toBeInstanceOf(AxiError);
    await expect(
      dbCommand(["query", "select 1", "--limit", "abc"]),
    ).rejects.toBeInstanceOf(AxiError);
    expect(api).not.toHaveBeenCalled();
  });
});
