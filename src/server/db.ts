import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";
import { DEFAULT_LOG_PATH } from "./services/logger.js";
import { normalizeTitle } from "./services/normalize.js";
import type { AppSettings, DownloadHistoryEntry, DownloaderType, MovieResult, PlexMovie } from "../shared/types.js";

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
    defaultQualities: settings.defaultQualities.length ? settings.defaultQualities : DEFAULT_SETTINGS.defaultQualities,
    defaultSources: settings.defaultSources.length ? settings.defaultSources : DEFAULT_SETTINGS.defaultSources
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
