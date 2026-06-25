import {
  cacheGet,
  cacheSet,
  getOwnedEpisodeNumbers,
  getOwnedSeasonsForShow,
  getOwnedTvShowTmdbIds,
  listCachedCollections,
  listCollectionsPendingFanart,
  listMissingCollectionCacheIds,
  listMissingCollectionMapIds,
  listOwnedCollectionIds,
  listPlexMovieTmdbIds,
  matchMovie,
  upsertCollectionCache,
  upsertCollectionFanart,
  upsertMovieCollectionMaps
} from "../db.js";
import type { CachedCollectionMovie } from "../db.js";
import { fetchCollectionFanartLogo } from "./fanart.js";
import { yearFromDate } from "../services/normalize.js";
import { DISCOVER_COLLECTIONS } from "../seeds/discoverCollections.js";
import zlib from "node:zlib";
import type {
  CollectionsRefreshResponse,
  CollectionsRefreshStatus,
  CollectionsResponse,
  MediaServerShow,
  MovieDetails,
  MovieResult,
  PersonHeader,
  SearchSuggestion,
  TvEpisodeSummary,
  TvOwnershipStatus,
  TvSeasonSummary,
  TvShowDetail,
  TvShowResult,
  TvSuggestion
} from "../../shared/types.js";

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p/w342";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w780";
const LOGO_BASE = "https://image.tmdb.org/t/p/original";
const STILL_BASE = "https://image.tmdb.org/t/p/w227_and_h127_bestv2";
const NETWORK_LOGO_BASE = "https://image.tmdb.org/t/p/w154";
const IMDB_RATINGS_URL = "https://datasets.imdbws.com/title.ratings.tsv.gz";
let imdbRatingsPromise: Promise<Map<string, { rating: number; votes: number }>> | null = null;
let collectionRefreshStatus: CollectionsRefreshStatus = {
  running: false,
  phase: "idle",
  checkedMovies: 0,
  totalMovies: 0,
  fetchedCollections: 0,
  totalCollections: 0,
  skippedItems: 0,
  message: "Collection refresh has not run yet.",
  startedAt: null,
  finishedAt: null
};
let collectionRefreshPromise: Promise<CollectionsRefreshResponse> | null = null;

interface TmdbMovie {
  id: number;
  imdb_id?: string | null;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  overview?: string;
  media_type?: string;
  popularity?: number;
}

interface TmdbFindResponse {
  movie_results?: TmdbMovie[];
  tv_results?: TmdbMovie[];
}

// --- TMDb TV-side types (the "truth" layer later phases diff against owned data) ---
interface TmdbTvSeasonSummary {
  season_number?: number;
  episode_count?: number;
  air_date?: string | null;
  name?: string;
  poster_path?: string | null;
}

interface TmdbTvDetails {
  id: number;
  name?: string;
  first_air_date?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  tagline?: string | null;
  /** TMDb production status, e.g. "Returning Series" / "Ended". */
  status?: string | null;
  vote_average?: number | null;
  vote_count?: number | null;
  number_of_seasons?: number;
  seasons?: TmdbTvSeasonSummary[];
  networks?: Array<{ id: number; name: string; logo_path?: string | null }>;
  external_ids?: {
    imdb_id?: string | null;
    tvdb_id?: number | null;
  };
}

interface TmdbTvEpisode {
  episode_number?: number;
  season_number?: number;
  air_date?: string | null;
  name?: string;
  still_path?: string | null;
}

interface TmdbTvSeasonDetails {
  season_number?: number;
  air_date?: string | null;
  episodes?: TmdbTvEpisode[];
}

interface TmdbMovieDetails extends TmdbMovie {
  runtime?: number | null;
  vote_average?: number | null;
  vote_count?: number | null;
  genres?: Array<{ id: number; name: string }>;
  backdrop_path?: string | null;
  tagline?: string | null;
  belongs_to_collection?: TmdbCollectionReference | null;
  credits?: {
    cast?: TmdbCastMember[];
    crew?: TmdbCrewMember[];
  };
}

interface TmdbCollectionReference {
  id: number;
  name: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
}

interface TmdbCollection extends TmdbCollectionReference {
  parts?: TmdbMovie[];
}

interface TmdbCastMember {
  id: number;
  name: string;
  character?: string;
  profile_path?: string | null;
  order?: number;
}

interface TmdbCrewMember {
  id: number;
  name: string;
  job?: string;
  department?: string;
}

interface TmdbImage {
  file_path?: string | null;
  iso_639_1?: string | null;
  vote_average?: number;
  vote_count?: number;
  width?: number;
}

interface TmdbImagesResponse {
  logos?: TmdbImage[];
}

interface TmdbVideo {
  key?: string;
  site?: string;
  type?: string;
  official?: boolean;
}

interface TmdbVideosResponse {
  results?: TmdbVideo[];
}

interface TmdbReleaseDateCountry {
  iso_3166_1?: string;
  release_dates?: Array<{
    certification?: string;
    type?: number;
    release_date?: string;
  }>;
}

interface TmdbReleaseDatesResponse {
  results?: TmdbReleaseDateCountry[];
}

interface TmdbPerson {
  id: number;
  name: string;
  known_for_department?: string;
  profile_path?: string | null;
  known_for?: TmdbMovie[];
}

interface TmdbCompany {
  id: number;
  name: string;
  logo_path?: string | null;
  origin_country?: string;
}

interface TmdbPersonDetails {
  birthday?: string | null;
  deathday?: string | null;
  place_of_birth?: string | null;
}

interface PersonMeta {
  birthday: string | null;
  deathday: string | null;
  placeOfBirth: string | null;
}

/** Birthday/deathday/place-of-birth for the person header. Cached in SQLite;
 *  degrades to nulls (age line / flag omitted) if the endpoint fails or lacks data. */
async function fetchPersonMeta(apiKey: string, id: number): Promise<PersonMeta> {
  const key = `tmdb:personmeta:${id}`;
  const cached = cacheGet<PersonMeta>(key);
  if (cached) return cached;
  try {
    const person = await tmdbFetch<TmdbPersonDetails>(apiKey, `/person/${id}`);
    const meta: PersonMeta = {
      birthday: person.birthday ?? null,
      deathday: person.deathday ?? null,
      placeOfBirth: person.place_of_birth ?? null
    };
    cacheSet(key, meta);
    return meta;
  } catch {
    return { birthday: null, deathday: null, placeOfBirth: null };
  }
}

