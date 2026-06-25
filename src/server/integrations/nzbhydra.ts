import { XMLParser } from "fast-xml-parser";
import type { NzbResult, NzbSearchResponse, QualityFilter, SourceFilter } from "../../shared/types.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ""
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function hydraApiUrl(baseUrl: string) {
  return new URL("api", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
}

function filterTerms(qualities: QualityFilter[], sources: SourceFilter[]) {
  return [...qualities, ...sources].map((term) => term.replace("4K", "2160p"));
}

export function normalizeReleaseSearchTitle(title: string) {
  return title
    .normalize("NFKD")
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function ageInDays(date: string | undefined): number | null {
  if (!date) return null;
  const ms = Date.now() - new Date(date).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor(ms / 86_400_000));
}

function attrValue(attrs: Array<{ name?: string; value?: string }> | { name?: string; value?: string } | undefined, name: string) {
  return asArray(attrs).find((attr) => attr.name === name)?.value ?? null;
}

function firstAttrValue(
  attrs: Array<{ name?: string; value?: string }> | { name?: string; value?: string } | undefined,
  names: string[]
) {
  for (const name of names) {
    const value = attrValue(attrs, name);
    if (value) return value;
  }
  return null;
}

export function buildNzbHydraQuery(
  title: string,
  year: number | null,
  qualities: QualityFilter[],
  sources: SourceFilter[],
  extraTerms: string
) {
  const terms = [
    normalizeReleaseSearchTitle(title),
    year ? String(year) : "",
    ...filterTerms(qualities, sources),
    extraTerms.trim()
  ].filter(Boolean);
  return terms.join(" ");
}

export async function testNzbHydraConnection(baseUrl: string, apiKey: string) {
  const url = hydraApiUrl(baseUrl);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("t", "caps");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`NZBHydra returned ${response.status}`);
  return { name: "NZBHydra" };
}

// Shared Newznab/NZBHydra RSS parser — used by both the movie (t=search) and TV (t=tvsearch) paths
// so the item mapping lives in one place.
function parseNzbHydraResponse(xmlText: string, query: string, limit: number, offset: number): NzbSearchResponse {
  const xml = parser.parse(xmlText);
  const items = asArray(xml.rss?.channel?.item);
  const hydraResponse = xml.rss?.channel?.["newznab:response"];
  const total = hydraResponse?.total ? Number(hydraResponse.total) : null;

  return {
    query,
    total: Number.isFinite(total) ? total : null,
    offset,
    limit,
    results: items.map((item) => ({
      title: item.title ?? "Untitled release",
      link: item.link ?? "",
      guid: typeof item.guid === "string" ? item.guid : item.guid?.["#text"] ?? null,
      size: Number(attrValue(item["newznab:attr"], "size")) || null,
      ageDays: ageInDays(item.pubDate),
      indexer:
        firstAttrValue(item["newznab:attr"], [
          "hydraIndexerName",
          "hydraIndexer",
          "indexer",
          "source"
        ]) ?? item["hydra:indexer"] ?? null,
      category: firstAttrValue(item["newznab:attr"], ["category", "categoryId"]) ?? item.category ?? null,
      publishDate: item.pubDate ?? null
    }))
  };
}

export async function searchNzbHydra(
  baseUrl: string,
  apiKey: string,
  title: string,
  year: number | null,
  qualities: QualityFilter[],
  sources: SourceFilter[],
  extraTerms: string,
  limit: number,
  offset: number,
  customQuery?: string
): Promise<NzbSearchResponse> {
  const query = customQuery?.trim() || buildNzbHydraQuery(title, year, qualities, sources, extraTerms);
  const url = hydraApiUrl(baseUrl);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("t", "search");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));

  const response = await fetch(url);
  if (!response.ok) throw new Error(`NZBHydra returned ${response.status}`);
  return parseNzbHydraResponse(await response.text(), query, limit, offset);
}

function seasonEpisodeTag(season: number, episode: number | null): string {
  const seasonTag = `S${String(season).padStart(2, "0")}`;
  return episode != null ? `${seasonTag}E${String(episode).padStart(2, "0")}` : seasonTag;
}

// `Show Title S02` (season pack) or `Show Title S02E04` (episode) plus the shared quality/source/
// extra terms — the human-readable text query / tvsearch q.
export function buildNzbHydraTvQuery(
  title: string,
  season: number,
  episode: number | null,
  qualities: QualityFilter[],
  sources: SourceFilter[],
  extraTerms: string
) {
  return [
    normalizeReleaseSearchTitle(title),
    seasonEpisodeTag(season, episode),
    ...filterTerms(qualities, sources),
    extraTerms.trim()
  ]
    .filter(Boolean)
    .join(" ");
}

// TV search via Newznab `t=tvsearch`: structured season (+ ep) params, plus tvdbid for accurate
// matching when the show has one (falls back to the text q title when it doesn't). The quality/
// source/extra terms ride along in q exactly like the movie path. Same response parser as movies.
export async function searchNzbHydraTv(
  baseUrl: string,
  apiKey: string,
  title: string,
  tvdbId: number | null,
  season: number,
  episode: number | null,
  qualities: QualityFilter[],
  sources: SourceFilter[],
  extraTerms: string,
  limit: number,
  offset: number,
  customQuery?: string
): Promise<NzbSearchResponse> {
  const query = customQuery?.trim() || buildNzbHydraTvQuery(title, season, episode, qualities, sources, extraTerms);
  const url = hydraApiUrl(baseUrl);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("t", "tvsearch");
  url.searchParams.set("season", String(season));
  if (episode != null) url.searchParams.set("ep", String(episode));
  if (tvdbId) url.searchParams.set("tvdbid", String(tvdbId));
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));

  const response = await fetch(url);
  if (!response.ok) throw new Error(`NZBHydra returned ${response.status}`);
  return parseNzbHydraResponse(await response.text(), query, limit, offset);
}
