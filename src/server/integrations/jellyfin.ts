import { normalizeTitle, yearFromDate } from "../services/normalize.js";
import { normalizeShowEpisodes, type RawEpisode } from "../services/tvFilter.js";
import { resolveTmdbIdFromImdb } from "./tmdb.js";
import type { MediaServer, MediaServerConnectionResult, MediaServerTvScanResult, MediaServerTvSkip } from "./mediaServer.js";
import type {
  MediaServerEpisode,
  MediaServerLibrary,
  MediaServerMovie,
  MediaServerSeason,
  MediaServerShow,
  MediaServerType
} from "../../shared/types.js";

const PAGE_SIZE = 500;

interface JellyfinSystemInfo {
  Id?: string;
  ServerName?: string;
  LocalAddress?: string;
  Version?: string;
  ProductName?: string;
}

interface JellyfinViewsResponse {
  Items?: JellyfinView[];
}

interface JellyfinUser {
  Id?: string;
  Name?: string;
}

interface JellyfinView {
  Id?: string;
  Name?: string;
  CollectionType?: string;
  Type?: string;
}

interface JellyfinItemsResponse {
  Items?: JellyfinMovie[];
  TotalRecordCount?: number;
}

interface JellyfinMovie {
  Id?: string;
  Name?: string;
  OriginalTitle?: string;
  ProductionYear?: number;
  PremiereDate?: string;
  ProviderIds?: Record<string, string | undefined>;
  ImageTags?: Record<string, string | undefined>;
  MediaSources?: JellyfinMediaSource[];
  MediaStreams?: JellyfinMediaStream[];
}

interface JellyfinMediaSource {
  MediaStreams?: JellyfinMediaStream[];
}

interface JellyfinMediaStream {
  Type?: string;
  Width?: number;
  Height?: number;
}

interface JellyfinSeries {
  Id?: string;
  Name?: string;
  ProductionYear?: number;
  PremiereDate?: string;
  ProviderIds?: Record<string, string | undefined>;
  ImageTags?: Record<string, string | undefined>;
}

interface JellyfinEpisode {
  Id?: string;
  /** Season number. */
  ParentIndexNumber?: number;
  /** Episode number within the season. */
  IndexNumber?: number;
  PremiereDate?: string;
}

interface JellyfinItemsPage<T> {
  Items?: T[];
  TotalRecordCount?: number;
}

interface EmbyFamilyOptions {
  type: Extract<MediaServerType, "jellyfin" | "emby">;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  userId: string;
  tmdbApiKey: string;
}

export class EmbyFamilyServer implements MediaServer {
  readonly type: Extract<MediaServerType, "jellyfin" | "emby">;
  readonly displayName: string;
  private resolvedUser: JellyfinUser | null = null;

  constructor(private readonly options: EmbyFamilyOptions) {
    this.type = options.type;
    this.displayName = options.displayName;
  }

  async testConnection(): Promise<MediaServerConnectionResult> {
    const info = await this.fetchJson<JellyfinSystemInfo>("/System/Info");
    await this.resolveUser();
    return {
      name: info.ServerName ?? info.ProductName ?? `${this.displayName} server`,
      version: info.Version ?? null
    };
  }

  async getServerId(): Promise<string | null> {
    const info = await this.fetchJson<JellyfinSystemInfo>("/System/Info");
    return info.Id ? String(info.Id) : null;
  }

  async getMovieLibraries(): Promise<MediaServerLibrary[]> {
    const user = await this.resolveUser();
    const response = await this.fetchJson<JellyfinViewsResponse>(`/Users/${encodeURIComponent(user.Id ?? this.userId)}/Views`);
    return (response.Items ?? [])
      .filter((view) => view.Id && view.Name && view.CollectionType === "movies")
      .map((view) => ({
        key: String(view.Id),
        title: String(view.Name),
        type: "movie"
      }));
  }

