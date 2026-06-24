import { Search, Tv } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { TRAKT_SOURCE_LABELS } from "../../shared/types";
import type { TraktSource, TvShowDetail, TvShowResult, TvSuggestion } from "../../shared/types";
import { api } from "../lib/api";
import { ResultControls } from "./ResultControls";
import { TvShowGrid } from "./TvShowGrid";
import { TvShowDetailModal } from "./TvShowDetailModal";

interface TvSearchViewProps {
  posterSize: number;
  viewMode: "poster" | "list";
  serverName: string;
  tmdbReady: boolean;
  seerrEnabled: boolean;
  traktConnected: boolean;
}

type TvSource = "show" | TraktSource;

function isTraktSource(source: TvSource): source is TraktSource {
  return source !== "show";
}

// Dedicated TV search surface: a show-title search with as-you-type suggestions, Trakt watchlist/
// watched as TV sources, an ownership-aware poster grid, and the drill-down detail modal (with Seerr
// season requests). Kept separate from the movie search but mirrors its source select + suggestions.
export function TvSearchView({ posterSize, viewMode, serverName, tmdbReady, seerrEnabled, traktConnected }: TvSearchViewProps) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [source, setSource] = useState<TvSource>("show");
  const [shows, setShows] = useState<TvShowResult[]>([]);
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(25);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<TvShowResult | null>(null);
  const [detail, setDetail] = useState<TvShowDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [suggestions, setSuggestions] = useState<TvSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const searchAreaRef = useRef<HTMLDivElement | null>(null);
  const suggestionsRef = useRef<HTMLDivElement | null>(null);
  const trakt = isTraktSource(source);

  // Pagination (parity with the movie search; matters for long Trakt lists — up to ~636 shows).
  const pageCount = Math.max(1, Math.ceil(shows.length / perPage));
  const safePage = Math.min(page, pageCount - 1);
  const pagedShows = useMemo(() => shows.slice(safePage * perPage, safePage * perPage + perPage), [shows, perPage, safePage]);
  const pageStart = pagedShows.length ? safePage * perPage + 1 : 0;
  const pageEnd = safePage * perPage + pagedShows.length;

  // A new result set (search, Trakt source, or page-size change) returns to the first page.
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

  // Debounced search-as-you-type suggestions (same 250ms cadence as the movie search).
  useEffect(() => {
    const trimmed = query.trim();
    if (!suggestionsOpen || trimmed.length < 2 || !tmdbReady || trakt) {
      setSuggestions([]);
      setSuggestionsLoading(false);
      return;
    }

    let cancelled = false;
    setSuggestionsLoading(true);
    const handle = window.setTimeout(() => {
      void api
        .tvSuggest(trimmed)
        .then((response) => {
          if (!cancelled) setSuggestions(response.suggestions);
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
  }, [query, suggestionsOpen, tmdbReady, trakt]);

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

  // Load the user's Trakt TV watchlist/watched into the same grid, with ownership overlaid.
  async function loadTraktSource(traktSource: TraktSource) {
    setSuggestionsOpen(false);
    setSuggestions([]);
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
    else void performSearch(query);
  }

  function onSourceChange(next: TvSource) {
    setSource(next);
    if (isTraktSource(next)) {
      void loadTraktSource(next);
    } else {
      setSuggestionsOpen(false);
      setShows([]);
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
          <select
            value={source}
            aria-label="TV search source"
            disabled={!traktConnected}
            onChange={(event) => onSourceChange(event.target.value as TvSource)}
          >
            <option value="show">TV show</option>
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
            {suggestionsLoading ? <p className="muted-line">Looking up shows...</p> : null}
            {suggestions.map((suggestion) => (
              <button
                className="suggestion-row"
                key={suggestion.tmdbId}
                onClick={() => void performSearch(suggestion.title)}
              >
                <div className="suggestion-image">
                  {suggestion.posterPath ? <img src={suggestion.posterPath} alt="" /> : <Tv size={22} />}
                </div>
                <div>
                  <strong>{suggestion.title}</strong>
                  {suggestion.year ? <span>{suggestion.year}</span> : null}
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {!tmdbReady ? <p className="status-line">Add a TMDb API key in Settings to search TV shows.</p> : null}
      {message ? <p className="status-line">{message}</p> : null}

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
            ? "Try a different title or source."
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
        onClose={closeDetail}
      />
    </>
  );
}
