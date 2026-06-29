import type { TraktSource } from "../../shared/types";

// The navigable search inputs that round-trip through the URL. Results are NOT stored here — they are
// re-fetched from these inputs on load / Back-Forward. Display prefs (viewMode/posterSize) and app
// settings deliberately stay out of the URL.
export type MovieSearchType = "person" | "movie" | "studio" | TraktSource;
export type MovieSortKey = "list" | "year" | "title" | "owned" | "missing";
export type SortDir = "asc" | "desc";
export type TvSourceKey = "show" | "person" | TraktSource;

export interface UrlState {
  view: "search" | "collections";
  kind: "movie" | "tv";
  // Movie search inputs
  type: MovieSearchType;
  q: string;
  page: number;
  perPage: number;
  sort: MovieSortKey;
  dir: SortDir;
  // TV search inputs
  tvSource: TvSourceKey;
  tvQ: string;
  tvPage: number;
  tvPerPage: number;
  // Collections
  collection: number | null;
}

const MOVIE_TYPES: MovieSearchType[] = ["person", "movie", "studio", "trakt-watchlist", "trakt-watched"];
const MOVIE_SORTS: MovieSortKey[] = ["list", "year", "title", "owned", "missing"];
const TV_SOURCES: TvSourceKey[] = ["show", "person", "trakt-watchlist", "trakt-watched"];

export const URL_DEFAULTS: UrlState = {
  view: "search",
  kind: "movie",
  type: "person",
  q: "",
  page: 0,
  perPage: 25,
  sort: "year",
  dir: "asc",
  tvSource: "show",
  tvQ: "",
  tvPage: 0,
  tvPerPage: 25,
  collection: null
};

function pick<T extends string>(value: string | null, allowed: T[], fallback: T): T {
  return value != null && (allowed as string[]).includes(value) ? (value as T) : fallback;
}

function int(value: string | null, fallback: number): number {
  if (value == null) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

// Parse a `location.search` string into a complete UrlState. Absent params fall back to defaults;
// `kind` falls back to the caller's value (so a bare URL can honor the localStorage media-kind pref).
export function parseUrlState(search: string, fallbackKind: "movie" | "tv"): UrlState {
  const p = new URLSearchParams(search);
  const collectionRaw = Number.parseInt(p.get("collection") ?? "", 10);
  return {
    view: pick(p.get("view"), ["search", "collections"], URL_DEFAULTS.view),
    kind: pick(p.get("kind"), ["movie", "tv"], fallbackKind),
    type: pick(p.get("type"), MOVIE_TYPES, URL_DEFAULTS.type),
    q: p.get("q") ?? "",
    page: int(p.get("page"), URL_DEFAULTS.page),
    perPage: int(p.get("perPage"), URL_DEFAULTS.perPage),
    sort: pick(p.get("sort"), MOVIE_SORTS, URL_DEFAULTS.sort),
    dir: pick(p.get("dir"), ["asc", "desc"], URL_DEFAULTS.dir),
    tvSource: pick(p.get("tvSource"), TV_SOURCES, URL_DEFAULTS.tvSource),
    tvQ: p.get("tvq") ?? "",
    tvPage: int(p.get("tvPage"), URL_DEFAULTS.tvPage),
    tvPerPage: int(p.get("tvPerPage"), URL_DEFAULTS.tvPerPage),
    collection: Number.isFinite(collectionRaw) ? collectionRaw : null
  };
}

// Serialize a UrlState to a `?...` query string. `view` and `kind` are always written (so the URL is
// authoritative on refresh/back); only the ACTIVE view/kind's inputs are emitted, and only when they
// differ from the default, to keep the URL readable.
export function buildSearchString(s: UrlState): string {
  const p = new URLSearchParams();
  p.set("view", s.view);
  p.set("kind", s.kind);

  if (s.view === "collections") {
    if (s.collection != null) p.set("collection", String(s.collection));
  } else if (s.kind === "tv") {
    if (s.tvSource !== URL_DEFAULTS.tvSource) p.set("tvSource", s.tvSource);
    if (s.tvQ) p.set("tvq", s.tvQ);
    if (s.tvPage > 0) p.set("tvPage", String(s.tvPage));
    if (s.tvPerPage !== URL_DEFAULTS.tvPerPage) p.set("tvPerPage", String(s.tvPerPage));
  } else {
    if (s.type !== URL_DEFAULTS.type) p.set("type", s.type);
    if (s.q) p.set("q", s.q);
    if (s.page > 0) p.set("page", String(s.page));
    if (s.perPage !== URL_DEFAULTS.perPage) p.set("perPage", String(s.perPage));
    if (s.sort !== URL_DEFAULTS.sort) p.set("sort", s.sort);
    if (s.dir !== URL_DEFAULTS.dir) p.set("dir", s.dir);
  }
  return `?${p.toString()}`;
}
