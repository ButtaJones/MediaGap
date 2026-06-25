export const QUALITY_FILTERS = ["SD", "720p", "1080p", "4K"] as const;
export const SOURCE_FILTERS = ["BluRay", "WEB-DL", "WEBRip", "DVD", "REMUX", "WEB", "DVDRip"] as const;
export const DOWNLOADER_TYPES = ["none", "sabnzbd", "nzbget"] as const;
export const THEME_MODES = ["light", "dark", "plex", "emby", "jellyfin"] as const;
export const MEDIA_SERVER_TYPES = ["plex", "jellyfin", "emby"] as const;

export type QualityFilter = (typeof QUALITY_FILTERS)[number];
export type SourceFilter = (typeof SOURCE_FILTERS)[number];
export type DownloaderType = (typeof DOWNLOADER_TYPES)[number];
export type ThemeMode = (typeof THEME_MODES)[number];
export type MediaServerType = (typeof MEDIA_SERVER_TYPES)[number];

export const MEDIA_SERVER_LABELS: Record<MediaServerType, string> = {
  plex: "Plex",
  jellyfin: "Jellyfin",
  emby: "Emby"
};

export const THEME_LABELS: Record<ThemeMode, string> = {
  light: "Light",
  dark: "Dark",
  plex: "Plex dark",
  emby: "Emby green",
  jellyfin: "Jellyfin purple/blue"
};

export function mediaServerLabel(type: MediaServerType): string {
  return MEDIA_SERVER_LABELS[type] ?? "Media server";
}

export function themeLabel(type: ThemeMode): string {
  return THEME_LABELS[type] ?? "Light";
}

export interface AppSettings {
  mediaServerType: MediaServerType;
  plexBaseUrl: string;
  plexToken: string;
  jellyfinBaseUrl: string;
  jellyfinApiKey: string;
  jellyfinUserId: string;
  embyBaseUrl: string;
  embyApiKey: string;
  embyUserId: string;
  plexMachineId: string;
  jellyfinServerId: string;
  embyServerId: string;
  tmdbApiKey: string;
  fanartApiKey: string;
  nzbHydraBaseUrl: string;
  nzbHydraApiKey: string;
  seerrBaseUrl: string;
  seerrApiKey: string;
  defaultQualities: QualityFilter[];
  defaultSources: SourceFilter[];
  downloaderType: DownloaderType;
  downloaderBaseUrl: string;
  downloaderApiKey: string;
  downloaderDefaultCategory: string;
  loggingEnabled: boolean;
  logPath: string;
  themeMode: ThemeMode;
  refreshOnStart: boolean;
}

// Secret settings fields. GET /settings returns MASKED_SECRET in place of any saved value so
// real keys never reach the browser; the client round-trips the sentinel back unchanged, and the
// server restores the stored value on save/test (clearing the field removes the key).
export const SECRET_SETTING_KEYS = [
  "plexToken",
  "jellyfinApiKey",
  "embyApiKey",
  "tmdbApiKey",
  "fanartApiKey",
  "nzbHydraApiKey",
  "seerrApiKey",
  "downloaderApiKey"
] as const;

export type SecretSettingKey = (typeof SECRET_SETTING_KEYS)[number];

// A fixed-length mask (does not reveal the real key length). Shown in the Settings field to mean
// "a value is saved"; leave it to keep the key, clear it to remove, or type a new value to replace.
export const MASKED_SECRET = "••••••••";

export interface ConnectionResult {
  ok: boolean;
  name?: string;
  message: string;
}

export interface AppMeta {
  version: string;
  commit: string | null;
  dirty: boolean;
  builtAt: string | null;
}

export interface MediaServerMovie {
  mediaServerType: MediaServerType;
  ratingKey: string;
  title: string;
  normalizedTitle: string;
  year: number | null;
  releaseDate: string | null;
  tmdbId: number | null;
  imdbId?: string | null;
  resolution?: string | null;
  guid: string | null;
  posterPath: string | null;
}

export type PlexMovie = MediaServerMovie;

// --- TV (Phase 1: backend foundation, owned-side records only) ---
// Normalized owned-side TV records, mirroring MediaServerMovie. Each server adapter maps its
// native TV payload into these shapes so downstream logic stays source-agnostic. v1 covers
// standard sequentially-seasoned television only (no season 0, no absolute/air-date numbering).

