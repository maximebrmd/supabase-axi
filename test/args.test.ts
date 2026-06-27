import { describe, expect, it } from "vitest";
import {
  collectFlag,
  intFlag,
  listFlag,
  parseArgs,
  strFlag,
} from "../src/args.js";

describe("parseArgs", () => {
  it("splits positionals from flags and handles =, value, and bool forms", () => {
    const { positionals, flags } = parseArgs(
      ["get", "ref1", "--region=us", "--limit", "5", "--full"],
      ["full"],
    );
    expect(positionals).toEqual(["get", "ref1"]);
    expect(flags).toEqual({ region: "us", limit: "5", full: true });
  });

  it("treats a flag at end-of-args as boolean", () => {
    expect(parseArgs(["--dry-run"]).flags["dry-run"]).toBe(true);
  });

  it("does not consume a following flag as a value", () => {
    expect(parseArgs(["--a", "--b"]).flags).toEqual({ a: true, b: true });
  });
});

describe("strFlag / intFlag", () => {
  it("reads strings and ignores booleans", () => {
    expect(strFlag("x")).toBe("x");
    expect(strFlag(true)).toBeUndefined();
    expect(strFlag(undefined)).toBeUndefined();
  });

  it("parses ints with a fallback", () => {
    expect(intFlag("10", 1)).toBe(10);
    expect(intFlag("nope", 1)).toBe(1);
    expect(intFlag(true, 7)).toBe(7);
  });
});

describe("collectFlag", () => {
  it("collects repeated --flag value and --flag=value forms", () => {
    expect(
      collectFlag(["--set", "A=1", "--set=B=2", "--other", "x"], "set"),
    ).toEqual(["A=1", "B=2"]);
  });

  it("ignores a trailing flag with no value", () => {
    expect(collectFlag(["--set"], "set")).toEqual([]);
  });
});

describe("listFlag", () => {
  it("splits, trims, and drops empties", () => {
    expect(listFlag(" a , b ,, c ")).toEqual(["a", "b", "c"]);
    expect(listFlag(true)).toEqual([]);
  });
});
