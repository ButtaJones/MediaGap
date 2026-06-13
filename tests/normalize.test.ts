import { describe, expect, it } from "vitest";
import { normalizeTitle, yearFromDate } from "../src/server/services/normalize";

describe("normalizeTitle", () => {
  it("normalizes punctuation, articles, and accents", () => {
    expect(normalizeTitle("The Amélie & Friends")).toBe("amelie and friends");
  });
});

describe("yearFromDate", () => {
  it("extracts release year safely", () => {
    expect(yearFromDate("1995-12-15")).toBe(1995);
    expect(yearFromDate(null)).toBeNull();
  });
});