async function tmdbFetch<T>(apiKey: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set("api_key", apiKey);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`TMDb returned ${response.status} for ${path}`);
  }
  return (await response.json()) as T;
}

function setCollectionRefreshStatus(patch: Partial<CollectionsRefreshStatus>) {
  collectionRefreshStatus = { ...collectionRefreshStatus, ...patch };
}

export function getCollectionRefreshStatus(): CollectionsRefreshStatus {
  return { ...collectionRefreshStatus };
}

export function startContinueCollectionsRefresh(apiKey: string, fanartApiKey = ""): CollectionsRefreshStatus {
  if (collectionRefreshStatus.running && collectionRefreshPromise) {
    return getCollectionRefreshStatus();
  }

  const now = new Date().toISOString();
  collectionRefreshStatus = {
    running: true,
    phase: "mapping",
    checkedMovies: 0,
    totalMovies: 0,
    fetchedCollections: 0,
    totalCollections: 0,
    skippedItems: 0,
    message: "Starting collection refresh...",
    startedAt: now,
    finishedAt: null
  };

  collectionRefreshPromise = refreshContinueCollections(apiKey, fanartApiKey)
    .then((response) => {
      setCollectionRefreshStatus({
        running: false,
        phase: "complete",
        checkedMovies: response.checkedMovies,
        fetchedCollections: response.fetchedCollections,
        skippedItems: response.skippedItems,
        message: `Refresh complete. Checked ${response.checkedMovies.toLocaleString()} movies and fetched ${response.fetchedCollections.toLocaleString()} collections.`,
        finishedAt: new Date().toISOString()
      });
      return response;
    })
    .catch((error) => {
      setCollectionRefreshStatus({
        running: false,
        phase: "error",
        message: error instanceof Error ? error.message : "Collection refresh failed.",
        finishedAt: new Date().toISOString()
      });
      throw error;
    })
    .finally(() => {
      collectionRefreshPromise = null;
    });

  collectionRefreshPromise.catch(() => undefined);
  return getCollectionRefreshStatus();
}

function toMovieResult(movie: TmdbMovie): MovieResult | null {
  const title = movie.title ?? movie.name;
  const releaseDate = movie.release_date ?? movie.first_air_date ?? null;
  if (!title || !movie.id) return null;

  return matchMovie({
    title,
    year: yearFromDate(releaseDate),
    releaseDate,
    posterPath: movie.poster_path ? `${IMAGE_BASE}${movie.poster_path}` : null,
    tmdbId: movie.id,
    overview: movie.overview,
    imdbId: movie.imdb_id ?? null
  });
}

function sortMovies(movies: MovieResult[]): MovieResult[] {
  return [...movies].sort((a, b) => {
    if (a.year && b.year && a.year !== b.year) return a.year - b.year;
    return a.title.localeCompare(b.title);
  });
}

export async function testTmdbConnection(apiKey: string) {
  await tmdbFetch(apiKey, "/configuration");
  return { name: "TMDb" };
}

export async function resolveTmdbIdFromImdb(apiKey: string, imdbId: string): Promise<number | null> {
  const normalized = imdbId.trim();
  if (!normalized) return null;

  const key = `tmdb:find:imdb:${normalized}`;
  const cached = cacheGet<{ tmdbId: number | null }>(key);
  if (cached) return cached.tmdbId;

  const response = await tmdbFetch<TmdbFindResponse>(apiKey, `/find/${encodeURIComponent(normalized)}`, {
    external_source: "imdb_id"
  });
  const tmdbId = response.movie_results?.[0]?.id ?? null;
  cacheSet(key, { tmdbId });
  return tmdbId;
}

// --- TV id resolution + endpoints (Phase 1) ---
// Resolve a scanned show's TMDb id by the chain: server-provided TMDb id → TVDB id via /find →
// IMDb id via /find → title+year search (last resort). Every lookup is cached in SQLite so a
// re-scan never re-hits TMDb. TMDb's /find resolves TVDB ids directly, so no TVDB API call is made.

export type TvIdMethod = "server" | "tvdb" | "imdb" | "title-year" | "unresolved";

export async function resolveTvTmdbIdFromTvdb(apiKey: string, tvdbId: number): Promise<number | null> {
  if (!Number.isFinite(tvdbId) || tvdbId <= 0) return null;
  const key = `tmdb:find:tvdb:${tvdbId}`;
  const cached = cacheGet<{ tmdbId: number | null }>(key);
  if (cached) return cached.tmdbId;

  const response = await tmdbFetch<TmdbFindResponse>(apiKey, `/find/${tvdbId}`, { external_source: "tvdb_id" });
  const tmdbId = response.tv_results?.[0]?.id ?? null;
  cacheSet(key, { tmdbId });
  return tmdbId;
}

export async function resolveTvTmdbIdFromImdb(apiKey: string, imdbId: string): Promise<number | null> {
  const normalized = imdbId.trim();
  if (!normalized) return null;
  const key = `tmdb:find:imdb:tv:${normalized}`;
  const cached = cacheGet<{ tmdbId: number | null }>(key);
  if (cached) return cached.tmdbId;

  const response = await tmdbFetch<TmdbFindResponse>(apiKey, `/find/${encodeURIComponent(normalized)}`, {
    external_source: "imdb_id"
  });
  const tmdbId = response.tv_results?.[0]?.id ?? null;
  cacheSet(key, { tmdbId });
  return tmdbId;
}

export async function searchTvShowId(apiKey: string, title: string, year: number | null): Promise<number | null> {
  const trimmed = title.trim();
  if (!trimmed) return null;
  const key = `tmdb:search:tv:${trimmed.toLowerCase()}:${year ?? ""}`;
  const cached = cacheGet<{ tmdbId: number | null }>(key);
  if (cached) return cached.tmdbId;

  const params: Record<string, string> = { query: trimmed, include_adult: "false" };
  if (year) params.first_air_date_year = String(year);
  const response = await tmdbFetch<{ results?: TmdbMovie[] }>(apiKey, "/search/tv", params);
  const tmdbId = response.results?.[0]?.id ?? null;
  cacheSet(key, { tmdbId });
  return tmdbId;
}

