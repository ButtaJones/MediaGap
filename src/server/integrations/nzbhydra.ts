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

  const xml = parser.parse(await response.text());
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