export interface MediaServerShow {
  mediaServerType: MediaServerType;
  /** The server's native show id (Plex ratingKey / Jellyfin-Emby item Id). */
  ratingKey: string;
  title: string;
  normalizedTitle: string;
  year: number | null;
  /** May be null at adapter time; resolved later via the TVDB/IMDb/title chain. */
  tmdbId: number | null;
  imdbId: string | null;
  tvdbId: number | null;
  posterPath: string | null;
}

export interface MediaServerSeason {
  showRatingKey: string;
  mediaServerType: MediaServerType;
  seasonNumber: number;
  /** Count of owned episodes in this season (the empirical truth from the library). */
  ownedEpisodeCount: number;
}

export interface MediaServerEpisode {
  showRatingKey: string;
  mediaServerType: MediaServerType;
  seasonNumber: number;
  episodeNumber: number;
  /** The episode's own native id on the server. */
  ratingKey: string;
}

export interface MediaServerLibrary {
  key: string;
  title: string;
  type: "movie" | "show";
}

export type PlexLibrary = MediaServerLibrary;

export interface MovieResult {
  title: string;
  year: number | null;
  releaseDate: string | null;
  posterPath: string | null;
  tmdbId: number;
  overview?: string;
  listRank?: number;
  imdbId?: string | null;
  imdbRating?: number | null;
  imdbVotes?: number | null;
  owned: boolean;
  plexRatingKey: string | null;
  matchConfidence: "tmdb" | "title-year" | "none";
}

export interface MovieCastMember {
  id: number;
  name: string;
  character: string | null;
  profilePath: string | null;
}

export interface MovieDetails extends MovieResult {
  runtime: number | null;
  genres: string[];
  directors: string[];
  backdropPath: string | null;
  logoPath: string | null;
  tagline: string | null;
  tmdbRating: number | null;
  tmdbVotes: number | null;
  contentRating: string | null;
  trailerKey: string | null;
  cast: MovieCastMember[];
}

export interface PersonHeader {
  id: number;
  name: string;
  profilePath: string | null;
  birthday: string | null;
  deathday: string | null;
  placeOfBirth: string | null;
  knownFor: string | null;
}

export interface SearchResponse {
  query: string;
  results: MovieResult[];
  /** Present only for Person searches — drives the header above the results grid. */
  person?: PersonHeader | null;
}

export interface MovieCollectionSummary {
  id: number;
  name: string;
  posterPath: string | null;
  backdropPath: string | null;
  logoPath: string | null;
  ownedCount: number;
  missingCount: number;
  totalCount: number;
  updatedAt: string | null;
  movies: MovieResult[];
}

export interface CollectionsResponse {
  collections: MovieCollectionSummary[];
}

// --- TV view types (Phase 2: search + ownership cards + show-detail drill-down) ---
// Ownership rolls up the owned tv_seasons/episodes (Phase 1) against TMDb's season list, with the
// same X-of-Y partial-completion language the movie collections use. Season 0 and seasons with no
// aired episodes are excluded from the eligible totals so an unreleased season never reads "missing".

export type TvOwnershipStatus = "complete" | "partial" | "missing";

export interface TvSeasonSummary {
  seasonNumber: number;
  /** TMDb aired-episode count for the season (future-dated episodes excluded). */
  episodeCount: number;
  /** Aired episodes the user owns in this season — same source as the expanded episode list. */
  ownedEpisodeCount: number;
  airYear: number | null;
  status: TvOwnershipStatus;
}

// Phase 3: one aired episode with its owned/missing state (future-dated episodes are excluded, so an
// unaired episode is never shown as "missing"). Lazy-loaded per season when a season is expanded.
export interface TvEpisodeSummary {
  episodeNumber: number;
  name: string | null;
  airDate: string | null;
  stillPath: string | null;
  status: "owned" | "missing";
}

export interface TvSeasonEpisodesResponse {
  tmdbId: number;
  seasonNumber: number;
  episodes: TvEpisodeSummary[];
}

export interface TvShowResult {
  tmdbId: number;
  title: string;
  year: number | null;
  posterPath: string | null;
  overview?: string;
  /** Eligible seasons the user owns at least one episode of (the X in "X of Y seasons"). */
  ownedSeasonCount: number;
  /** Eligible (aired, non-zero) seasons on TMDb (the Y). */
  totalSeasonCount: number;
  status: TvOwnershipStatus;
  /** Whether the user has the show at all in the active server's library. */
  inLibrary: boolean;
  /** Eligible seasons the user owns no episode of — the card-level "quick Request" payload. */
  missingSeasonNumbers: number[];
}