  async scanMovies(libraryIds: string[] = []): Promise<{ movies: MediaServerMovie[]; sections: string[] }> {
    const availableLibraries = await this.getMovieLibraries();
    const selected = new Set(libraryIds);
    const libraries = selected.size
      ? availableLibraries.filter((library) => selected.has(library.key))
      : availableLibraries;
    const movies: MediaServerMovie[] = [];

    for (const library of libraries) {
      const libraryMovies = await this.fetchLibraryMovies(library.key);
      for (const movie of libraryMovies) {
        const normalized = await this.toMediaServerMovie(movie);
        if (normalized) movies.push(normalized);
      }
    }

    return {
      movies,
      sections: libraries.map((library) => library.title)
    };
  }

  async getTvLibraries(): Promise<MediaServerLibrary[]> {
    const user = await this.resolveUser();
    const response = await this.fetchJson<JellyfinViewsResponse>(`/Users/${encodeURIComponent(user.Id ?? this.userId)}/Views`);
    return (response.Items ?? [])
      .filter((view) => view.Id && view.Name && view.CollectionType === "tvshows")
      .map((view) => ({
        key: String(view.Id),
        title: String(view.Name),
        type: "show" as const
      }));
  }

  async scanTv(libraryIds: string[] = []): Promise<MediaServerTvScanResult> {
    const availableLibraries = await this.getTvLibraries();
    const selected = new Set(libraryIds);
    const libraries = selected.size
      ? availableLibraries.filter((library) => selected.has(library.key))
      : availableLibraries;

    const shows: MediaServerShow[] = [];
    const seasons: MediaServerSeason[] = [];
    const episodes: MediaServerEpisode[] = [];
    const skipped: MediaServerTvSkip[] = [];
    let futureEpisodesExcluded = 0;

    for (const library of libraries) {
      const series = await this.fetchItems<JellyfinSeries>(
        library.key,
        "Series",
        "ProviderIds,ProductionYear,PremiereDate,ImageTags"
      );
      for (const show of series) {
        if (!show.Id || !show.Name) continue;
        const ratingKey = `${this.type}:${show.Id}`;
        const rawEpisodes = await this.fetchShowEpisodes(show.Id);
        const normalized = normalizeShowEpisodes(ratingKey, this.type, rawEpisodes);
        futureEpisodesExcluded += normalized.futureExcluded;

        if (!normalized.episodes.length) {
          skipped.push({
            title: show.Name,
            reason: normalized.badNumbering > 0 ? "unsupported-numbering" : "no-episodes"
          });
          continue;
        }

        const releaseDate = normalizeDate(show.PremiereDate);
        shows.push({
          mediaServerType: this.type,
          ratingKey,
          title: show.Name,
          normalizedTitle: normalizeTitle(show.Name),
          year: show.ProductionYear ?? yearFromDate(releaseDate),
          tmdbId: normalizeTmdbId(show.ProviderIds),
          imdbId: normalizeImdbId(show.ProviderIds),
          tvdbId: normalizeTvdbId(show.ProviderIds),
          posterPath: this.posterUrl(show)
        });
        seasons.push(...normalized.seasons);
        episodes.push(...normalized.episodes);
      }
    }

    return {
      shows,
      seasons,
      episodes,
      sections: libraries.map((library) => library.title),
      skipped,
      futureEpisodesExcluded
    };
  }

  private async fetchShowEpisodes(seriesId: string): Promise<RawEpisode[]> {
    const items = await this.fetchItems<JellyfinEpisode>(seriesId, "Episode", "ProviderIds,PremiereDate,ParentIndexNumber,IndexNumber");
    return items
      .filter((item) => item.Id)
      .map((item) => ({
        ratingKey: `${this.type}:${item.Id}`,
        seasonNumber: typeof item.ParentIndexNumber === "number" ? item.ParentIndexNumber : null,
        episodeNumber: typeof item.IndexNumber === "number" ? item.IndexNumber : null,
        airDate: normalizeDate(item.PremiereDate)
      }));
  }

