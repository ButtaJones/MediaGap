import {
  cacheGet,
  cacheSet,
  listCachedCollections,
  listMissingCollectionCacheIds,
  listMissingCollectionMapIds,
  listOwnedCollectionIds,
  listPlexMovieTmdbIds,
  matchMovie,
  upsertCollectionCache,
  upsertMovieCollectionMaps
} from "../db.js";
import type { CachedCollectionMovie } from "../db.js";
import { yearFromDate } from "../services/normalize.js";
import { DISCOVER_COLLECTIONS } from "../seeds/discoverCollections.js";
import zlib from "node:zlib";
import type {
  CollectionsRefreshResponse,
  CollectionsRefreshStatus,
  CollectionsResponse,
  MovieDetails,
  MovieResult,
  SearchSuggestion
} from "../../shared/types.js";

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p/w342";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w780";
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

interface TmdbMovieDetails extends TmdbMovie {
  runtime?: number | null;
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

export function startContinueCollectionsRefresh(apiKey: string): CollectionsRefreshStatus {
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

  collectionRefreshPromise = refreshContinueCollections(apiKey)
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

export async function getMovieDetails(apiKey: string, tmdbId: number): Promise<MovieDetails> {
  const raw = await getMovieDetailsRaw(apiKey, tmdbId);

  const movie = toMovieResult(raw);
  if (!movie) throw new Error("TMDb did not return movie details.");
  const externalIds = raw as TmdbMovieDetails & { external_ids?: { imdb_id?: string | null } };
  const imdbId = movie.imdbId ?? externalIds.external_ids?.imdb_id ?? null;
  const imdbRating = imdbId ? (await getImdbRatings()).get(imdbId) : null;

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
    tagline: raw.tagline || null,
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

export async function refreshContinueCollections(apiKey: string): Promise<CollectionsRefreshResponse> {
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
      ? `Checking ${missingMapIds.length.toLocaleString()} owned Plex movies for TMDb collection data...`
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
    movies
  });
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

export async function searchPersonCredits(apiKey: string, query: string): Promise<MovieResult[]> {
  const key = `tmdb:person:${query}`;
  const cached = cacheGet<TmdbMovie[]>(key);
  if (cached) {
    return sortMovies(cached.map(toMovieResult).filter(Boolean) as MovieResult[]);
  }

  const people = await tmdbFetch<{ results: TmdbPerson[] }>(apiKey, "/search/person", {
    query,
    include_adult: "false"
  });
  const person = people.results[0];
  if (!person) return [];

  const credits = await tmdbFetch<{ cast: TmdbMovie[]; crew: TmdbMovie[] }>(apiKey, `/person/${person.id}/movie_credits`);
  const deduped = new Map<number, TmdbMovie>();
  for (const movie of [...credits.cast, ...credits.crew]) {
    if (movie.id && !deduped.has(movie.id)) deduped.set(movie.id, movie);
  }
  const movies = [...deduped.values()];
  cacheSet(key, movies);
  return sortMovies(movies.map(toMovieResult).filter(Boolean) as MovieResult[]);
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
