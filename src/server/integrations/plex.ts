import { XMLParser } from "fast-xml-parser";
import { normalizeTitle, yearFromDate } from "../services/normalize.js";
import { normalizeShowEpisodes, type RawEpisode } from "../services/tvFilter.js";
import type { MediaServer } from "./mediaServer.js";
import type { MediaServerConnectionResult, MediaServerTvScanResult, MediaServerTvSkip } from "./mediaServer.js";
import type {
  MediaServerEpisode,
  MediaServerLibrary,
  MediaServerMovie,
  MediaServerSeason,
  MediaServerShow,
  PlexLibrary,
  PlexMovie
} from "../../shared/types.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ""
});

interface GuidBearing {
  guid?: string;
  Guid?: { id?: string } | Array<{ id?: string }>;
}

interface PlexVideo extends GuidBearing {
  ratingKey?: string;
  title?: string;
  year?: number;
  originallyAvailableAt?: string;
  thumb?: string;
  /** Episode number (within its season) when this Video is an episode. */
  index?: number | string;
  /** Season number when this Video is an episode. */
  parentIndex?: number | string;
  Media?: PlexMedia | PlexMedia[];
}

interface PlexDirectory extends GuidBearing {
  ratingKey?: string;
  title?: string;
  year?: number;
  thumb?: string;
  type?: string;
}

