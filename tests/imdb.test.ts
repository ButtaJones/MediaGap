import { describe, expect, it } from "vitest";
import { extractImdbTitleIds } from "../src/server/integrations/tmdb";

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
