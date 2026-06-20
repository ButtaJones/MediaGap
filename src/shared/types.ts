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

export interface MediaServerLibrary {
  key: string;
  title: string;
  type: "movie";
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
