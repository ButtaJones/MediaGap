import { Search, Tv } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TvShowDetail, TvShowResult, TvSuggestion } from "../../shared/types";
import { api } from "../lib/api";
import { TvShowGrid } from "./TvShowGrid";
import { TvShowDetailModal } from "./TvShowDetailModal";

interface TvSearchViewProps {
  posterSize: number;
  serverName: string;
  tmdbReady: boolean;
}

// Dedicated TV search surface: a show-title search with as-you-type suggestions, an ownership-aware
// poster grid, and the drill-down detail modal. Kept fully separate from the movie search so movies
// stay unchanged, but it mirrors the movie search's debounced suggestion dropdown for consistency.
export function TvSearchView({ posterSize, serverName, tmdbReady }: TvSearchViewProps) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [shows, setShows] = useState<TvShowResult[]>([]);
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

  // Debounced search-as-you-type suggestions (same 250ms cadence as the movie search).
  useEffect(() => {
    const trimmed = query.trim();
    if (!suggestionsOpen || trimmed.length < 2 || !tmdbReady) {
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
  }, [query, suggestionsOpen, tmdbReady]);

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

  function onSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    void performSearch(query);
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
          <select value="show" disabled aria-label="TV search type">
            <option value="show">TV show</option>
          </select>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSuggestionsOpen(true);
            }}
            onFocus={() => {
              if (query.trim().length >= 2) setSuggestionsOpen(true);
            }}
            placeholder={`Search TV shows like Severance or The Wire, compare seasons with ${serverName}`}
            disabled={!tmdbReady}
          />
          <button className="primary-button" disabled={loading || !tmdbReady}>
            <Search size={18} />
            {loading ? "Searching" : "Search"}
          </button>
        </form>

        {suggestionsOpen && (suggestions.length || suggestionsLoading) && query.trim().length >= 2 ? (
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

      <TvShowGrid
        shows={shows}
        posterSize={posterSize}
        onShowDetails={(show) => void openDetail(show)}
        emptyTitle={submitted ? "No shows match" : "Search for a TV show"}
        emptyDescription={
          submitted
            ? "Try a different title."
            : `Find a show, then see which seasons you already have in ${serverName} and which are missing.`
        }
      />

      <TvShowDetailModal
        show={selected}
        detail={detail}
        loading={detailLoading}
        error={detailError}
        serverName={serverName}
        onClose={closeDetail}
      />
    </>
  );
}