  // Paginated /Items fetch shared by the TV show and episode scans, mirroring fetchLibraryMovies
  // (kept separate so the movie scan stays byte-for-byte unchanged).
  private async fetchItems<T>(parentId: string, includeItemTypes: string, fields: string): Promise<T[]> {
    const results: T[] = [];
    let startIndex = 0;
    let total = Number.POSITIVE_INFINITY;
    const user = await this.resolveUser();

    while (startIndex < total) {
      const params = new URLSearchParams({
        ParentId: parentId,
        Recursive: "true",
        IncludeItemTypes: includeItemTypes,
        Fields: fields,
        StartIndex: String(startIndex),
        Limit: String(PAGE_SIZE)
      });
      const response = await this.fetchJson<JellyfinItemsPage<T>>(
        `/Users/${encodeURIComponent(user.Id ?? this.userId)}/Items?${params.toString()}`
      );
      const items = response.Items ?? [];
      results.push(...items);
      total = response.TotalRecordCount ?? results.length;
      if (!items.length) break;
      startIndex += items.length;
    }

    return results;
  }

  private async fetchLibraryMovies(parentId: string): Promise<JellyfinMovie[]> {
    const movies: JellyfinMovie[] = [];
    let startIndex = 0;
    let total = Number.POSITIVE_INFINITY;
    const user = await this.resolveUser();

    while (startIndex < total) {
      const params = new URLSearchParams({
        ParentId: parentId,
        Recursive: "true",
        IncludeItemTypes: "Movie",
        Fields: "ProviderIds,ProductionYear,PremiereDate,ImageTags,MediaSources,MediaStreams",
        StartIndex: String(startIndex),
        Limit: String(PAGE_SIZE)
      });
      const response = await this.fetchJson<JellyfinItemsResponse>(`/Users/${encodeURIComponent(user.Id ?? this.userId)}/Items?${params.toString()}`);
      const items = response.Items ?? [];
      movies.push(...items);
      total = response.TotalRecordCount ?? movies.length;
      if (!items.length) break;
      startIndex += items.length;
    }

    return movies;
  }

  private async toMediaServerMovie(movie: JellyfinMovie): Promise<MediaServerMovie | null> {
    if (!movie.Id || !movie.Name) return null;
    const releaseDate = normalizeDate(movie.PremiereDate);
    const imdbId = normalizeImdbId(movie.ProviderIds);
    const directTmdbId = normalizeTmdbId(movie.ProviderIds);
    const tmdbId = directTmdbId ?? (imdbId ? await this.resolveTmdbId(imdbId) : null);

    return {
      mediaServerType: this.type,
      ratingKey: `${this.type}:${movie.Id}`,
      title: movie.Name,
      normalizedTitle: normalizeTitle(movie.Name),
      year: movie.ProductionYear ?? yearFromDate(releaseDate),
      releaseDate,
      tmdbId,
      imdbId,
      resolution: getResolution(movie),
      guid: imdbId ?? (tmdbId ? `tmdb://${tmdbId}` : null),
      posterPath: this.posterUrl(movie)
    };
  }

  private async resolveTmdbId(imdbId: string): Promise<number | null> {
    if (!this.options.tmdbApiKey) return null;
    try {
      return await resolveTmdbIdFromImdb(this.options.tmdbApiKey, imdbId);
    } catch {
      return null;
    }
  }

  private posterUrl(movie: { Id?: string; ImageTags?: Record<string, string | undefined> }): string | null {
    if (!movie.Id || !movie.ImageTags?.Primary) return null;
    const url = this.urls(`/Items/${encodeURIComponent(movie.Id)}/Images/Primary`)[0];
    url.searchParams.set("tag", movie.ImageTags.Primary);
    url.searchParams.set("quality", "90");
    url.searchParams.set("maxWidth", "500");
    url.searchParams.set("api_key", this.options.apiKey);
    return url.toString();
  }

  private async fetchJson<T>(path: string): Promise<T> {
    let lastStatus = 0;
    for (const url of this.urls(path)) {
      const response = await fetch(url, {
        headers: {
          "X-Emby-Token": this.options.apiKey,
          Accept: "application/json"
        }
      });
      if (response.ok) return (await response.json()) as T;
      lastStatus = response.status;
      if (!this.shouldTryNextUrl(response.status)) break;
    }
    throw new Error(`${this.displayName} returned ${lastStatus}`);
  }

