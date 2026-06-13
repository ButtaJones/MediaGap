import { describe, expect, it } from "vitest";
import { extractImdbListEntries, extractImdbTitleIds } from "../src/server/integrations/tmdb";

describe("extractImdbTitleIds", () => {
  it("dedupes normal and escaped IMDb title links in page order", () => {
    const html = String.raw`
      <a href="/title/tt0111161/">The Shawshank Redemption</a>
      {"url":"\/title\/tt0068646\/"}
      Const,Title
      tt0468569,The Dark Knight
      <a href="/title/tt0111161/">Duplicate</a>
    `;

    expect(extractImdbTitleIds(html)).toEqual(["tt0111161", "tt0068646", "tt0468569"]);
  });
});

describe("extractImdbListEntries", () => {
  it("parses copied IMDb chart text without a CSV export", () => {
    const text = `
      IMDb Charts
      Top 250 Movies
      1. The Shawshank Redemption
      1994
      2h 22m
      9.3 (3M)
      2. The Godfather
      1972
      2h 55m
      9.2 (2.1M)
    `;

    expect(extractImdbListEntries(text)).toEqual([
      {
        title: "The Shawshank Redemption",
        year: 1994,
        imdbRating: 9.3,
        imdbVotes: 3000000,
        rank: 1
      },
      {
        title: "The Godfather",
        year: 1972,
        imdbRating: 9.2,
        imdbVotes: 2100000,
        rank: 2
      }
    ]);
  });

  it("parses title and year when they are on the same copied line", () => {
    const text = `
      1. A Soldier's Story (1984)
      2. For Queen & Country 1988
    `;

    expect(extractImdbListEntries(text).map(({ title, year, rank }) => ({ title, year, rank }))).toEqual([
      { title: "A Soldier's Story", year: 1984, rank: 1 },
      { title: "For Queen & Country", year: 1988, rank: 2 }
    ]);
  });
});