async function resolveTvShowTmdbId(
  apiKey: string,
  show: Pick<MediaServerShow, "tmdbId" | "tvdbId" | "imdbId" | "title" | "year">
): Promise<{ tmdbId: number | null; method: TvIdMethod }> {
  if (show.tmdbId) return { tmdbId: show.tmdbId, method: "server" };
  if (show.tvdbId) {
    const fromTvdb = await resolveTvTmdbIdFromTvdb(apiKey, show.tvdbId);
    if (fromTvdb) return { tmdbId: fromTvdb, method: "tvdb" };
  }
  if (show.imdbId) {
    const fromImdb = await resolveTvTmdbIdFromImdb(apiKey, show.imdbId);
    if (fromImdb) return { tmdbId: fromImdb, method: "imdb" };
  }
  const fromTitle = await searchTvShowId(apiKey, show.title, show.year);
  if (fromTitle) return { tmdbId: fromTitle, method: "title-year" };
  return { tmdbId: null, method: "unresolved" };
}

export interface TvLibraryResolution {
  shows: MediaServerShow[];
  methodCounts: Record<TvIdMethod, number>;
  unresolved: Array<{ title: string; year: number | null }>;
}

// Resolve TMDb ids for a whole scanned library, in small concurrent batches (like the collections
// refresh). Shows are returned with tmdbId filled where possible; ones that never resolve are kept
// (the owned library stays complete) but reported as unresolved and excluded from id-keyed helpers.
export async function resolveTvLibraryTmdbIds(apiKey: string, shows: MediaServerShow[]): Promise<TvLibraryResolution> {
  const methodCounts: Record<TvIdMethod, number> = { server: 0, tvdb: 0, imdb: 0, "title-year": 0, unresolved: 0 };
  const unresolved: Array<{ title: string; year: number | null }> = [];
  const resolved: MediaServerShow[] = [];

  for (const batch of chunks(shows, 8)) {
    const results = await Promise.all(
      batch.map(async (show) => {
        try {
          const { tmdbId, method } = await resolveTvShowTmdbId(apiKey, show);
          return { show: { ...show, tmdbId: tmdbId ?? show.tmdbId }, method, failed: !tmdbId && !show.tmdbId };
        } catch {
          // A failed lookup must not break the scan — keep the show with whatever id it already had.
          return { show, method: "unresolved" as TvIdMethod, failed: !show.tmdbId };
        }
      })
    );
    for (const result of results) {
      methodCounts[result.method] += 1;
      if (result.failed) unresolved.push({ title: result.show.title, year: result.show.year });
      resolved.push(result.show);
    }
  }

  return { shows: resolved, methodCounts, unresolved };
}

// TMDb TV endpoints for later phases (the missing-episode "truth" side). Cached in SQLite so they
// resolve during scan/refresh, never per render.
export async function getTvShowDetails(apiKey: string, tmdbId: number): Promise<TmdbTvDetails> {
  const key = `tmdb:tv-details:${tmdbId}`;
  const cached = cacheGet<TmdbTvDetails>(key);
  if (cached) return cached;

  const raw = await tmdbFetch<TmdbTvDetails>(apiKey, `/tv/${tmdbId}`, { append_to_response: "external_ids" });
  cacheSet(key, raw);
  return raw;
}

export async function getTvSeasonDetails(apiKey: string, tmdbId: number, seasonNumber: number): Promise<TmdbTvSeasonDetails> {
  const key = `tmdb:tv-season:${tmdbId}:${seasonNumber}`;
  const cached = cacheGet<TmdbTvSeasonDetails>(key);
  if (cached) return cached;

  const raw = await tmdbFetch<TmdbTvSeasonDetails>(apiKey, `/tv/${tmdbId}/season/${seasonNumber}`);
  cacheSet(key, raw);
  return raw;
}

// --- TV ownership (Phase 2) ---
// Roll up owned seasons/episodes against TMDb's season list with the same X-of-Y language the movie
// collections use. Season 0 and seasons with no aired episodes are excluded so an unreleased season
// never reads as "missing" (the TV analogue of the collections bloat filter).

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isAired(date: string | null | undefined, today: string): boolean {
  if (!date) return false;
  return date.slice(0, 10) <= today;
}

function rollupStatus(owned: number, total: number): TvOwnershipStatus {
  if (owned <= 0) return "missing";
  if (owned >= total) return "complete";
  return "partial";
}

// Card-level eligibility uses the cheaper season SUMMARY air_date (one /tv/{id} call per show): a
// season counts toward the Y when it has aired (air_date present and in the past) and has episodes.
function eligibleSummarySeasons(details: TmdbTvDetails, today: string): TmdbTvSeasonSummary[] {
  return (details.seasons ?? []).filter(
    (season) =>
      typeof season.season_number === "number" &&
      season.season_number >= 1 &&
      (season.episode_count ?? 0) > 0 &&
      isAired(season.air_date, today)
  );
}

function ownedSeasonMap(tmdbId: number): Map<number, number> {
  const map = new Map<number, number>();
  for (const season of getOwnedSeasonsForShow(tmdbId)) {
    map.set(season.seasonNumber, season.ownedEpisodeCount);
  }
  return map;
}

function toTvShowResult(raw: TmdbMovie, details: TmdbTvDetails, today: string): TvShowResult {
  const owned = ownedSeasonMap(details.id);
  const eligible = eligibleSummarySeasons(details, today);
  const ownedSeasonCount = eligible.filter((season) => (owned.get(season.season_number as number) ?? 0) >= 1).length;
  const totalSeasonCount = eligible.length;
  // Eligible seasons the user owns no episode of — the card "quick Request" payload (the precise
  // per-episode partial seasons stay in the modal's "Request all missing seasons").
  const missingSeasonNumbers = eligible
    .filter((season) => (owned.get(season.season_number as number) ?? 0) < 1)
    .map((season) => season.season_number as number);
  return {
    tmdbId: details.id,
    title: raw.name ?? raw.title ?? details.name ?? "Untitled",
    year: yearFromDate(raw.first_air_date ?? details.first_air_date ?? null),
    posterPath: raw.poster_path ? `${IMAGE_BASE}${raw.poster_path}` : details.poster_path ? `${IMAGE_BASE}${details.poster_path}` : null,
    overview: raw.overview,
    ownedSeasonCount,
    totalSeasonCount,
    status: rollupStatus(ownedSeasonCount, totalSeasonCount),
    inLibrary: owned.size > 0,
    missingSeasonNumbers
  };
}