interface PlexMedia {
  videoResolution?: string;
  width?: number;
  height?: number;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function toIntOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function plexUrl(baseUrl: string, pathname: string, token: string): string {
  const url = new URL(pathname, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  url.searchParams.set("X-Plex-Token", token);
  return url.toString();
}

function guidCandidates(item: GuidBearing): string[] {
  return [item.guid, ...asArray(item.Guid).map((guid) => guid.id)].filter(Boolean) as string[];
}

function extractTmdbId(item: GuidBearing): number | null {
  for (const candidate of guidCandidates(item)) {
    const tmdb = candidate.match(/tmdb:\/\/(\d+)/i) ?? candidate.match(/themoviedb:\/\/(\d+)/i);
    if (tmdb) return Number(tmdb[1]);
  }

  return null;
}

function extractImdbId(item: GuidBearing): string | null {
  for (const candidate of guidCandidates(item)) {
    const imdb = candidate.match(/imdb:\/\/(tt\d+)/i) ?? candidate.match(/imdb\.com\/title\/(tt\d+)/i);
    if (imdb) return imdb[1];
  }

  return null;
}

// Matches both the modern `tvdb://73244` Guid and the legacy `com.plexapp.agents.thetvdb://73244`
// agent string (TV shows on Plex often carry only a TVDB id, resolved to TMDb later via /find).
function extractTvdbId(item: GuidBearing): number | null {
  for (const candidate of guidCandidates(item)) {
    const tvdb = candidate.match(/tvdb:\/\/(\d+)/i);
    if (tvdb) return Number(tvdb[1]);
  }

  return null;
}

function extractResolution(video: PlexVideo): string | null {
  const media = asArray(video.Media)[0];
  if (!media) return null;
  if (media.videoResolution) return String(media.videoResolution);
  const height = Number(media.height);
  if (height >= 2160) return "4K";
  if (height >= 1080) return "1080p";
  if (height >= 720) return "720p";
  if (height > 0) return "SD";
  return null;
}

async function getXml(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Plex returned ${response.status}`);
  }
  return parser.parse(await response.text());
}

export class PlexServer implements MediaServer {
  readonly type = "plex" as const;
  readonly displayName = "Plex";

  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  async testConnection(): Promise<MediaServerConnectionResult> {
    const xml = await getXml(plexUrl(this.baseUrl, "/identity", this.token));
    const container = xml.MediaContainer ?? {};
    return {
      name: container.friendlyName ?? container.machineIdentifier ?? "Plex server",
      version: container.version ?? null
    };
  }

  async getServerId(): Promise<string | null> {
    const xml = await getXml(plexUrl(this.baseUrl, "/identity", this.token));
    const machineId = xml.MediaContainer?.machineIdentifier;
    return machineId ? String(machineId) : null;
  }

  async getMovieLibraries(): Promise<MediaServerLibrary[]> {
    const xml = await getXml(plexUrl(this.baseUrl, "/library/sections", this.token));
    const directories = asArray(xml.MediaContainer?.Directory);
    return directories
      .filter((section) => section.type === "movie")
      .map((section) => ({
        key: String(section.key),
        title: String(section.title),
        type: "movie"
      }));
  }

  async scanMovies(sectionKeys: string[] = []): Promise<{ movies: MediaServerMovie[]; sections: string[] }> {
    const availableSections = await this.getMovieLibraries();
    const selected = new Set(sectionKeys);
    const sections = selected.size
      ? availableSections.filter((section) => selected.has(section.key))
      : availableSections;
    const movies: MediaServerMovie[] = [];

    for (const section of sections) {
      const url = plexUrl(this.baseUrl, `/library/sections/${section.key}/all`, this.token);
      const hydratedUrl = new URL(url);
      hydratedUrl.searchParams.set("type", "1");
      hydratedUrl.searchParams.set("includeGuids", "1");

      const xml = await getXml(hydratedUrl.toString());
      const videos = asArray<PlexVideo>(xml.MediaContainer?.Video);

      for (const video of videos) {
        if (!video.ratingKey || !video.title) continue;
        const releaseDate = video.originallyAvailableAt ?? null;
        movies.push({
          mediaServerType: this.type,
          ratingKey: String(video.ratingKey),
          title: video.title,
          normalizedTitle: normalizeTitle(video.title),
          year: video.year ? Number(video.year) : yearFromDate(releaseDate),
          releaseDate,
          tmdbId: extractTmdbId(video),
          imdbId: extractImdbId(video),
          resolution: extractResolution(video),
          guid: video.guid ?? null,
          posterPath: video.thumb ?? null
        });
      }
    }

    return {
      movies,
      sections: sections.map((section) => section.title)
    };
  }

  async getTvLibraries(): Promise<MediaServerLibrary[]> {
    const xml = await getXml(plexUrl(this.baseUrl, "/library/sections", this.token));
    const directories = asArray(xml.MediaContainer?.Directory);
    return directories
      .filter((section) => section.type === "show")
      .map((section) => ({
        key: String(section.key),
        title: String(section.title),
        type: "show" as const
      }));
  }

  async scanTv(sectionKeys: string[] = []): Promise<MediaServerTvScanResult> {
    const availableSections = await this.getTvLibraries();
    const selected = new Set(sectionKeys);
    const sections = selected.size
      ? availableSections.filter((section) => selected.has(section.key))
      : availableSections;

    const shows: MediaServerShow[] = [];
    const seasons: MediaServerSeason[] = [];
    const episodes: MediaServerEpisode[] = [];
    const skipped: MediaServerTvSkip[] = [];
    let futureEpisodesExcluded = 0;

    for (const section of sections) {
      const url = new URL(plexUrl(this.baseUrl, `/library/sections/${section.key}/all`, this.token));
      url.searchParams.set("type", "2"); // 2 = shows
      url.searchParams.set("includeGuids", "1");

      const xml = await getXml(url.toString());
      const directories = asArray<PlexDirectory>(xml.MediaContainer?.Directory);

      for (const directory of directories) {
        if (!directory.ratingKey || !directory.title) continue;
        const ratingKey = String(directory.ratingKey);
        const rawEpisodes = await this.fetchShowEpisodes(ratingKey);
        const normalized = normalizeShowEpisodes(ratingKey, this.type, rawEpisodes);
        futureEpisodesExcluded += normalized.futureExcluded;

        if (!normalized.episodes.length) {
          // A show with episodes that couldn't be mapped to normal numbering (anime absolute /
          // daily air-date numbering) is logged as unsupported; one with no usable episodes at all
          // (empty, all-special, or all-unaired) is simply skipped.
          skipped.push({
            title: directory.title,
            reason: normalized.badNumbering > 0 ? "unsupported-numbering" : "no-episodes"
          });
          continue;
        }

        shows.push({
          mediaServerType: this.type,
          ratingKey,
          title: directory.title,
          normalizedTitle: normalizeTitle(directory.title),
          year: directory.year ? Number(directory.year) : null,
          tmdbId: extractTmdbId(directory),
          imdbId: extractImdbId(directory),
          tvdbId: extractTvdbId(directory),
          posterPath: directory.thumb ?? null
        });
        seasons.push(...normalized.seasons);
        episodes.push(...normalized.episodes);
      }
    }

    return {
      shows,
      seasons,
      episodes,
      sections: sections.map((section) => section.title),
      skipped,
      futureEpisodesExcluded
    };
  }

  // One call per show returns every episode across all seasons (`allLeaves`), each carrying its
  // season (`parentIndex`) and episode (`index`) number plus air date — the empirical owned truth.
  private async fetchShowEpisodes(showRatingKey: string): Promise<RawEpisode[]> {
    const url = plexUrl(this.baseUrl, `/library/metadata/${encodeURIComponent(showRatingKey)}/allLeaves`, this.token);
    const xml = await getXml(url);
    const videos = asArray<PlexVideo>(xml.MediaContainer?.Video);
    return videos
      .filter((video) => video.ratingKey)
      .map((video) => ({
        ratingKey: String(video.ratingKey),
        seasonNumber: toIntOrNull(video.parentIndex),
        episodeNumber: toIntOrNull(video.index),
        airDate: video.originallyAvailableAt ?? null
      }));
  }
}

export async function testPlexConnection(baseUrl: string, token: string) {
  return new PlexServer(baseUrl, token).testConnection();
}

export async function getMovieSections(baseUrl: string, token: string): Promise<PlexLibrary[]> {
  return new PlexServer(baseUrl, token).getMovieLibraries();
}

export async function scanPlexMovies(
  baseUrl: string,
  token: string,
  sectionKeys: string[] = []
): Promise<{ movies: PlexMovie[]; sections: string[] }> {
  return new PlexServer(baseUrl, token).scanMovies(sectionKeys);
}
