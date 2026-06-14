export const QUALITY_FILTERS = ["SD", "720p", "1080p", "4K"] as const;
export const SOURCE_FILTERS = ["BluRay", "WEB-DL", "WEBRip", "DVD", "REMUX"] as const;
export const DOWNLOADER_TYPES = ["none", "sabnzbd", "nzbget"] as const;
export const THEME_MODES = ["light", "dark", "plex"] as const;

export type QualityFilter = (typeof QUALITY_FILTERS)[number];
export type SourceFilter = (typeof SOURCE_FILTERS)[number];
export type DownloaderType = (typeof DOWNLOADER_TYPES)[number];
export type ThemeMode = (typeof THEME_MODES)[number];

export interface AppSettings {
  plexBaseUrl: string;
  plexToken: string;
  tmdbApiKey: string;
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

export interface PlexMovie {
  ratingKey: string;
  title: string;
  normalizedTitle: string;
  year: number | null;
  releaseDate: string | null;
  tmdbId: number | null;
  guid: string | null;
  posterPath: string | null;
}

export interface PlexLibrary {
  key: string;
  title: string;
  type: "movie";
}

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
  tagline: string | null;
  cast: MovieCastMember[];
}

export interface SearchResponse {
  query: string;
  results: MovieResult[];
}

export interface MovieCollectionSummary {
  id: number;
  name: string;
  posterPath: string | null;
  backdropPath: string | null;
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