// A broad TV term ("star") has far more than one TMDb page of matches, but /search/tv only returns
// 20 per page — so fetch a few pages to fill multiple paginated result pages. Capped so the per-show
// ownership lookups below stay bounded.
const TV_SEARCH_LIMIT = 50;
const TV_SEARCH_MAX_PAGES = 3;

async function fetchTvSearchPages(apiKey: string, query: string): Promise<TmdbMovie[]> {
  const collected: TmdbMovie[] = [];
  let totalPages = 1;
  for (let page = 1; collected.length < TV_SEARCH_LIMIT && page <= totalPages && page <= TV_SEARCH_MAX_PAGES; page += 1) {
    const response = await tmdbFetch<{ results?: TmdbMovie[]; total_pages?: number }>(apiKey, "/search/tv", {
      query,
      include_adult: "false",
      page: String(page)
    });
    collected.push(...(response.results ?? []));
    totalPages = response.total_pages ?? 1;
  }
  return collected;
}

// Search TV shows by title and tag each with ownership status. Raw TMDb hits are cached (owned data
// is overlaid live so a fresh scan immediately changes the badges), and per-show detail lookups are
// batched like the collections refresh so a search stays responsive. (Cache key is versioned so the
// old single-page, 20-result caches are bypassed.)
export async function searchTvShows(apiKey: string, query: string): Promise<TvShowResult[]> {
  const key = `tmdb:search-tv:2:${query}`;
  const cached = cacheGet<TmdbMovie[]>(key);
  const raw = cached ?? (await fetchTvSearchPages(apiKey, query));
  if (!cached) cacheSet(key, raw);

  const today = todayIso();
  const candidates = raw.filter((show) => show.id).slice(0, TV_SEARCH_LIMIT);
  const results: TvShowResult[] = [];
  for (const batch of chunks(candidates, 8)) {
    const settled = await Promise.allSettled(
      batch.map(async (show) => toTvShowResult(show, await getTvShowDetails(apiKey, show.id), today))
    );
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") results.push(outcome.value);
    }
  }
  return results;
}

// Lightweight search-as-you-type suggestions: just title/year/poster from /search/tv, with NO
// per-show ownership rollup so the dropdown stays responsive (the full search overlays ownership).
export async function searchTvSuggestions(apiKey: string, query: string): Promise<TvSuggestion[]> {
  const shows = await tmdbFetch<{ results: TmdbMovie[] }>(apiKey, "/search/tv", { query, include_adult: "false" });
  return shows.results.slice(0, 6).map((show) => ({
    tmdbId: show.id,
    title: show.name ?? show.title ?? "Untitled",
    year: yearFromDate(show.first_air_date ?? null),
    posterPath: show.poster_path ? `${IMAGE_BASE}${show.poster_path}` : null
  }));
}

// Single source of truth for a season's aired episodes + owned/missing state: it drives BOTH the
// per-season counts in the show-detail summary AND the expanded episode list, so they always agree
// (Phase 3 §3). Future-dated episodes are excluded so an unaired episode is never "missing". The
// TMDb season fetch is cached, so re-reading on expand is cheap.
async function getSeasonEpisodeOwnership(
  apiKey: string,
  tmdbId: number,
  seasonNumber: number,
  today: string
): Promise<{ episodes: TvEpisodeSummary[]; airedCount: number; ownedCount: number }> {
  const detail = await getTvSeasonDetails(apiKey, tmdbId, seasonNumber);
  const ownedNumbers = new Set(getOwnedEpisodeNumbers(tmdbId, seasonNumber));
  const episodes: TvEpisodeSummary[] = [];
  for (const episode of detail.episodes ?? []) {
    if (typeof episode.episode_number !== "number") continue;
    if (!isAired(episode.air_date, today)) continue;
    episodes.push({
      episodeNumber: episode.episode_number,
      name: episode.name || null,
      airDate: episode.air_date ?? null,
      stillPath: episode.still_path ? `${STILL_BASE}${episode.still_path}` : null,
      status: ownedNumbers.has(episode.episode_number) ? "owned" : "missing"
    });
  }
  episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
  const ownedCount = episodes.reduce((count, episode) => count + (episode.status === "owned" ? 1 : 0), 0);
  return { episodes, airedCount: episodes.length, ownedCount };
}

// Lazy per-season episode list (owned/missing), fetched when the user expands a season.
export async function getTvSeasonEpisodes(apiKey: string, tmdbId: number, seasonNumber: number): Promise<TvEpisodeSummary[]> {
  const { episodes } = await getSeasonEpisodeOwnership(apiKey, tmdbId, seasonNumber, todayIso());
  return episodes;
}

