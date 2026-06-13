import { cacheGet, cacheSet, matchMovie } from "../db.js";
import { yearFromDate } from "../services/normalize.js";
import zlib from "node:zlib";
import type { MovieDetails, MovieResult, SearchSuggestion } from "../../shared/types.js";

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p/w342";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w780";
const IMDB_RATINGS_URL = "https://datasets.imdbws.com/title.ratings.tsv.gz";
let imdbRatingsPromise: Promise<Map<string, { rating: number; votes: number }>> | null = null;

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
  credits?: {
    cast?: TmdbCastMember[];
    crew?: TmdbCrewMember[];
  };
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
    throw new Error(`TMDb returned ${response.status}`);
  }
  return (await response.json()) as T;
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

export async function searchImdbList(apiKey: string, listUrl: string): Promise<MovieResult[]> {
  const imdbIds = await getImdbIdsFromInput(listUrl);
  const key = `imdb-list:${imdbIds.join(",")}`;
  const cached = cacheGet<TmdbMovie[]>(key);
  const raw = cached ?? (await findMoviesByImdbIds(apiKey, imdbIds));
  if (!cached) cacheSet(key, raw);
  const ratings = await getImdbRatings();

  return raw
    .map(toMovieResult)
    .filter(Boolean)
    .map((movie, index) => {
      const result = movie as MovieResult;
      const imdbId = result.imdbId ?? imdbIds[index] ?? null;
      const rating = imdbId ? ratings.get(imdbId) : null;
      return {
        ...result,
        imdbId,
        imdbRating: rating?.rating ?? null,
        imdbVotes: rating?.votes ?? null,
        listRank: index + 1
      };
    });
}

export async function getMovieDetails(apiKey: string, tmdbId: number): Promise<MovieDetails> {
  const key = `tmdb:movie-details:${tmdbId}`;
  const cached = cacheGet<TmdbMovieDetails>(key);
  const raw =
    cached ??
    (await tmdbFetch<TmdbMovieDetails>(apiKey, `/movie/${tmdbId}`, {
      append_to_response: "credits,external_ids"
    }));
  if (!cached) cacheSet(key, raw);

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

function parseImdbUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Paste a full IMDb list or chart URL.");
  }
  if (!/(^|\.)imdb\.com$/i.test(url.hostname)) {
    throw new Error("IMDb list search only supports imdb.com URLs.");
  }
  return url;
}

async function getImdbIdsFromInput(input: string) {
  const trimmed = input.trim();
  const directIds = extractImdbTitleIds(trimmed);
  if (directIds.length) return directIds.slice(0, 250);

  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("Paste an IMDb URL, IMDb export CSV, or copied IMDb page text.");
  }

  const url = parseImdbUrl(trimmed);
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,text/csv,*/*",
      "Accept-Language": "en-US,en;q=0.9"
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`IMDb returned ${response.status}`);

  const ids = extractImdbTitleIds(text);
  if (ids.length) return ids.slice(0, 250);

  if (response.status === 202 || text.length < 100) {
    throw new Error(
      "IMDb blocked the URL request. Open the IMDb list in your browser, export/copy the list page, then paste that CSV or page text into this same search box."
    );
  }

  throw new Error("No IMDb movie titles were found. Paste an IMDb export CSV or copied page text if the URL is blocked.");
}

async function findMoviesByImdbIds(apiKey: string, imdbIds: string[]) {
  if (!imdbIds.length) throw new Error("No IMDb movie titles were found.");

  const movies: TmdbMovie[] = [];
  const concurrency = 8;
  for (let index = 0; index < imdbIds.length; index += concurrency) {
    const batch = imdbIds.slice(index, index + concurrency);
    const found = await Promise.all(batch.map((imdbId) => findMovieByImdbId(apiKey, imdbId)));
    for (let batchIndex = 0; batchIndex < found.length; batchIndex += 1) {
      const movie = found[batchIndex];
      if (movie) {
        movies.push({
          ...movie,
          imdb_id: batch[batchIndex]
        });
      }
    }
  }
  return movies;
}

export function extractImdbTitleIds(html: string) {
  const ids = new Set<string>();
  const pattern = /tt\d{7,9}\b/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    ids.add(match[0]);
  }
  return [...ids];
}

async function findMovieByImdbId(apiKey: string, imdbId: string) {
  const key = `tmdb:find-imdb:${imdbId}`;
  const cached = cacheGet<TmdbMovie | null>(key);
  if (cached !== null) return cached;

  const response = await tmdbFetch<{ movie_results?: TmdbMovie[] }>(apiKey, `/find/${imdbId}`, {
    external_source: "imdb_id"
  });
  const movie = response.movie_results?.[0] ?? null;
  cacheSet(key, movie);
  return movie;
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
