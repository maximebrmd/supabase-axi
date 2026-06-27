import { describe, expect, it } from "vitest";
import { asArray, preview, shortDate } from "../src/format.js";

describe("shortDate", () => {
  it("slices an ISO timestamp to a date", () => {
    expect(shortDate("2026-01-02T03:04:05Z")).toBe("2026-01-02");
  });
  it("returns empty string when absent", () => {
    expect(shortDate(undefined)).toBe("");
  });
});

describe("preview", () => {
  it("returns full text and a line count when short", () => {
    const p = preview("a\nb\nc");
    expect(p).toEqual({ text: "a\nb\nc", lines: 3, truncated: false });
  });

  it("reports zero lines for blank output", () => {
    expect(preview("   \n  ").lines).toBe(0);
  });

  it("truncates long output and records the original length", () => {
    const raw = "x".repeat(50);
    const p = preview(raw, 10);
    expect(p.truncated).toBe(true);
    expect(p.text).toHaveLength(10);
    expect(p.chars).toBe(50);
  });
});

describe("asArray", () => {
  it("passes arrays through and coerces non-arrays to []", () => {
    expect(asArray([1, 2])).toEqual([1, 2]);
    expect(asArray(null)).toEqual([]);
    expect(asArray({ a: 1 })).toEqual([]);
  });
});