// Precise show-detail ownership: per eligible season, count AIRED episodes and how many are owned
// (entirely-unaired seasons are dropped, not shown as missing). Counts come from the same
// episode-ownership computation the expanded list uses, so summary and list never disagree.
export async function getTvShowDetailWithOwnership(apiKey: string, tmdbId: number): Promise<TvShowDetail> {
  const details = await getTvShowDetails(apiKey, tmdbId);
  const today = todayIso();
  const owned = ownedSeasonMap(tmdbId);
  const imdbId = details.external_ids?.imdb_id ?? null;

  // Kick off the clearlogo + IMDb rating lookups in parallel with the per-season fetches below.
  // Both degrade gracefully (null) so a failure never breaks the detail (parity with movies).
  const logoPromise = getTvLogo(apiKey, tmdbId).catch(() => null);
  const imdbRatingPromise = imdbId
    ? getImdbRatings()
        .then((ratings) => ratings.get(imdbId) ?? null)
        .catch(() => null)
    : Promise.resolve(null);

  const candidateSeasons = (details.seasons ?? []).filter(
    (season) => typeof season.season_number === "number" && season.season_number >= 1
  );

  const seasons: TvSeasonSummary[] = [];
  for (const batch of chunks(candidateSeasons, 4)) {
    const settled = await Promise.allSettled(
      batch.map(async (season) => {
        const seasonNumber = season.season_number as number;
        const { airedCount, ownedCount } = await getSeasonEpisodeOwnership(apiKey, tmdbId, seasonNumber, today);
        return { season, seasonNumber, airedCount, ownedCount };
      })
    );
    for (const outcome of settled) {
      if (outcome.status !== "fulfilled") continue;
      const { season, seasonNumber, airedCount, ownedCount } = outcome.value;
      if (airedCount <= 0) continue; // entirely unaired season → not "missing", just unreleased
      seasons.push({
        seasonNumber,
        episodeCount: airedCount,
        ownedEpisodeCount: ownedCount,
        airYear: yearFromDate(season.air_date ?? null),
        status: ownedCount <= 0 ? "missing" : ownedCount >= airedCount ? "complete" : "partial"
      });
    }
  }

  seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
  const ownedSeasonCount = seasons.filter((season) => season.ownedEpisodeCount >= 1).length;
  const totalSeasonCount = seasons.length;
  // Seasons the user owns nothing of (same notion as the card field; the modal's "Request all
  // missing seasons" additionally covers precise partial seasons via detail.seasons).
  const missingSeasonNumbers = seasons.filter((season) => season.status === "missing").map((season) => season.seasonNumber);

  const [logoPath, imdbRating] = await Promise.all([logoPromise, imdbRatingPromise]);
  const primaryNetwork = details.networks?.[0] ?? null;

  return {
    tmdbId: details.id,
    title: details.name ?? "Untitled",
    year: yearFromDate(details.first_air_date ?? null),
    posterPath: details.poster_path ? `${IMAGE_BASE}${details.poster_path}` : null,
    backdropPath: details.backdrop_path ? `${BACKDROP_BASE}${details.backdrop_path}` : null,
    missingSeasonNumbers,
    logoPath,
    tvdbId: details.external_ids?.tvdb_id ?? null,
    overview: details.overview,
    tagline: details.tagline || null,
    tmdbStatus: details.status || null,
    imdbId,
    imdbRating: imdbRating?.rating ?? null,
    imdbVotes: imdbRating?.votes ?? null,
    tmdbRating: typeof details.vote_average === "number" && details.vote_average > 0 ? details.vote_average : null,
    tmdbVotes: typeof details.vote_count === "number" ? details.vote_count : null,
    network: primaryNetwork?.name ?? null,
    networkLogoPath: primaryNetwork?.logo_path ? `${NETWORK_LOGO_BASE}${primaryNetwork.logo_path}` : null,
    ownedSeasonCount,
    totalSeasonCount,
    status: rollupStatus(ownedSeasonCount, totalSeasonCount),
    inLibrary: owned.size > 0,
    seasons
  };
}

export function getOwnedTvShowCount(): number {
  return getOwnedTvShowTmdbIds().length;
}

export async function searchSuggestions(
  apiKey: string,
  query: string,
  type: "person" | "movie" | "studio"
): Promise<SearchSuggestion[]> {
  if (type === "person") {
    const people = await tmdbFetch<{ results: TmdbPerson[] }>(apiKey, "/search/person", {
      query,
      include_adult: "false"
    });
    return people.results.slice(0, 6).map((person) => ({
      id: person.id,
      type,
      title: person.name,
      subtitle:
        person.known_for?.map((movie) => movie.title ?? movie.name).filter(Boolean).slice(0, 2).join(", ") ||
        person.known_for_department ||
        null,
      imagePath: person.profile_path ? `${IMAGE_BASE}${person.profile_path}` : null
    }));
  }

  if (type === "studio") {
    const companies = await tmdbFetch<{ results: TmdbCompany[] }>(apiKey, "/search/company", { query });
    return companies.results.slice(0, 6).map((company) => ({
      id: company.id,
      type,
      title: company.name,
      subtitle: company.origin_country || null,
      imagePath: company.logo_path ? `${IMAGE_BASE}${company.logo_path}` : null
    }));
  }

  const movies = await tmdbFetch<{ results: TmdbMovie[] }>(apiKey, "/search/movie", {
    query,
    include_adult: "false"
  });
  return movies.results.slice(0, 6).map((movie) => ({
    id: movie.id,
    type,
    title: movie.title ?? movie.name ?? "Untitled",
    subtitle: yearFromDate(movie.release_date ?? null)?.toString() ?? null,
    imagePath: movie.poster_path ? `${IMAGE_BASE}${movie.poster_path}` : null
  }));
}

export async function searchMovies(apiKey: string, query: string): Promise<MovieResult[]> {
  const key = `tmdb:movie:${query}`;
  const cached = cacheGet<TmdbMovie[]>(key);
  const raw =
    cached ??
    (
      await tmdbFetch<{ results: TmdbMovie[] }>(apiKey, "/search/movie", {
        query,
        include_adult: "false"
      })
    ).results;
  if (!cached) cacheSet(key, raw);
  return sortMovies(raw.map(toMovieResult).filter(Boolean) as MovieResult[]);
}

// Resolve a list of TMDb ids (e.g. a Trakt watchlist) into owned/missing-tagged MovieResults,
// reusing the SQLite-cached movie details and the shared matching. Batched + best-effort: ids
// that fail to resolve are dropped rather than failing the whole list.
export async function getMoviesByTmdbIds(apiKey: string, tmdbIds: number[]): Promise<MovieResult[]> {
  const uniqueIds = [...new Set(tmdbIds.filter((id) => Number.isFinite(id) && id > 0))];
  const movies: MovieResult[] = [];
  for (const batch of chunks(uniqueIds, 8)) {
    const details = await Promise.allSettled(batch.map((tmdbId) => getMovieDetailsRaw(apiKey, tmdbId)));
    for (const detail of details) {
      if (detail.status !== "fulfilled") continue;
      const movie = toMovieResult(detail.value);
      if (movie) movies.push(movie);
    }
  }
  return sortMovies(movies);
}

// Resolve a list of TMDb show ids (e.g. a Trakt show watchlist) into ownership-tagged TvShowResults,
// reusing the SAME rollup the TV search uses so Trakt results render identically in the TV grid.
// Batched + best-effort: ids that fail to resolve are dropped rather than failing the whole list.
export async function getTvShowsByTmdbIds(apiKey: string, tmdbIds: number[]): Promise<TvShowResult[]> {
  const uniqueIds = [...new Set(tmdbIds.filter((id) => Number.isFinite(id) && id > 0))];
  const today = todayIso();
  const results: TvShowResult[] = [];
  for (const batch of chunks(uniqueIds, 8)) {
    const settled = await Promise.allSettled(
      batch.map(async (tmdbId) => {
        const details = await getTvShowDetails(apiKey, tmdbId);
        return toTvShowResult({ id: details.id } as TmdbMovie, details, today);
      })
    );
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") results.push(outcome.value);
    }
  }
  return results;
}

