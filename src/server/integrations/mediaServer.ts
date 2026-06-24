import type {
  AppSettings,
  MediaServerEpisode,
  MediaServerLibrary,
  MediaServerMovie,
  MediaServerSeason,
  MediaServerShow,
  MediaServerType
} from "../../shared/types.js";
import { mediaServerLabel } from "../../shared/types.js";

export interface MediaServerConnectionResult {
  name: string;
  version?: string | null;
}

export interface MediaServerScanResult {
  movies: MediaServerMovie[];
  sections: string[];
}

/** Why a show was dropped during a TV scan (reported back, not stored). */
export interface MediaServerTvSkip {
  title: string;
  reason: "unsupported-numbering" | "no-episodes";
}

// Result of a TV library scan: normalized owned-side shows/seasons/episodes (excluding season 0 and
// future-dated episodes per v1 scope), plus tallies/skip reasons for reporting. TMDb ids on the
// shows may still be null here — id resolution happens after the adapter returns (see tmdb.ts).
export interface MediaServerTvScanResult {
  shows: MediaServerShow[];
  seasons: MediaServerSeason[];
  episodes: MediaServerEpisode[];
  sections: string[];
  skipped: MediaServerTvSkip[];
  /** Future-dated owned episodes excluded as not-yet-released, across all shows. */
  futureEpisodesExcluded: number;
}

export interface MediaServer {
  type: MediaServerType;
  displayName: string;
  testConnection(): Promise<MediaServerConnectionResult>;
  getMovieLibraries(): Promise<MediaServerLibrary[]>;
  scanMovies(libraryIds?: string[]): Promise<MediaServerScanResult>;
  /** TV (Phase 1): read TV libraries and scan them, independently of the movie scan. */
  getTvLibraries(): Promise<MediaServerLibrary[]>;
  scanTv(libraryIds?: string[]): Promise<MediaServerTvScanResult>;
  /**
   * The server's own identifier used to build deep-links into its web UI:
   * Plex's machineIdentifier, or the Jellyfin/Emby System/Info Id. Returns null
   * if it cannot be determined.
   */
  getServerId(): Promise<string | null>;
}

export function activeMediaServerLabel(settings: Pick<AppSettings, "mediaServerType">): string {
  return mediaServerLabel(settings.mediaServerType);
}
