import { cacheGet, cacheSet, matchMovie } from "../db.js";
import { normalizeTitle, yearFromDate } from "../services/normalize.js";
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

interface ImdbListEntry {
  imdbId?: string;
  title?: string;
  year?: number | null;
  imdbRating?: number | null;
  imdbVotes?: number | null;
  rank: number;
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
  const entries = await getImdbEntriesFromInput(listUrl);
  const found = await findMoviesByImdbEntries(apiKey, entries);
  const ratings = await getImdbRatings();

  return found
    .map(({ movie, entry }) => {
      const result = toMovieResult(movie);
      if (!result) return null;
      const imdbId = result.imdbId ?? movie.imdb_id ?? entry.imdbId ?? null;
      const rating = imdbId ? ratings.get(imdbId) : null;
      return {
        ...result,
        imdbId,
        imdbRating: rating?.rating ?? entry.imdbRating ?? null,
        imdbVotes: rating?.votes ?? entry.imdbVotes ?? null,
        listRank: entry.rank
      };
    })
    .filter(Boolean) as MovieResult[];
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

async function getImdbEntriesFromInput(input: string) {
  const trimmed = input.trim();
  const directEntries = extractImdbListEntries(trimmed);
  if (directEntries.length) return directEntries.slice(0, 250);

  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("Paste an IMDb URL, copied IMDb page text, or raw tt IDs.");
  }

  const url = parseImdbUrl(trimmed);
  for (const candidate of imdbCandidateUrls(url)) {
    const response = await fetch(candidate, {
      headers: imdbRequestHeaders()
    });
    const text = await response.text();
    if (isBlockedImdbResponse(response, text)) continue;
    if (!response.ok) continue;

    const entries = extractImdbListEntries(text);
    if (entries.length) return entries.slice(0, 250);
  }

  throw new Error(
    "IMDb blocked direct URL importing. Open that IMDb page in your browser, press Command+A then Command+C, then paste the copied page text here. No CSV export needed."
  );
}

function imdbRequestHeaders() {
  return {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,text/csv,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Referer: "https://www.imdb.com/"
  };
}

function imdbCandidateUrls(url: URL) {
  const candidates = new Map<string, URL>();
  const add = (value: string | URL) => {
    const candidate = new URL(value.toString());
    candidate.hash = "";
    candidates.set(candidate.href, candidate);
  };

  add(url);

  const listMatch = url.pathname.match(/\/list\/(ls\d+)/i);
  if (listMatch) {
    const id = listMatch[1];
    add(`https://www.imdb.com/list/${id}/`);
    add(`https://www.imdb.com/list/${id}/export`);
    add(`https://www.imdb.com/list/${id}/export?ref_=ttls_export`);
  }

  if (/\/chart\/top\/?/i.test(url.pathname)) {
    add("https://www.imdb.com/chart/top/");
  }

  return [...candidates.values()];
}

function isBlockedImdbResponse(response: Response, text: string) {
  const wafAction = response.headers.get("x-amzn-waf-action");
  return (
    response.status === 202 ||
    wafAction === "challenge" ||
    /verify that you're not a robot/i.test(text) ||
    /captcha/i.test(text)
  );
}

async function findMoviesByImdbEntries(apiKey: string, entries: ImdbListEntry[]) {
  if (!entries.length) throw new Error("No IMDb movie titles were found.");

  const movies: Array<{ movie: TmdbMovie; entry: ImdbListEntry }> = [];
  const concurrency = 6;
  for (let index = 0; index < entries.length; index += concurrency) {
    const batch = entries.slice(index, index + concurrency);
    const found = await Promise.all(batch.map((entry) => findMovieByImdbEntry(apiKey, entry)));
    for (let batchIndex = 0; batchIndex < found.length; batchIndex += 1) {
      const movie = found[batchIndex];
      if (movie) {
        movies.push({
          movie,
          entry: batch[batchIndex]
        });
      }
    }
  }
  return movies;
}

async function findMovieByImdbEntry(apiKey: string, entry: ImdbListEntry) {
  if (entry.imdbId) {
    const movie = await findMovieByImdbId(apiKey, entry.imdbId);
    if (movie) return { ...movie, imdb_id: entry.imdbId };
  }
  if (entry.title) {
    return findMovieByTitleYear(apiKey, entry.title, entry.year ?? null);
  }
  return null;
}

async function findMovieByTitleYear(apiKey: string, title: string, year: number | null) {
  const key = `tmdb:find-title-year:${normalizeTitle(title)}:${year ?? ""}`;
  const cached = cacheGet<TmdbMovie | null>(key);
  if (cached !== null) return cached;

  const withYear =
    year ?
      (
        await tmdbFetch<{ results: TmdbMovie[] }>(apiKey, "/search/movie", {
          query: title,
          include_adult: "false",
          primary_release_year: String(year),
          year: String(year)
        })
      ).results
    : [];
  const fallback =
    withYear.length || !year
      ? withYear
      : (
          await tmdbFetch<{ results: TmdbMovie[] }>(apiKey, "/search/movie", {
            query: title,
            include_adult: "false"
          })
        ).results;
  const movie = pickBestTitleMatch(fallback, title, year);
  cacheSet(key, movie);
  return movie;
}