export async function getMovieDetails(apiKey: string, tmdbId: number): Promise<MovieDetails> {
  const raw = await getMovieDetailsRaw(apiKey, tmdbId);

  const movie = toMovieResult(raw);
  if (!movie) throw new Error("TMDb did not return movie details.");
  const externalIds = raw as TmdbMovieDetails & { external_ids?: { imdb_id?: string | null } };
  const imdbId = movie.imdbId ?? externalIds.external_ids?.imdb_id ?? null;
  const [imdbRating, logoPath, contentRating, trailerKey] = await Promise.all([
    imdbId ? getImdbRatings().then((ratings) => ratings.get(imdbId) ?? null) : Promise.resolve(null),
    getMovieLogo(apiKey, tmdbId),
    getMovieContentRating(apiKey, tmdbId),
    getMovieTrailerKey(apiKey, tmdbId)
  ]);

  return {
    ...movie,
    imdbId,
    imdbRating: imdbRating?.rating ?? null,
    imdbVotes: imdbRating?.votes ?? null,
    runtime: raw.runtime ?? null,
    genres: raw.genres?.map((genre) => genre.name).filter(Boolean) ?? [],
    directors:
      raw.credits?.crew
        ?.filter((member) => member.job === "Director")
        .map((member) => member.name)
        .filter(Boolean) ?? [],
    backdropPath: raw.backdrop_path ? `${BACKDROP_BASE}${raw.backdrop_path}` : null,
    logoPath,
    tagline: raw.tagline || null,
    tmdbRating: typeof raw.vote_average === "number" ? raw.vote_average : null,
    tmdbVotes: typeof raw.vote_count === "number" ? raw.vote_count : null,
    contentRating,
    trailerKey,
    cast:
      raw.credits?.cast
        ?.slice()
        .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
        .slice(0, 18)
        .map((member) => ({
          id: member.id,
          name: member.name,
          character: member.character || null,
          profilePath: member.profile_path ? `${IMAGE_BASE}${member.profile_path}` : null
        })) ?? []
  };
}

async function getMovieLogo(apiKey: string, tmdbId: number): Promise<string | null> {
  const key = `tmdb:movie-logo:${tmdbId}`;
  const cached = cacheGet<{ logoPath: string | null }>(key);
  if (cached) return cached.logoPath;

  const response = await tmdbFetch<TmdbImagesResponse>(apiKey, `/movie/${tmdbId}/images`, {
    include_image_language: "en,null"
  });
  const logo = pickTmdbLogo(response.logos ?? []);
  const logoPath = logo?.file_path ? `${LOGO_BASE}${logo.file_path}` : null;
  cacheSet(key, { logoPath });
  return logoPath;
}

// TV clearlogo, mirroring getMovieLogo (English-or-language-neutral PNG, ranked the same way).
async function getTvLogo(apiKey: string, tmdbId: number): Promise<string | null> {
  const key = `tmdb:tv-logo:${tmdbId}`;
  const cached = cacheGet<{ logoPath: string | null }>(key);
  if (cached) return cached.logoPath;

  const response = await tmdbFetch<TmdbImagesResponse>(apiKey, `/tv/${tmdbId}/images`, {
    include_image_language: "en,null"
  });
  const logo = pickTmdbLogo(response.logos ?? []);
  const logoPath = logo?.file_path ? `${LOGO_BASE}${logo.file_path}` : null;
  cacheSet(key, { logoPath });
  return logoPath;
}

function pickTmdbLogo(logos: TmdbImage[]): TmdbImage | null {
  const ranked = logos
    .filter((logo) => logo.file_path)
    .sort(
      (a, b) =>
        logoLanguageScore(b) - logoLanguageScore(a) ||
        (b.vote_average ?? 0) - (a.vote_average ?? 0) ||
        (b.vote_count ?? 0) - (a.vote_count ?? 0) ||
        (b.width ?? 0) - (a.width ?? 0)
    );
  return ranked[0] ?? null;
}

function logoLanguageScore(logo: TmdbImage) {
  if (logo.iso_639_1 === "en") return 2;
  if (logo.iso_639_1 === null || logo.iso_639_1 === undefined) return 1;
  return 0;
}

async function getMovieTrailerKey(apiKey: string, tmdbId: number): Promise<string | null> {
  const key = `tmdb:movie-trailer:${tmdbId}`;
  const cached = cacheGet<{ trailerKey: string | null }>(key);
  if (cached) return cached.trailerKey;

  try {
    const response = await tmdbFetch<TmdbVideosResponse>(apiKey, `/movie/${tmdbId}/videos`);
    const trailerKey = pickTrailerKey(response.results ?? []);
    cacheSet(key, { trailerKey });
    return trailerKey;
  } catch {
    // Degrade gracefully — a missing trailer just omits the button, never fails details.
    return null;
  }
}

function pickTrailerKey(videos: TmdbVideo[]): string | null {
  const youtube = videos.filter((video) => video.site === "YouTube" && video.key);
  if (!youtube.length) return null;
  const officialTrailer = youtube.find((video) => video.type === "Trailer" && video.official);
  if (officialTrailer?.key) return officialTrailer.key;
  const anyTrailer = youtube.find((video) => video.type === "Trailer");
  if (anyTrailer?.key) return anyTrailer.key;
  return youtube[0]?.key ?? null;
}

async function getMovieContentRating(apiKey: string, tmdbId: number): Promise<string | null> {
  const key = `tmdb:movie-certification:${tmdbId}`;
  const cached = cacheGet<{ certification: string | null }>(key);
  if (cached) return cached.certification;

  const response = await tmdbFetch<TmdbReleaseDatesResponse>(apiKey, `/movie/${tmdbId}/release_dates`);
  const certification = pickCertification(response);
  cacheSet(key, { certification });
  return certification;
}

function pickCertification(response: TmdbReleaseDatesResponse) {
  const countries = response.results ?? [];
  const usCertification = pickCertificationFromCountry(countries.find((country) => country.iso_3166_1 === "US"));
  if (usCertification) return usCertification;

  for (const country of countries) {
    const certification = pickCertificationFromCountry(country);
    if (certification) return certification;
  }
  return null;
}

