import { Search, Tv, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { TRAKT_SOURCE_LABELS } from "../../shared/types";
import type { PersonHeader, TraktSource, TvNzbTarget, TvShowDetail, TvShowResult } from "../../shared/types";
import { api } from "../lib/api";
import { PersonResultHeader } from "./PersonResultHeader";
import { ResultControls } from "./ResultControls";
import { TvShowGrid } from "./TvShowGrid";
import { TvShowDetailModal } from "./TvShowDetailModal";

interface TvSearchViewProps {
  posterSize: number;
  viewMode: "poster" | "list";
  serverName: string;
  tmdbReady: boolean;
  seerrEnabled: boolean;
  nzbEnabled: boolean;
  onNzbSearch: (target: TvNzbTarget) => void;
  traktConnected: boolean;
}

type TvSource = "show" | "person" | TraktSource;

function isTraktSource(source: TvSource): source is TraktSource {
  return source === "trakt-watchlist" || source === "trakt-watched";
}

// Normalized suggestion shape so the dropdown serves both TV-show and person autocomplete.
interface DisplaySuggestion {
  id: number;
  title: string;
  subtitle: string | null;
  imagePath: string | null;
}

// Dedicated TV search surface: TV-title search with as-you-type suggestions, a Person source (an
// actor's TV work), Trakt watchlist/watched, an ownership-aware grid, and the drill-down modal with
// Seerr/NZB actions. Mirrors the movie search's source select + suggestions + person header.
export function TvSearchView({ posterSize, viewMode, serverName, tmdbReady, seerrEnabled, nzbEnabled, onNzbSearch, traktConnected }: TvSearchViewProps) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [source, setSource] = useState<TvSource>("show");
  const [shows, setShows] = useState<TvShowResult[]>([]);
  const [person, setPerson] = useState<PersonHeader | null>(null);
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(25);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<TvShowResult | null>(null);
  const [detail, setDetail] = useState<TvShowDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [suggestions, setSuggestions] = useState<DisplaySuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const searchAreaRef = useRef<HTMLDivElement | null>(null);
  const suggestionsRef = useRef<HTMLDivElement | null>(null);
  const trakt = isTraktSource(source);
  const isPerson = source === "person";

  // Pagination (parity with the movie search; matters for long Trakt lists — up to ~636 shows).
  const pageCount = Math.max(1, Math.ceil(shows.length / perPage));
  const safePage = Math.min(page, pageCount - 1);
  const pagedShows = useMemo(() => shows.slice(safePage * perPage, safePage * perPage + perPage), [shows, perPage, safePage]);
  const pageStart = pagedShows.length ? safePage * perPage + 1 : 0;
  const pageEnd = safePage * perPage + pagedShows.length;

  // A new result set (search, source change, or page-size change) returns to the first page.
  useEffect(() => {
    setPage(0);
  }, [shows, perPage]);

  // If Trakt disconnects while a Trakt source is selected, fall back to the title search.
  useEffect(() => {
    if (!traktConnected && isTraktSource(source)) {
      setSource("show");
      setShows([]);
      setSubmitted("");
      setMessage("");
    }
  }, [traktConnected, source]);

  // Debounced search-as-you-type suggestions (TV shows, or people in Person mode).
  useEffect(() => {
    const trimmed = query.trim();
    if (!suggestionsOpen || trimmed.length < 2 || !tmdbReady || trakt) {
      setSuggestions([]);
      setSuggestionsLoading(false);
      return;
    }

    let cancelled = false;
    setSuggestionsLoading(true);
    const fetcher: Promise<DisplaySuggestion[]> = isPerson
      ? api.suggest(trimmed, "person").then((response) =>
          response.suggestions.map((suggestion) => ({
            id: suggestion.id,
            title: suggestion.title,
            subtitle: suggestion.subtitle,
            imagePath: suggestion.imagePath
          }))
        )
      : api.tvSuggest(trimmed).then((response) =>
          response.suggestions.map((suggestion) => ({
            id: suggestion.tmdbId,
            title: suggestion.title,
            subtitle: suggestion.year != null ? String(suggestion.year) : null,
            imagePath: suggestion.posterPath
          }))
        );

    const handle = window.setTimeout(() => {
      void fetcher
        .then((items) => {
          if (!cancelled) setSuggestions(items);
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        })
        .finally(() => {
          if (!cancelled) setSuggestionsLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, suggestionsOpen, tmdbReady, trakt, isPerson]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (suggestionsRef.current?.contains(target)) return;
      const targetIsEditable = event.target instanceof Element && Boolean(event.target.closest("input"));
      if (!searchAreaRef.current?.contains(target) || !targetIsEditable) {
        setSuggestionsOpen(false);
        setSuggestions([]);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  async function performSearch(rawQuery: string) {
    const trimmed = rawQuery.trim();
    if (!trimmed) return;
    setSource("show");
    setQuery(trimmed);
    setSubmitted(trimmed);
    setPerson(null);
    setSuggestionsOpen(false);
    setSuggestions([]);
    setLoading(true);
    setMessage("");
    try {
      const response = await api.searchTv(trimmed);
      setShows(response.results);
      if (!response.results.length) setMessage(`No TV shows found for "${trimmed}".`);
    } catch (error) {
      setShows([]);
      setMessage(error instanceof Error ? error.message : "TV search failed.");
    } finally {
      setLoading(false);
    }
  }

  // An actor's/creator's TV work, with ownership overlaid (also how a TV cast click searches).
  async function performPersonSearch(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSource("person");
    setQuery(trimmed);
    setSubmitted(trimmed);
    setSuggestionsOpen(false);
    setSuggestions([]);
    setLoading(true);
    setMessage("");
    try {
      const response = await api.searchTvPerson(trimmed);
      setShows(response.results);
      setPerson(response.person ?? null);
      if (!response.results.length) {
        setMessage(response.person ? `No TV work found for ${response.person.name}.` : `No person found for "${trimmed}".`);
      }
    } catch (error) {
      setShows([]);
      setPerson(null);
      setMessage(error instanceof Error ? error.message : "TV person search failed.");
    } finally {
      setLoading(false);
    }
  }

  // Load the user's Trakt TV watchlist/watched into the same grid, with ownership overlaid.
  async function loadTraktSource(traktSource: TraktSource) {
    setSuggestionsOpen(false);
    setSuggestions([]);
    setPerson(null);
    setLoading(true);
    setMessage("");
    try {
      const kind = traktSource === "trakt-watched" ? "watched" : "watchlist";
      const response = await api.traktTvList(kind);
      setShows(response.results);
      setSubmitted(TRAKT_SOURCE_LABELS[traktSource]);
      if (!response.results.length) setMessage(`No shows found in your ${TRAKT_SOURCE_LABELS[traktSource]}.`);
    } catch (error) {
      setShows([]);
      setMessage(error instanceof Error ? error.message : "Could not load your Trakt list.");
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    if (isTraktSource(source)) void loadTraktSource(source);
    else if (source === "person") void performPersonSearch(query);
    else void performSearch(query);
  }

  function onSourceChange(next: TvSource) {
    setSource(next);
    if (isTraktSource(next)) {
      void loadTraktSource(next);
    } else {
      // "show" or "person": clear the grid and let the user type a new query.
      setSuggestionsOpen(false);
      setShows([]);
      setPerson(null);
      setSubmitted("");
      setMessage("");
    }
  }

  async function openDetail(show: TvShowResult) {
    setSelected(show);
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      setDetail(await api.tvShowDetail(show.tmdbId));
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Could not load show details.");
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setSelected(null);
    setDetail(null);
    setDetailError("");
  }

  return (
    <>
      <div ref={searchAreaRef}>
        <form className="search-bar" onSubmit={onSubmit}>
          <select value={source} aria-label="TV search source" onChange={(event) => onSourceChange(event.target.value as TvSource)}>
            <option value="show">TV show</option>
            <option value="person">Person</option>
            {traktConnected ? (
              <>
                <option value="trakt-watchlist">Trakt Watchlist</option>
                <option value="trakt-watched">Trakt Watched</option>
              </>
            ) : null}
          </select>
          <input
            value={trakt ? "" : query}
            disabled={!tmdbReady || trakt}
            onChange={(event) => {
              setQuery(event.target.value);
              setSuggestionsOpen(true);
            }}
            onFocus={() => {
              if (!trakt && query.trim().length >= 2) setSuggestionsOpen(true);
            }}
            placeholder={
              trakt
                ? `Showing your ${TRAKT_SOURCE_LABELS[source as TraktSource]} — owned vs missing in ${serverName}`
                : isPerson
                  ? `Search an actor or creator, see their TV work in ${serverName}`
                  : `Search TV shows like Severance or The Wire, compare seasons with ${serverName}`
            }
          />
          <button className="primary-button" disabled={loading || !tmdbReady}>
            <Search size={18} />
            {loading ? (trakt ? "Refreshing" : "Searching") : trakt ? "Refresh" : "Search"}
          </button>
        </form>

        {!trakt && suggestionsOpen && (suggestions.length || suggestionsLoading) && query.trim().length >= 2 ? (
          <div className="suggestion-list" ref={suggestionsRef}>
            {suggestionsLoading ? <p className="muted-line">{isPerson ? "Looking up people..." : "Looking up shows..."}</p> : null}
            {suggestions.map((suggestion) => (
              <button
                className="suggestion-row"
                key={suggestion.id}
                onClick={() => (isPerson ? void performPersonSearch(suggestion.title) : void performSearch(suggestion.title))}
              >
                <div className="suggestion-image">
                  {suggestion.imagePath ? <img src={suggestion.imagePath} alt="" /> : isPerson ? <UserRound size={22} /> : <Tv size={22} />}
                </div>
                <div>
                  <strong>{suggestion.title}</strong>
                  {suggestion.subtitle ? <span>{suggestion.subtitle}</span> : null}
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {!tmdbReady ? <p className="status-line">Add a TMDb API key in Settings to search TV shows.</p> : null}
      {message ? <p className="status-line">{message}</p> : null}

      {isPerson && person ? <PersonResultHeader person={person} /> : null}

      <ResultControls
        total={shows.length}
        pageStart={pageStart}
        pageEnd={pageEnd}
        page={safePage}
        pageCount={pageCount}
        perPage={perPage}
        perPageLabel="Shows"
        onPerPage={setPerPage}
        onPage={setPage}
      />

      <TvShowGrid
        shows={pagedShows}
        viewMode={viewMode}
        posterSize={posterSize}
        seerrEnabled={seerrEnabled}
        onShowDetails={(show) => void openDetail(show)}
        emptyTitle={submitted ? "No shows match" : "Search for a TV show"}
        emptyDescription={
          submitted
            ? "Try a different title, person, or source."
            : `Find a show, then see which seasons you already have in ${serverName} and which are missing.`
        }
      />

      <ResultControls
        total={shows.length}
        pageStart={pageStart}
        pageEnd={pageEnd}
        page={safePage}
        pageCount={pageCount}
        perPage={perPage}
        perPageLabel="Shows"
        onPerPage={setPerPage}
        onPage={setPage}
        compact
      />

      <TvShowDetailModal
        show={selected}
        detail={detail}
        loading={detailLoading}
        error={detailError}
        serverName={serverName}
        seerrEnabled={seerrEnabled}
        nzbEnabled={nzbEnabled}
        onNzbSearch={(target) => {
          // Close the detail modal first so the NZB drawer isn't stacked behind it (mirrors the
          // movie detail modal, which closes itself when opening the NZB drawer).
          closeDetail();
          onNzbSearch(target);
        }}
        onSearchPerson={(name) => {
          // A TV cast click runs a TV person search (the user is in TV context).
          closeDetail();
          void performPersonSearch(name);
        }}
        onClose={closeDetail}
      />
    </>
  );
}
