import type { MediaServerEpisode, MediaServerSeason, MediaServerType } from "../../shared/types.js";

// Pure, source-agnostic filtering of a show's owned episodes into normalized records, applying the
// v1 TV scope rules (see TASK / AGENTS): exclude season 0, exclude episodes that can't be cleanly
// mapped to (season, episode) with normal numbering, and exclude future-dated (not-yet-released)
// episodes — the owned-side analogue of the movie collections bloat filter. Kept pure so it is unit
// testable and shared by the Plex and Jellyfin/Emby adapters (reuse, don't rebuild).

export interface RawEpisode {
  /** The episode's own native id on the server. */
  ratingKey: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  /** ISO date (any precision); only the leading YYYY-MM-DD is compared. */
  airDate: string | null;
}

export type EpisodeClassification =
  | { ok: true; seasonNumber: number; episodeNumber: number }
  | { ok: false; reason: "season-zero" | "bad-numbering" | "future" };

export function classifyEpisode(episode: RawEpisode, today = isoToday()): EpisodeClassification {
  const season = episode.seasonNumber;
  const number = episode.episodeNumber;
  if (season === 0) return { ok: false, reason: "season-zero" };
  if (!isPositiveInt(season) || !isPositiveInt(number)) return { ok: false, reason: "bad-numbering" };
  const airDate = episode.airDate ? episode.airDate.slice(0, 10) : null;
  if (airDate && airDate > today) return { ok: false, reason: "future" };
  return { ok: true, seasonNumber: season, episodeNumber: number };
}

export interface NormalizedShowEpisodes {
  seasons: MediaServerSeason[];
  episodes: MediaServerEpisode[];
  /** Future-dated owned episodes that were excluded as not-yet-released. */
  futureExcluded: number;
  /** Episodes excluded because they couldn't be mapped to normal (season, episode) numbering. */
  badNumbering: number;
  /** Season-0 / specials episodes that were excluded. */
  seasonZeroExcluded: number;
}

/**
 * Normalize one show's raw owned episodes into season + episode records, deduping by
 * (season, episode) so multiple media versions of an episode never produce duplicate primary keys
 * or inflate owned counts. Returns empty arrays (with tallies) when nothing survives the filters.
 */
export function normalizeShowEpisodes(
  showRatingKey: string,
  mediaServerType: MediaServerType,
  raw: RawEpisode[],
  today = isoToday()
): NormalizedShowEpisodes {
  const byKey = new Map<string, MediaServerEpisode>();
  let futureExcluded = 0;
  let badNumbering = 0;
  let seasonZeroExcluded = 0;

  for (const episode of raw) {
    const classification = classifyEpisode(episode, today);
    if (!classification.ok) {
      if (classification.reason === "future") futureExcluded += 1;
      else if (classification.reason === "bad-numbering") badNumbering += 1;
      else seasonZeroExcluded += 1;
      continue;
    }
    const key = `${classification.seasonNumber}:${classification.episodeNumber}`;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      showRatingKey,
      mediaServerType,
      seasonNumber: classification.seasonNumber,
      episodeNumber: classification.episodeNumber,
      ratingKey: episode.ratingKey
    });
  }

  const ownedBySeason = new Map<number, number>();
  for (const episode of byKey.values()) {
    ownedBySeason.set(episode.seasonNumber, (ownedBySeason.get(episode.seasonNumber) ?? 0) + 1);
  }

  const seasons: MediaServerSeason[] = [...ownedBySeason.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([seasonNumber, ownedEpisodeCount]) => ({
      showRatingKey,
      mediaServerType,
      seasonNumber,
      ownedEpisodeCount
    }));

  return {
    seasons,
    episodes: [...byKey.values()],
    futureExcluded,
    badNumbering,
    seasonZeroExcluded
  };
}

function isPositiveInt(value: number | null): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
