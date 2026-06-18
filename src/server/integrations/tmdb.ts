import {
  cacheGet,
  cacheSet,
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
  MovieDetails,
  MovieResult,
  PersonHeader,
  SearchSuggestion
} from "../../shared/types.js";

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p/w342";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w780";
const LOGO_BASE = "https://image.tmdb.org/t/p/original";
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
