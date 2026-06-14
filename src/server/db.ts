import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";
import { DEFAULT_LOG_PATH } from "./services/logger.js";
import { normalizeTitle } from "./services/normalize.js";
import type { AppSettings, DownloadHistoryEntry, DownloaderType, MovieResult, PlexMovie } from "../shared/types.js";

export interface CachedCollectionMovie {
  id: number;
  title: string;
  releaseDate: string | null;
  runtime: number | null;
  posterPath: string | null;
  overview?: string;
}

export interface CachedCollection {
  id: number;
  name: string;
  posterPath: string | null;
  backdropPath: string | null;
  movies: CachedCollectionMovie[];
  updatedAt: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  plexBaseUrl: "",
  plexToken: "",
  tmdbApiKey: "",
  nzbHydraBaseUrl: "",
  nzbHydraApiKey: "",
  defaultQualities: ["1080p"],
  defaultSources: ["BluRay", "WEB-DL"],
  downloaderType: "none",
  downloaderBaseUrl: "",
  downloaderApiKey: "",
  downloaderDefaultCategory: "movies",
  loggingEnabled: true,
  logPath: DEFAULT_LOG_PATH,
  themeMode: "light",
  refreshOnStart: false
};

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

export const db = new DatabaseSync(config.databasePath);
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS plex_movies (
    rating_key TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    normalized_title TEXT NOT NULL,
    year INTEGER,
    release_date TEXT,
    tmdb_id INTEGER,
    guid TEXT,
    poster_path TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_plex_movies_tmdb_id ON plex_movies(tmdb_id);
  CREATE INDEX IF NOT EXISTS idx_plex_movies_title_year ON plex_movies(normalized_title, year);

  CREATE TABLE IF NOT EXISTS tmdb_cache (
    cache_key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS download_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    action TEXT NOT NULL,
    downloader TEXT NOT NULL,
    category TEXT,
    status TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_download_history_created_at ON download_history(created_at DESC);

  CREATE TABLE IF NOT EXISTS movie_collection_map (
    tmdb_id INTEGER PRIMARY KEY,
    collection_id INTEGER,
    collection_name TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_movie_collection_map_collection_id ON movie_collection_map(collection_id);

  CREATE TABLE IF NOT EXISTS tmdb_collections (
    collection_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    poster_path TEXT,
    backdrop_path TEXT,
    movies_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

export function getSettings(): AppSettings {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("app") as
    | { value: string }
    | undefined;
  if (!row) return DEFAULT_SETTINGS;
  return normalizeSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(row.value) });
}

export function saveSettings(settings: AppSettings): AppSettings {
  const merged = normalizeSettings({ ...DEFAULT_SETTINGS, ...settings });
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(JSON.stringify(merged));
  return merged;
}

function normalizeSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    defaultQualities: Array.isArray(settings.defaultQualities) ? settings.defaultQualities : DEFAULT_SETTINGS.defaultQualities,
    defaultSources: Array.isArray(settings.defaultSources) ? settings.defaultSources : DEFAULT_SETTINGS.defaultSources
  };
}

