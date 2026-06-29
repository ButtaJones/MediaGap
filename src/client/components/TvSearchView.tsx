import { Search, Tv, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { TRAKT_SOURCE_LABELS } from "../../shared/types";
import type { PersonHeader, TraktSource, TvNzbTarget, TvShowDetail, TvShowResult } from "../../shared/types";
import { api } from "../lib/api";
import { PersonResultHeader } from "./PersonResultHeader";
import { ResultControls } from "./ResultControls";
import { TvShowGrid } from "./TvShowGrid";
import { TvShowDetailModal } from "./TvShowDetailModal";

type TvSource = "show" | "person" | TraktSource;

interface TvSearchViewProps {
  posterSize: number;
  viewMode: "poster" | "list";
  serverName: string;
  tmdbReady: boolean;
  seerrEnabled: boolean;
  nzbEnabled: boolean;
  onNzbSearch: (target: TvNzbTarget) => void;
  traktConnected: boolean;
  traktReady: boolean;
  // URL-driven navigable state (owned by App so it round-trips through the URL).
  source: TvSource;
  submittedQuery: string;
  page: number;
  perPage: number;
  onNavigate: (next: { source: TvSource; query: string }, opts?: { replace?: boolean }) => void;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
}

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

// Dedicated TV search surface. The navigable inputs (source / searched query / page / perPage) are
// controlled by App so they live in the URL; results, suggestions and the detail modal stay local
// and re-fetch whenever the controlled (source, submittedQuery) change.
export function TvSearchView({
  posterSize,
  viewMode,
  serverName,
  tmdbReady,
  seerrEnabled,
  nzbEnabled,
  onNzbSearch,
  traktConnected,
  traktReady,
  source,
  submittedQuery,
  page,
  perPage,
  onNavigate,
  onPageChange,
  onPerPageChange
}: TvSearchViewProps) {
  const [inputText, setInputText] = useState(submittedQuery);
  const [shows, setShows] = useState<TvShowResult[]>([]);
  const [person, setPerson] = useState<PersonHeader | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [selected, setSelected] = useState<TvShowResult | null>(null);
  const [detail, setDetail] = useState<TvShowDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [suggestions, setSuggestions] = useState<DisplaySuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const searchAreaRef = useRef<HTMLDivElement | null>(null);
  const suggestionsRef = useRef<HTMLDivElement | null>(null);
  const resultsAnchorRef = useRef<HTMLDivElement | null>(null);
  const trakt = isTraktSource(source);
  const isPerson = source === "person";

  // Pagination (parity with the movie search; matters for long Trakt lists — up to ~636 shows).
  const pageCount = Math.max(1, Math.ceil(shows.length / perPage));
  const safePage = Math.min(page, pageCount - 1);
  const pagedShows = useMemo(() => shows.slice(safePage * perPage, safePage * perPage + perPage), [shows, perPage, safePage]);
  const pageStart = pagedShows.length ? safePage * perPage + 1 : 0;
  const pageEnd = safePage * perPage + pagedShows.length;

  // Keep the input box in sync with the URL-driven searched query (initial load, Back/Forward, a
  // new search from a suggestion or cast click). Local typing diverges until the next submit.
  useEffect(() => {
    setInputText(submittedQuery);
  }, [submittedQuery]);

  // Re-fetch results whenever the controlled (source, submittedQuery) change — this is the single
  // path that restores results on load and Back/Forward, and runs a new search. `refreshNonce` lets
  // the Trakt "Refresh" button re-pull an unchanged source.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      setSuggestionsOpen(false);
      setSuggestions([]);
      if (isTraktSource(source)) {
        setPerson(null);
        setLoading(true);
        setMessage("");
        try {
          const response = await api.traktTvList(source === "trakt-watched" ? "watched" : "watchlist");
          if (cancelled) return;
          setShows(response.results);
          if (!response.results.length) setMessage(`No shows found in your ${TRAKT_SOURCE_LABELS[source]}.`);
        } catch (error) {
          if (cancelled) return;
          setShows([]);
          setMessage(error instanceof Error ? error.message : "Could not load your Trakt list.");
        } finally {
          if (!cancelled) setLoading(false);
        }
        return;
      }
      const trimmed = submittedQuery.trim();
      if (!trimmed) {
        setShows([]);
        setPerson(null);
        setMessage("");
        setLoading(false);
        return;
      }
      setLoading(true);
      setMessage("");
      try {
        if (source === "person") {
          const response = await api.searchTvPerson(trimmed);
          if (cancelled) return;
          setShows(response.results);
          setPerson(response.person ?? null);
          if (!response.results.length) {
            setMessage(response.person ? `No TV work found for ${response.person.name}.` : `No person found for "${trimmed}".`);
          }
        } else {
          const response = await api.searchTv(trimmed);
          if (cancelled) return;
          setShows(response.results);
          setPerson(null);
          if (!response.results.length) setMessage(`No TV shows found for "${trimmed}".`);
        }
      } catch (error) {
        if (cancelled) return;
        setShows([]);
        setPerson(null);
        setMessage(error instanceof Error ? error.message : "TV search failed.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [source, submittedQuery, refreshNonce]);

  // If Trakt disconnects while a Trakt source is selected, fall back to the title search. Gated on
  // traktReady so a deep-linked Trakt URL isn't reset before the connection status is known.
  useEffect(() => {
    if (traktReady && !traktConnected && isTraktSource(source)) {
      onNavigate({ source: "show", query: "" }, { replace: true });
    }
  }, [traktReady, traktConnected, source, onNavigate]);

  // Debounced search-as-you-type suggestions (TV shows, or people in Person mode).
  useEffect(() => {
    const trimmed = inputText.trim();
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
  }, [inputText, suggestionsOpen, tmdbReady, trakt, isPerson]);

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

  function onSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    if (isTraktSource(source)) {
      setRefreshNonce((nonce) => nonce + 1);
      return;
    }
    onNavigate({ source, query: inputText });
  }

  function onSourceChange(next: TvSource) {
    // Trakt loads immediately (push); show/person just switch the input mode (replace, no query yet).
    onNavigate({ source: next, query: "" }, { replace: !isTraktSource(next) });
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
            value={trakt ? "" : inputText}
            disabled={!tmdbReady || trakt}
            onChange={(event) => {
              setInputText(event.target.value);
              setSuggestionsOpen(true);
            }}
            onFocus={() => {
              if (!trakt && inputText.trim().length >= 2) setSuggestionsOpen(true);
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

        {!trakt && suggestionsOpen && (suggestions.length || suggestionsLoading) && inputText.trim().length >= 2 ? (
          <div className="suggestion-list" ref={suggestionsRef}>
            {suggestionsLoading ? <p className="muted-line">{isPerson ? "Looking up people..." : "Looking up shows..."}</p> : null}
            {suggestions.map((suggestion) => (
              <button
                className="suggestion-row"
                key={suggestion.id}
                onClick={() => onNavigate({ source, query: suggestion.title })}
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

      <div ref={resultsAnchorRef} className="results-anchor" />

      <ResultControls
        total={shows.length}
        pageStart={pageStart}
        pageEnd={pageEnd}
        page={safePage}
        pageCount={pageCount}
        perPage={perPage}
        perPageLabel="Shows"
        scrollTargetRef={resultsAnchorRef}
        onPerPage={onPerPageChange}
        onPage={onPageChange}
      />

      <TvShowGrid
        shows={pagedShows}
        viewMode={viewMode}
        posterSize={posterSize}
        seerrEnabled={seerrEnabled}
        onShowDetails={(show) => void openDetail(show)}
        emptyTitle={submittedQuery || trakt ? "No shows match" : "Search for a TV show"}
        emptyDescription={
          submittedQuery || trakt
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
        scrollTargetRef={resultsAnchorRef}
        onPerPage={onPerPageChange}
        onPage={onPageChange}
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
          onNavigate({ source: "person", query: name });
        }}
        onClose={closeDetail}
      />
    </>
  );
}