  private urls(path: string): URL[] {
    const normalizedBase = this.options.baseUrl.endsWith("/") ? this.options.baseUrl : `${this.options.baseUrl}/`;
    const paths = this.type === "emby" ? [withPrefix(path, "/emby"), path] : [path];
    const seen = new Set<string>();
    return paths
      .map((candidate) => this.url(normalizedBase, candidate))
      .filter((url) => {
        const key = url.toString();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  private url(baseUrl: string, path: string): URL {
    const url = new URL(path, baseUrl);
    if (!url.searchParams.has("api_key")) {
      url.searchParams.set("api_key", this.options.apiKey);
    }
    return url;
  }

  private shouldTryNextUrl(status: number): boolean {
    return this.type === "emby" && [400, 404, 405].includes(status);
  }

  private async resolveUser(): Promise<JellyfinUser> {
    if (!this.userId) {
      throw new Error(`Add ${this.displayName} user ID in Settings first.`);
    }

    if (this.resolvedUser) return this.resolvedUser;
    const input = this.userId.trim();

    try {
      const users = await this.fetchJson<JellyfinUser[]>("/Users");
      const match = users.find(
        (user) =>
          user.Id?.toLowerCase() === input.toLowerCase() ||
          user.Name?.toLowerCase() === input.toLowerCase()
      );
      if (match?.Id) {
        this.resolvedUser = match;
        return match;
      }
    } catch (error) {
      if (!looksLikeUserId(input)) {
        throw error;
      }
    }

    if (looksLikeUserId(input)) {
      this.resolvedUser = { Id: input };
      return this.resolvedUser;
    }

    throw new Error(`${this.displayName} user "${input}" was not found. Enter the username exactly, or paste the user's ID from ${this.displayName}.`);
  }

  private get userId() {
    return this.options.userId;
  }
}

export class JellyfinServer extends EmbyFamilyServer {
  constructor(baseUrl: string, apiKey: string, userId: string, tmdbApiKey: string) {
    super({
      type: "jellyfin",
      displayName: "Jellyfin",
      baseUrl,
      apiKey,
      userId,
      tmdbApiKey
    });
  }
}

function normalizeProviderId(providerIds: Record<string, string | undefined> | undefined, key: string): string | null {
  if (!providerIds) return null;
  const match = Object.entries(providerIds).find(([provider]) => provider.toLowerCase() === key.toLowerCase());
  return match?.[1]?.trim() || null;
}

function normalizeTmdbId(providerIds: Record<string, string | undefined> | undefined): number | null {
  const raw = normalizeProviderId(providerIds, "Tmdb") ?? normalizeProviderId(providerIds, "TmdbMovie");
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeImdbId(providerIds: Record<string, string | undefined> | undefined): string | null {
  const raw = normalizeProviderId(providerIds, "Imdb");
  const match = raw?.match(/tt\d+/i);
  return match ? match[0] : null;
}

function normalizeTvdbId(providerIds: Record<string, string | undefined> | undefined): number | null {
  const raw = normalizeProviderId(providerIds, "Tvdb");
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeDate(value: string | undefined): string | null {
  if (!value) return null;
  return value.slice(0, 10);
}

function getResolution(movie: JellyfinMovie): string | null {
  const streams = [
    ...(movie.MediaStreams ?? []),
    ...(movie.MediaSources ?? []).flatMap((source) => source.MediaStreams ?? [])
  ];
  const videoStream = streams.find((stream) => stream.Type?.toLowerCase() === "video");
  const height = Number(videoStream?.Height);
  if (height >= 2160) return "4K";
  if (height >= 1080) return "1080p";
  if (height >= 720) return "720p";
  if (height > 0) return "SD";
  return null;
}

function looksLikeUserId(value: string): boolean {
  return /^[0-9a-f-]{24,}$/i.test(value);
}

function withPrefix(path: string, prefix: string) {
  if (path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`)) return path;
  return `${prefix}${path.startsWith("/") ? "" : "/"}${path}`;
}