function pickCertificationFromCountry(country?: TmdbReleaseDateCountry) {
  if (!country?.release_dates?.length) return null;
  const typePreference = new Map([
    [3, 0],
    [2, 1],
    [1, 2],
    [4, 3],
    [5, 4],
    [6, 5]
  ]);
  const candidates = country.release_dates
    .filter((release) => release.certification?.trim())
    .sort(
      (a, b) =>
        (typePreference.get(a.type ?? 999) ?? 999) - (typePreference.get(b.type ?? 999) ?? 999) ||
        (a.release_date ?? "").localeCompare(b.release_date ?? "")
    );
  return candidates[0]?.certification?.trim() || null;
}

export function getContinueCollections(): CollectionsResponse {
  const collectionIds = listOwnedCollectionIds();
  const collections = listCachedCollections(collectionIds)
    .map(toCollectionSummary)
    .filter((collection) => collection.ownedCount > 0 && collection.missingCount > 0)
    .sort((a, b) => {
      const aRemaining = a.missingCount / Math.max(1, a.totalCount);
      const bRemaining = b.missingCount / Math.max(1, b.totalCount);
      return aRemaining - bRemaining || b.ownedCount - a.ownedCount || a.name.localeCompare(b.name);
    });

  return { collections };
}

export function getDiscoverCollections(): CollectionsResponse {
  const seedIds = getDiscoverCollectionIds();
  const collections = listCachedCollections(seedIds).map(toCollectionSummary);
  return { collections };
}

function toCollectionSummary(collection: ReturnType<typeof listCachedCollections>[number]) {
  const movies = collection.movies
    .map((movie) =>
      matchMovie({
        title: movie.title,
        year: yearFromDate(movie.releaseDate),
        releaseDate: movie.releaseDate,
        posterPath: movie.posterPath,
        tmdbId: movie.id,
        overview: movie.overview,
        imdbId: null
      })
    )
    .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.title.localeCompare(b.title));
  const ownedCount = movies.filter((movie) => movie.owned).length;
  const totalCount = movies.length;
  return {
    id: collection.id,
    name: collection.name,
    posterPath: collection.posterPath,
    backdropPath: collection.backdropPath,
    logoPath: collection.logoPath,
    ownedCount,
    missingCount: totalCount - ownedCount,
    totalCount,
    updatedAt: collection.updatedAt,
    movies
  };
}

function getDiscoverCollectionIds() {
  return [...new Set(DISCOVER_COLLECTIONS.map((collection) => collection.id))];
}

export async function refreshContinueCollections(apiKey: string, fanartApiKey = ""): Promise<CollectionsRefreshResponse> {
  const tmdbIds = listPlexMovieTmdbIds();
  const missingMapIds = listMissingCollectionMapIds(tmdbIds);
  const maps: Array<{ tmdbId: number; collectionId: number | null; collectionName: string | null }> = [];
  let checkedMovies = 0;
  let fetchedCollections = 0;
  let skippedItems = 0;

  setCollectionRefreshStatus({
    phase: "mapping",
    totalMovies: missingMapIds.length,
    checkedMovies: 0,
    totalCollections: 0,
    fetchedCollections: 0,
    skippedItems: 0,
    message: missingMapIds.length
      ? `Checking ${missingMapIds.length.toLocaleString()} owned movies for TMDb collection data...`
      : "Owned movie collection map is already cached."
  });

  for (const batch of chunks(missingMapIds, 8)) {
    const details = await Promise.allSettled(
      batch.map(async (tmdbId) => {
        const movie = await getMovieDetailsRaw(apiKey, tmdbId);
        return { tmdbId, collection: movie.belongs_to_collection ?? null };
      })
    );
    for (const detail of details) {
      checkedMovies += 1;
      if (detail.status === "rejected") {
        skippedItems += 1;
        continue;
      }
      maps.push({
        tmdbId: detail.value.tmdbId,
        collectionId: detail.value.collection?.id ?? null,
        collectionName: detail.value.collection?.name ?? null
      });
    }
    upsertMovieCollectionMaps(maps.splice(0));
    setCollectionRefreshStatus({
      checkedMovies,
      skippedItems,
      message: `Checked ${checkedMovies.toLocaleString()} of ${missingMapIds.length.toLocaleString()} owned movies for collection data.`
    });
  }

  upsertMovieCollectionMaps(maps);

  const collectionIds = [...new Set([...listOwnedCollectionIds(), ...getDiscoverCollectionIds()])];
  const missingCollectionIds = listMissingCollectionCacheIds(collectionIds);
  const fanartEnabled = Boolean(fanartApiKey.trim());
  setCollectionRefreshStatus({
    phase: "collections",
    totalCollections: missingCollectionIds.length,
    fetchedCollections: 0,
    skippedItems,
    message: missingCollectionIds.length
      ? `Fetching ${missingCollectionIds.length.toLocaleString()} TMDb collection${missingCollectionIds.length === 1 ? "" : "s"}...`
      : "TMDb collection cache is already current."
  });
  for (const batch of chunks(missingCollectionIds, 3)) {
    const results = await Promise.allSettled(batch.map((collectionId) => fetchAndCacheCollection(apiKey, collectionId)));
    for (const result of results) {
      if (result.status === "fulfilled") {
        fetchedCollections += 1;
      } else {
        skippedItems += 1;
      }
    }
    setCollectionRefreshStatus({
      fetchedCollections,
      skippedItems,
      message: `Fetched ${fetchedCollections.toLocaleString()} of ${missingCollectionIds.length.toLocaleString()} TMDb collections.`
    });
  }

  if (fanartEnabled) {
    const pendingFanartIds = listCollectionsPendingFanart(collectionIds);
    setCollectionRefreshStatus({
      phase: "collections",
      totalCollections: pendingFanartIds.length,
      fetchedCollections: 0,
      skippedItems,
      message: pendingFanartIds.length
        ? `Fetching Fanart.tv logos for ${pendingFanartIds.length.toLocaleString()} collection${pendingFanartIds.length === 1 ? "" : "s"}...`
        : "Fanart.tv collection logos are already cached."
    });

    let fetchedArtwork = 0;
    for (const batch of chunks(pendingFanartIds, 3)) {
      const results = await Promise.allSettled(batch.map((collectionId) => fetchAndCacheCollectionFanart(fanartApiKey, collectionId)));
      for (const result of results) {
        if (result.status === "fulfilled") {
          fetchedArtwork += 1;
        } else {
          skippedItems += 1;
        }
      }
      setCollectionRefreshStatus({
        fetchedCollections: fetchedArtwork,
        skippedItems,
        message: `Checked Fanart.tv artwork for ${fetchedArtwork.toLocaleString()} of ${pendingFanartIds.length.toLocaleString()} collections.`
      });
    }
  }

  return {
    ...getContinueCollections(),
    checkedMovies,
    fetchedCollections,
    skippedItems
  };
}

