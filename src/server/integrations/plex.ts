import { XMLParser } from "fast-xml-parser";
import { normalizeTitle, yearFromDate } from "../services/normalize.js";
import type { MediaServer } from "./mediaServer.js";
import type { MediaServerConnectionResult } from "./mediaServer.js";
import type { MediaServerLibrary, MediaServerMovie, PlexLibrary, PlexMovie } from "../../shared/types.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ""
});

interface PlexVideo {
  ratingKey?: string;
  title?: string;
  year?: number;
  originallyAvailableAt?: string;
  guid?: string;
  thumb?: string;
  Guid?: { id?: string } | Array<{ id?: string }>;
  Media?: PlexMedia | PlexMedia[];
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

function plexUrl(baseUrl: string, pathname: string, token: string): string {
  const url = new URL(pathname, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  url.searchParams.set("X-Plex-Token", token);
  return url.toString();
}

function extractTmdbId(video: PlexVideo): number | null {
  const candidates = [
    video.guid,
    ...asArray(video.Guid).map((guid) => guid.id)
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const tmdb = candidate.match(/tmdb:\/\/(\d+)/i) ?? candidate.match(/themoviedb:\/\/(\d+)/i);
    if (tmdb) return Number(tmdb[1]);
  }

  return null;
}

function extractImdbId(video: PlexVideo): string | null {
  const candidates = [
    video.guid,
    ...asArray(video.Guid).map((guid) => guid.id)
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const imdb = candidate.match(/imdb:\/\/(tt\d+)/i) ?? candidate.match(/imdb\.com\/title\/(tt\d+)/i);
    if (imdb) return imdb[1];
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