export interface TvShowDetail extends TvShowResult {
  backdropPath: string | null;
  /** Clearlogo title image (parity with movies); null falls back to the text title. */
  logoPath: string | null;
  /** TheTVDB id (from TMDb external_ids) — used for NZBHydra tvsearch when available. */
  tvdbId: number | null;
  tagline: string | null;
  /** TMDb production status, e.g. "Returning Series" / "Ended", when available. */
  tmdbStatus: string | null;
  imdbId: string | null;
  imdbRating: number | null;
  imdbVotes: number | null;
  tmdbRating: number | null;
  tmdbVotes: number | null;
  /** Primary TMDb network name (e.g. HBO, Netflix), null when unavailable. */
  network: string | null;
  networkLogoPath: string | null;
  seasons: TvSeasonSummary[];
}

export interface TvSearchResponse {
  query: string;
  results: TvShowResult[];
}

// Identity for an NZBHydra TV search launched from the show-detail modal: a whole season (episode
// null) or a single episode. Drives the NzbDrawer's TV query + the t=tvsearch params.
export interface TvNzbTarget {
  title: string;
  year: number | null;
  tvdbId: number | null;
  tmdbId: number;
  season: number;
  /** null = whole-season pack; a number = a single episode. */
  episode: number | null;
}

// Lightweight TV search-as-you-type suggestion (no ownership rollup, so the dropdown stays fast).
export interface TvSuggestion {
  tmdbId: number;
  title: string;
  year: number | null;
  posterPath: string | null;
}

export interface TvSuggestResponse {
  query: string;
  suggestions: TvSuggestion[];
}

// Result of a UI-triggered TV library scan (the counts the TV stats strip refreshes from).
export interface TvScanResponse {
  shows: number;
  seasons: number;
  episodes: number;
  sections: string[];
  futureEpisodesExcluded: number;
  scannedAt: string;
}

export interface CollectionsRefreshResponse extends CollectionsResponse {
  checkedMovies: number;
  fetchedCollections: number;
  skippedItems: number;
}

export type CollectionsRefreshPhase = "idle" | "mapping" | "collections" | "complete" | "error";

export interface CollectionsRefreshStatus {
  running: boolean;
  phase: CollectionsRefreshPhase;
  checkedMovies: number;
  totalMovies: number;
  fetchedCollections: number;
  totalCollections: number;
  skippedItems: number;
  message: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export const TRAKT_SOURCES = ["trakt-watchlist", "trakt-watched"] as const;
export type TraktSource = (typeof TRAKT_SOURCES)[number];

export const TRAKT_SOURCE_LABELS: Record<TraktSource, string> = {
  "trakt-watchlist": "Trakt Watchlist",
  "trakt-watched": "Trakt Watched"
};

export interface TraktStatus {
  /** Env credentials present — when false, hide all Trakt UI. */
  configured: boolean;
  connected: boolean;
  username: string | null;
  /** A device-code authorization is in progress (waiting for the user to enter the code). */
  pending: boolean;
  userCode: string | null;
  verificationUrl: string | null;
  /** ISO timestamp when the pending device code expires. */
  expiresAt: string | null;
  message: string | null;
}

export interface SearchSuggestion {
  id: number;
  type: "person" | "movie" | "studio";
  title: string;
  subtitle: string | null;
  imagePath: string | null;
}

export interface ScanResponse {
  imported: number;
  sections: string[];
  scannedAt: string;
}

export interface NzbResult {
  title: string;
  link: string;
  guid: string | null;
  size: number | null;
  ageDays: number | null;
  indexer: string | null;
  category: string | null;
  publishDate: string | null;
}

export interface NzbSearchResponse {
  query: string;
  results: NzbResult[];
  total: number | null;
  offset: number;
  limit: number;
}

export interface DownloaderSendResponse {
  ok: boolean;
  message: string;
}

export interface SeerrRequestResponse {
  ok: boolean;
  message: string;
}

export interface BulkDownloaderSendResponse {
  ok: boolean;
  sent: number;
  failed: number;
  message: string;
  errors: string[];
}

export interface LogResponse {
  path: string;
  lines: string[];
}

export interface DownloaderQueueItem {
  id: string;
  name: string;
  status: string;
  category: string | null;
  progress: number | null;
  size: string | null;
  remaining: string | null;
  speed: string | null;
  eta: string | null;
}

export interface DownloaderStatusResponse {
  ok: boolean;
  type: DownloaderType;
  queue: DownloaderQueueItem[];
  history: DownloaderQueueItem[];
  message: string;
}

export interface DownloadHistoryEntry {
  id: number;
  title: string;
  action: "sent" | "downloaded";
  downloader: DownloaderType | "zip";
  category: string | null;
  status: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}