async function getMovieDetailsRaw(apiKey: string, tmdbId: number): Promise<TmdbMovieDetails> {
  const key = `tmdb:movie-details:${tmdbId}`;
  const cached = cacheGet<TmdbMovieDetails>(key);
  if (cached) return cached;

  const raw = await tmdbFetch<TmdbMovieDetails>(apiKey, `/movie/${tmdbId}`, {
    append_to_response: "credits,external_ids"
  });
  cacheSet(key, raw);
  return raw;
}

async function fetchAndCacheCollection(apiKey: string, collectionId: number): Promise<void> {
  const raw = await tmdbFetch<TmdbCollection>(apiKey, `/collection/${collectionId}`);
  const partIds = [...new Set((raw.parts ?? []).map((part) => part.id).filter(Boolean))];
  const movies: CachedCollectionMovie[] = [];

  for (const batch of chunks(partIds, 6)) {
    const details = await Promise.all(batch.map((tmdbId) => getMovieDetailsRaw(apiKey, tmdbId)));
    for (const detail of details) {
      if (!isUsableCollectionMovie(detail)) continue;
      movies.push({
        id: detail.id,
        title: detail.title ?? detail.name ?? "Untitled",
        releaseDate: detail.release_date ?? detail.first_air_date ?? null,
        runtime: detail.runtime ?? null,
        posterPath: detail.poster_path ? `${IMAGE_BASE}${detail.poster_path}` : null,
        overview: detail.overview
      });
    }
  }

  upsertCollectionCache({
    id: raw.id,
    name: raw.name,
    posterPath: raw.poster_path ? `${IMAGE_BASE}${raw.poster_path}` : null,
    backdropPath: raw.backdrop_path ? `${BACKDROP_BASE}${raw.backdrop_path}` : null,
    logoPath: null,
    movies
  });
}

async function fetchAndCacheCollectionFanart(apiKey: string, collectionId: number): Promise<void> {
  const logoPath = await fetchCollectionFanartLogo(apiKey, collectionId);
  upsertCollectionFanart(collectionId, logoPath);
}

function isUsableCollectionMovie(movie: TmdbMovieDetails) {
  const releaseDate = movie.release_date ?? movie.first_air_date ?? null;
  if (!releaseDate) return false;
  if (releaseDate > new Date().toISOString().slice(0, 10)) return false;
  return Boolean(movie.runtime && movie.runtime > 0);
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function getImdbRatings() {
  imdbRatingsPromise ??= loadImdbRatings();
  return imdbRatingsPromise;
}

async function loadImdbRatings() {
  const response = await fetch(IMDB_RATINGS_URL);
  if (!response.ok) throw new Error(`IMDb ratings dataset returned ${response.status}`);
  const compressed = Buffer.from(await response.arrayBuffer());
  const tsv = zlib.gunzipSync(compressed).toString("utf8");
  const ratings = new Map<string, { rating: number; votes: number }>();
  for (const line of tsv.split("\n").slice(1)) {
    const [id, rating, votes] = line.split("\t");
    if (!id || !rating || !votes) continue;
    ratings.set(id, {
      rating: Number(rating),
      votes: Number(votes)
    });
  }
  return ratings;
}

export async function searchPersonCredits(
  apiKey: string,
  query: string
): Promise<{ results: MovieResult[]; person: PersonHeader | null }> {
  const people = await tmdbFetch<{ results: TmdbPerson[] }>(apiKey, "/search/person", {
    query,
    include_adult: "false"
  });
  const person = people.results[0];
  if (!person) return { results: [], person: null };

  const key = `tmdb:person:${query}`;
  let movies = cacheGet<TmdbMovie[]>(key);
  if (!movies) {
    const credits = await tmdbFetch<{ cast: TmdbMovie[]; crew: TmdbMovie[] }>(apiKey, `/person/${person.id}/movie_credits`);
    const deduped = new Map<number, TmdbMovie>();
    for (const movie of [...credits.cast, ...credits.crew]) {
      if (movie.id && !deduped.has(movie.id)) deduped.set(movie.id, movie);
    }
    movies = [...deduped.values()];
    cacheSet(key, movies);
  }

  const meta = await fetchPersonMeta(apiKey, person.id);
  const header: PersonHeader = {
    id: person.id,
    name: person.name,
    profilePath: person.profile_path ? `${IMAGE_BASE}${person.profile_path}` : null,
    birthday: meta.birthday,
    deathday: meta.deathday,
    placeOfBirth: meta.placeOfBirth,
    knownFor:
      person.known_for?.map((movie) => movie.title ?? movie.name).filter(Boolean).slice(0, 2).join(", ") || null
  };

  return { results: sortMovies(movies.map(toMovieResult).filter(Boolean) as MovieResult[]), person: header };
}

export async function searchCompanyMovies(apiKey: string, query: string): Promise<MovieResult[]> {
  const key = `tmdb:company:${query}`;
  const cached = cacheGet<TmdbMovie[]>(key);
  if (cached) {
    return sortMovies(cached.map(toMovieResult).filter(Boolean) as MovieResult[]);
  }

  const companies = await tmdbFetch<{ results: TmdbCompany[] }>(apiKey, "/search/company", { query });
  const company = companies.results[0];
  if (!company) return [];

  const discover = await tmdbFetch<{ results: TmdbMovie[] }>(apiKey, "/discover/movie", {
    with_companies: String(company.id),
    sort_by: "primary_release_date.asc",
    include_adult: "false"
  });
  cacheSet(key, discover.results);
  return sortMovies(discover.results.map(toMovieResult).filter(Boolean) as MovieResult[]);
}