function pickBestTitleMatch(movies: TmdbMovie[], title: string, year: number | null) {
  const normalized = normalizeTitle(title);
  const scored = movies
    .map((movie) => {
      const candidateTitle = normalizeTitle(movie.title ?? movie.name ?? "");
      const candidateYear = yearFromDate(movie.release_date ?? movie.first_air_date ?? null);
      let score = 0;
      if (candidateTitle === normalized) score += 100;
      else if (candidateTitle.includes(normalized) || normalized.includes(candidateTitle)) score += 55;
      if (year && candidateYear === year) score += 35;
      else if (year && candidateYear && Math.abs(candidateYear - year) === 1) score += 15;
      score += Math.min(movie.popularity ?? 0, 50) / 10;
      return { movie, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.score >= 55 ? scored[0].movie : null;
}

export function extractImdbListEntries(input: string): ImdbListEntry[] {
  const directIds = extractImdbTitleIds(input);
  if (directIds.length) {
    return directIds.map((imdbId, index) => ({ imdbId, rank: index + 1 }));
  }

  const lines = toPlainText(input)
    .split(/\r?\n/)
    .map(cleanImdbLine)
    .filter(Boolean);
  const entries: ImdbListEntry[] = [];
  const seen = new Set<string>();
  const hasRankedLines = lines.some((line) => /^(?:#\s*)?\d{1,4}[.)]\s+/.test(line));

  for (let index = 0; index < lines.length && entries.length < 250; index += 1) {
    const nearby = lines.slice(index + 1, index + 8);
    const parsed = parseRankedImdbLine(lines[index], nearby) ?? (hasRankedLines ? null : parseUnrankedImdbLine(lines[index], nearby, entries.length + 1));
    if (!parsed) continue;

    const key = `${normalizeTitle(parsed.title ?? "")}:${parsed.year ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(parsed);
  }

  return entries;
}

function parseRankedImdbLine(line: string, nearby: string[]): ImdbListEntry | null {
  const match = line.match(/^(?:#\s*)?(\d{1,4})[.)]\s+(.+)$/);
  if (!match) return null;
  return parseTitleEntry(match[2], nearby, Number(match[1]));
}

function parseUnrankedImdbLine(line: string, nearby: string[], rank: number): ImdbListEntry | null {
  if (!looksLikeTitleLine(line)) return null;
  return parseTitleEntry(line, nearby, rank);
}

function parseTitleEntry(rawTitle: string, nearby: string[], rank: number): ImdbListEntry | null {
  const { title, year } = splitTitleAndYear(rawTitle, nearby);
  if (!title || !looksLikeTitleLine(title)) return null;
  if (!year) return null;

  return {
    title,
    year,
    imdbRating: findNearbyRating(nearby),
    imdbVotes: findNearbyVotes(nearby),
    rank
  };
}

function splitTitleAndYear(rawTitle: string, nearby: string[]) {
  const compact = cleanImdbLine(rawTitle);
  const parenthesizedYear = compact.match(/^(.+?)\s*\(((?:18|19|20)\d{2})\)/);
  if (parenthesizedYear) {
    return { title: cleanTitleCandidate(parenthesizedYear[1]), year: Number(parenthesizedYear[2]) };
  }

  const inlineYear = compact.match(/^(.+?)\s+((?:18|19|20)\d{2})(?:\b|$)/);
  if (inlineYear) {
    return { title: cleanTitleCandidate(inlineYear[1]), year: Number(inlineYear[2]) };
  }

  return {
    title: cleanTitleCandidate(compact),
    year: findNearbyYear(nearby)
  };
}

function findNearbyYear(lines: string[]) {
  for (const line of lines.slice(0, 4)) {
    const match = line.match(/\b((?:18|19|20)\d{2})\b/);
    if (match) return Number(match[1]);
  }
  return null;
}

function findNearbyRating(lines: string[]) {
  for (const line of lines.slice(0, 6)) {
    const match = line.match(/^(?:IMDb\s*)?([1-9](?:\.\d)?|10(?:\.0)?)(?:\s*\/\s*10)?(?:\s|$|\()/i);
    if (match) return Number(match[1]);
  }
  return null;
}

function findNearbyVotes(lines: string[]) {
  for (const line of lines.slice(0, 6)) {
    const match = line.match(/\(([\d,.]+)\s*([KMB]?)\)/i);
    if (!match) continue;
    const base = Number(match[1].replace(/,/g, ""));
    const multiplier = match[2].toUpperCase() === "B" ? 1_000_000_000 : match[2].toUpperCase() === "M" ? 1_000_000 : match[2].toUpperCase() === "K" ? 1_000 : 1;
    return Math.round(base * multiplier);
  }
  return null;
}

function toPlainText(input: string) {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function cleanImdbLine(line: string) {
  return line
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTitleCandidate(title: string) {
  return cleanImdbLine(title)
    .replace(/\s+\((?:I|II|III|IV|V|VI|VII|VIII|IX|X)\)$/i, "")
    .replace(/\s+-\s+IMDb.*$/i, "")
    .replace(/\s+Rate$/i, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function looksLikeTitleLine(line: string) {
  const normalized = cleanImdbLine(line);
  if (normalized.length < 2 || normalized.length > 180) return false;
  if (/^(?:\d{1,4}|(?:18|19|20)\d{2}|[0-9.]+|rate|watchlist)$/i.test(normalized)) return false;
  if (/^\d+h\b/i.test(normalized) || /^[1-9](?:\.\d)?\s*\(/.test(normalized)) return false;
  if (/\b(imdb|privacy|help|sign in|create account|sort by|filter|list activity|your watchlist|recently viewed)\b/i.test(normalized)) {
    return false;
  }
  return /[A-Za-z]/.test(normalized);
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