export function upsertPlexMovies(movies: PlexMovie[]): number {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO plex_movies (
      rating_key, title, normalized_title, year, release_date, tmdb_id, guid, poster_path, updated_at
    ) VALUES (
      @ratingKey, @title, @normalizedTitle, @year, @releaseDate, @tmdbId, @guid, @posterPath, @updatedAt
    )
    ON CONFLICT(rating_key) DO UPDATE SET
      title = excluded.title,
      normalized_title = excluded.normalized_title,
      year = excluded.year,
      release_date = excluded.release_date,
      tmdb_id = excluded.tmdb_id,
      guid = excluded.guid,
      poster_path = excluded.poster_path,
      updated_at = excluded.updated_at
  `);

  db.exec("BEGIN");
  try {
    for (const movie of movies) {
      stmt.run({ ...movie, updatedAt: now });
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return movies.length;
}

export function getLibraryStats() {
  const count = db.prepare("SELECT COUNT(*) AS count FROM plex_movies").get() as { count: number };
  const updated = db
    .prepare("SELECT MAX(updated_at) AS updatedAt FROM plex_movies")
    .get() as { updatedAt: string | null };
  return {
    movieCount: count.count,
    lastScannedAt: updated.updatedAt
  };
}

export function listPlexMovieTmdbIds(): number[] {
  const rows = db
    .prepare("SELECT DISTINCT tmdb_id AS tmdbId FROM plex_movies WHERE tmdb_id IS NOT NULL ORDER BY tmdb_id")
    .all() as Array<{ tmdbId: number }>;
  return rows.map((row) => row.tmdbId);
}

export function listMissingCollectionMapIds(tmdbIds: number[]): number[] {
  if (!tmdbIds.length) return [];
  const existing = db.prepare("SELECT tmdb_id AS tmdbId FROM movie_collection_map").all() as Array<{ tmdbId: number }>;
  const mapped = new Set(existing.map((row) => row.tmdbId));
  return tmdbIds.filter((tmdbId) => !mapped.has(tmdbId));
}

export function upsertMovieCollectionMaps(
  maps: Array<{ tmdbId: number; collectionId: number | null; collectionName: string | null }>
): void {
  if (!maps.length) return;
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO movie_collection_map (tmdb_id, collection_id, collection_name, updated_at)
    VALUES (@tmdbId, @collectionId, @collectionName, @updatedAt)
    ON CONFLICT(tmdb_id) DO UPDATE SET
      collection_id = excluded.collection_id,
      collection_name = excluded.collection_name,
      updated_at = excluded.updated_at
  `);

  db.exec("BEGIN");
  try {
    for (const map of maps) {
      stmt.run({ ...map, updatedAt: now });
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listOwnedCollectionIds(): number[] {
  const rows = db
    .prepare("SELECT DISTINCT collection_id AS collectionId FROM movie_collection_map WHERE collection_id IS NOT NULL ORDER BY collection_name")
    .all() as Array<{ collectionId: number }>;
  return rows.map((row) => row.collectionId);
}

export function listMissingCollectionCacheIds(collectionIds: number[]): number[] {
  if (!collectionIds.length) return [];
  const existing = db.prepare("SELECT collection_id AS collectionId FROM tmdb_collections").all() as Array<{ collectionId: number }>;
  const cached = new Set(existing.map((row) => row.collectionId));
  return collectionIds.filter((collectionId) => !cached.has(collectionId));
}

export function upsertCollectionCache(collection: Omit<CachedCollection, "updatedAt">): void {
  db.prepare(
    `INSERT INTO tmdb_collections (collection_id, name, poster_path, backdrop_path, movies_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(collection_id) DO UPDATE SET
       name = excluded.name,
       poster_path = excluded.poster_path,
       backdrop_path = excluded.backdrop_path,
       movies_json = excluded.movies_json,
       updated_at = excluded.updated_at`
  ).run(
    collection.id,
    collection.name,
    collection.posterPath,
    collection.backdropPath,
    JSON.stringify(collection.movies),
    new Date().toISOString()
  );
}

export function listCachedCollections(collectionIds: number[]): CachedCollection[] {
  if (!collectionIds.length) return [];
  const placeholders = collectionIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT collection_id AS id, name, poster_path AS posterPath, backdrop_path AS backdropPath, movies_json AS moviesJson, updated_at AS updatedAt
       FROM tmdb_collections
       WHERE collection_id IN (${placeholders})`
    )
    .all(...collectionIds) as Array<{
    id: number;
    name: string;
    posterPath: string | null;
    backdropPath: string | null;
    moviesJson: string;
    updatedAt: string;
  }>;

  const order = new Map(collectionIds.map((id, index) => [id, index]));
  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      posterPath: row.posterPath,
      backdropPath: row.backdropPath,
      movies: JSON.parse(row.moviesJson) as CachedCollectionMovie[],
      updatedAt: row.updatedAt
    }))
    .sort((a, b) => (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999));
}

export function matchMovie(movie: Omit<MovieResult, "owned" | "plexRatingKey" | "matchConfidence">): MovieResult {
  if (movie.tmdbId) {
    const tmdbMatch = db
      .prepare("SELECT rating_key AS ratingKey FROM plex_movies WHERE tmdb_id = ? LIMIT 1")
      .get(movie.tmdbId) as { ratingKey: string } | undefined;
    if (tmdbMatch) {
      return { ...movie, owned: true, plexRatingKey: tmdbMatch.ratingKey, matchConfidence: "tmdb" };
    }
  }

  const normalizedTitle = normalizeTitle(movie.title);
  if (movie.year) {
    const titleYearMatch = db
      .prepare("SELECT rating_key AS ratingKey FROM plex_movies WHERE normalized_title = ? AND year = ? LIMIT 1")
      .get(normalizedTitle, movie.year) as { ratingKey: string } | undefined;
    if (titleYearMatch) {
      return {
        ...movie,
        owned: true,
        plexRatingKey: titleYearMatch.ratingKey,
        matchConfidence: "title-year"
      };
    }
  }

  return { ...movie, owned: false, plexRatingKey: null, matchConfidence: "none" };
}

export function cacheGet<T>(key: string): T | null {
  const row = db.prepare("SELECT value FROM tmdb_cache WHERE cache_key = ?").get(key) as
    | { value: string }
    | undefined;
  return row ? (JSON.parse(row.value) as T) : null;
}

export function cacheSet(key: string, value: unknown): void {
  db.prepare(
    "INSERT INTO tmdb_cache (cache_key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).run(key, JSON.stringify(value), new Date().toISOString());
}

export function addHistoryEntry(entry: {
  title: string;
  action: "sent" | "downloaded";
  downloader: DownloaderType | "zip";
  category: string | null;
  status?: string;
  notes?: string;
}) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO download_history (title, action, downloader, category, status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(entry.title, entry.action, entry.downloader, entry.category, entry.status ?? "queued", entry.notes ?? "", now, now);
  return Number(result.lastInsertRowid);
}

export function listHistoryEntries(limit = 100): DownloadHistoryEntry[] {
  const rows = db
    .prepare(
      `SELECT id, title, action, downloader, category, status, notes, created_at AS createdAt, updated_at AS updatedAt
       FROM download_history
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(limit) as unknown as DownloadHistoryEntry[];
  return rows;
}

export function updateHistoryEntry(id: number, patch: { status: string; notes: string }) {
  const updatedAt = new Date().toISOString();
  db.prepare("UPDATE download_history SET status = ?, notes = ?, updated_at = ? WHERE id = ?").run(
    patch.status,
    patch.notes,
    updatedAt,
    id
  );
  return db
    .prepare(
      `SELECT id, title, action, downloader, category, status, notes, created_at AS createdAt, updated_at AS updatedAt
       FROM download_history
       WHERE id = ?`
    )
    .get(id) as DownloadHistoryEntry | undefined;
}

export function deleteHistoryEntry(id: number) {
  db.prepare("DELETE FROM download_history WHERE id = ?").run(id);
}
