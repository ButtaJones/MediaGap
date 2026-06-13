import { XMLParser } from "fast-xml-parser";
import { normalizeTitle, yearFromDate } from "../services/normalize.js";
import type { PlexLibrary, PlexMovie } from "../../shared/types.js";

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

async function getXml(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Plex returned ${response.status}`);
  }
  return parser.parse(await response.text());
}

export async function testPlexConnection(baseUrl: string, token: string) {
  const xml = await getXml(plexUrl(baseUrl, "/identity", token));
  const container = xml.MediaContainer ?? {};
  return {
    name: container.friendlyName ?? container.machineIdentifier ?? "Plex server"
  };
}

export async function getMovieSections(baseUrl: string, token: string): Promise<PlexLibrary[]> {
  const xml = await getXml(plexUrl(baseUrl, "/library/sections", token));
  const directories = asArray(xml.MediaContainer?.Directory);
  return directories
    .filter((section) => section.type === "movie")
    .map((section) => ({
      key: String(section.key),
      title: String(section.title),
      type: "movie"
    }));
}

export async function scanPlexMovies(
  baseUrl: string,
  token: string,
  sectionKeys: string[] = []
): Promise<{ movies: PlexMovie[]; sections: string[] }> {
  const availableSections = await getMovieSections(baseUrl, token);
  const selected = new Set(sectionKeys);
  const sections = selected.size
    ? availableSections.filter((section) => selected.has(section.key))
    : availableSections;
  const movies: PlexMovie[] = [];

  for (const section of sections) {
    const url = plexUrl(baseUrl, `/library/sections/${section.key}/all`, token);
    const hydratedUrl = new URL(url);
    hydratedUrl.searchParams.set("type", "1");
    hydratedUrl.searchParams.set("includeGuids", "1");

    const xml = await getXml(hydratedUrl.toString());
    const videos = asArray<PlexVideo>(xml.MediaContainer?.Video);

    for (const video of videos) {
      if (!video.ratingKey || !video.title) continue;
      const releaseDate = video.originallyAvailableAt ?? null;
      movies.push({
        ratingKey: String(video.ratingKey),
        title: video.title,
        normalizedTitle: normalizeTitle(video.title),
        year: video.year ? Number(video.year) : yearFromDate(releaseDate),
        releaseDate,
        tmdbId: extractTmdbId(video),
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
