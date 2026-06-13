import { describe, expect, it } from "vitest";
import { buildNzbHydraQuery } from "../src/server/integrations/nzbhydra";

describe("buildNzbHydraQuery", () => {
  it("includes movie, year, filters, and manual terms", () => {
    expect(buildNzbHydraQuery("Punchline", 1988, ["1080p"], ["BluRay", "REMUX"], "x265 atmos")).toBe(
      "Punchline 1988 1080p BluRay REMUX x265 atmos"
    );
  });

  it("removes punctuation from release-style title searches", () => {
    expect(buildNzbHydraQuery("You've Got Mail", 1998, ["1080p"], ["WEB-DL"], "")).toBe("Youve Got Mail 1998 1080p WEB-DL");
  });
});
