import { describe, expect, it } from "vitest";
import { classifyEpisode, normalizeShowEpisodes } from "../src/server/services/tvFilter";

const TODAY = "2026-06-24";

describe("classifyEpisode", () => {
  it("accepts a normal aired episode", () => {
    expect(classifyEpisode({ ratingKey: "1", seasonNumber: 1, episodeNumber: 3, airDate: "2020-01-01" }, TODAY)).toEqual({
      ok: true,
      seasonNumber: 1,
      episodeNumber: 3
    });
  });

  it("excludes season 0 specials", () => {
    expect(classifyEpisode({ ratingKey: "1", seasonNumber: 0, episodeNumber: 1, airDate: "2020-01-01" }, TODAY)).toEqual({
      ok: false,
      reason: "season-zero"
    });
  });

  it("flags missing/unmappable numbering", () => {
    expect(classifyEpisode({ ratingKey: "1", seasonNumber: null, episodeNumber: 5, airDate: "2020-01-01" }, TODAY)).toEqual({
      ok: false,
      reason: "bad-numbering"
    });
    expect(classifyEpisode({ ratingKey: "1", seasonNumber: 1, episodeNumber: null, airDate: "2020-01-01" }, TODAY)).toEqual({
      ok: false,
      reason: "bad-numbering"
    });
  });

  it("excludes future-dated (not-yet-released) episodes", () => {
    expect(classifyEpisode({ ratingKey: "1", seasonNumber: 2, episodeNumber: 1, airDate: "2099-01-01" }, TODAY)).toEqual({
      ok: false,
      reason: "future"
    });
  });

  it("keeps owned episodes with a null air date (metadata gap, file still owned)", () => {
    expect(classifyEpisode({ ratingKey: "1", seasonNumber: 1, episodeNumber: 1, airDate: null }, TODAY)).toEqual({
      ok: true,
      seasonNumber: 1,
      episodeNumber: 1
    });
  });
});

describe("normalizeShowEpisodes", () => {
  it("builds season counts, dedupes versions, and tallies exclusions", () => {
    const result = normalizeShowEpisodes(
      "show-1",
      "plex",
      [
        { ratingKey: "e1", seasonNumber: 1, episodeNumber: 1, airDate: "2020-01-01" },
        { ratingKey: "e1-dup", seasonNumber: 1, episodeNumber: 1, airDate: "2020-01-01" }, // duplicate version
        { ratingKey: "e2", seasonNumber: 1, episodeNumber: 2, airDate: "2020-01-08" },
        { ratingKey: "e3", seasonNumber: 2, episodeNumber: 1, airDate: "2021-01-01" },
        { ratingKey: "s0", seasonNumber: 0, episodeNumber: 1, airDate: "2019-12-01" }, // special
        { ratingKey: "future", seasonNumber: 2, episodeNumber: 2, airDate: "2099-01-01" }, // unaired
        { ratingKey: "weird", seasonNumber: null, episodeNumber: null, airDate: "2020-01-01" } // bad numbering
      ],
      TODAY
    );

    expect(result.episodes).toHaveLength(3);
    expect(result.seasons).toEqual([
      { showRatingKey: "show-1", mediaServerType: "plex", seasonNumber: 1, ownedEpisodeCount: 2 },
      { showRatingKey: "show-1", mediaServerType: "plex", seasonNumber: 2, ownedEpisodeCount: 1 }
    ]);
    expect(result.futureExcluded).toBe(1);
    expect(result.badNumbering).toBe(1);
    expect(result.seasonZeroExcluded).toBe(1);
  });

  it("returns empty arrays for a show with no usable episodes", () => {
    const result = normalizeShowEpisodes("show-2", "jellyfin", [
      { ratingKey: "s0", seasonNumber: 0, episodeNumber: 1, airDate: "2019-12-01" }
    ], TODAY);
    expect(result.episodes).toHaveLength(0);
    expect(result.seasons).toHaveLength(0);
  });
});
