import { Check, ChevronDown, ChevronRight, Tv, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type {
  TvEpisodeSummary,
  TvOwnershipStatus,
  TvSeasonSummary,
  TvShowDetail,
  TvShowResult
} from "../../shared/types";
import { api } from "../lib/api";
import { ownershipPercent, tvSeasonSummaryText } from "./TvShowGrid";

interface TvShowDetailModalProps {
  // The clicked card summary — drives the header instantly while the full detail loads.
  show: TvShowResult | null;
  detail: TvShowDetail | null;
  loading: boolean;
  error: string;
  serverName: string;
  onClose: () => void;
}

interface SeasonLoadState {
  loading?: boolean;
  episodes?: TvEpisodeSummary[];
  error?: string;
}

// Auto-expand at most this many partial seasons on open: surface what's missing without firing a
// burst of episode fetches for a show that's partial across many seasons.
const AUTO_EXPAND_CAP = 3;

const SEASON_BADGE_LABEL: Record<TvOwnershipStatus, string> = {
  complete: "Owned",
  partial: "Partial",
  missing: "Missing"
};

function seasonBadgeClass(status: TvOwnershipStatus): string {
  if (status === "complete") return "inline-badge owned";
  if (status === "partial") return "inline-badge partial";
  return "inline-badge missing";
}

function seasonEpisodeText(season: TvSeasonSummary): string {
  if (season.status === "complete") return `All ${season.episodeCount} episode${season.episodeCount === 1 ? "" : "s"} owned`;
  return `Owns ${season.ownedEpisodeCount} of ${season.episodeCount} episode${season.episodeCount === 1 ? "" : "s"}`;
}

function formatAirDate(airDate: string | null): string | null {
  if (!airDate) return null;
  // Parse at midday to avoid the date sliding a day in negative timezones.
  const parsed = new Date(`${airDate.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return airDate;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function TvShowDetailModal({ show, detail, loading, error, serverName, onClose }: TvShowDetailModalProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [seasonState, setSeasonState] = useState<Record<number, SeasonLoadState>>({});
  // Tracks which seasons have a fetch in flight or done — checked synchronously so concurrent
  // calls (auto-expand + a quick manual toggle) never double-fetch (state updaters run lazily).
  const requestedRef = useRef<Set<number>>(new Set());

  // Lazy-load a season's episode list on first expand.
  const fetchSeason = useCallback(async (tmdbId: number, seasonNumber: number) => {
    if (requestedRef.current.has(seasonNumber)) return;
    requestedRef.current.add(seasonNumber);
    setSeasonState((prev) => ({ ...prev, [seasonNumber]: { loading: true } }));
    try {
      const response = await api.tvSeasonEpisodes(tmdbId, seasonNumber);
      setSeasonState((prev) => ({ ...prev, [seasonNumber]: { episodes: response.episodes } }));
    } catch (err) {
      requestedRef.current.delete(seasonNumber); // allow a retry on the next expand
      setSeasonState((prev) => ({
        ...prev,
        [seasonNumber]: { error: err instanceof Error ? err.message : "Could not load episodes." }
      }));
    }
  }, []);

  // When a new show's detail loads, reset episode state and auto-expand its partial seasons (capped)
  // so the user immediately sees which episodes are missing in the seasons worth surfacing.
  useEffect(() => {
    requestedRef.current = new Set();
    setSeasonState({});
    if (!detail) {
      setExpanded(new Set());
      return;
    }
    const autoExpand = detail.seasons
      .filter((season) => season.status === "partial")
      .slice(0, AUTO_EXPAND_CAP)
      .map((season) => season.seasonNumber);
    setExpanded(new Set(autoExpand));
    for (const seasonNumber of autoExpand) void fetchSeason(detail.tmdbId, seasonNumber);
  }, [detail?.tmdbId, fetchSeason]);

  function toggleSeason(seasonNumber: number) {
    const isOpen = expanded.has(seasonNumber);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (isOpen) next.delete(seasonNumber);
      else next.add(seasonNumber);
      return next;
    });
    if (!isOpen && detail) void fetchSeason(detail.tmdbId, seasonNumber);
  }

  if (!show) return null;

  // Prefer the freshly loaded detail; fall back to the card summary so the header never flashes empty.
  const title = detail?.title ?? show.title;
  const year = detail?.year ?? show.year;
  const status = detail?.status ?? show.status;
  const owned = detail?.ownedSeasonCount ?? show.ownedSeasonCount;
  const total = detail?.totalSeasonCount ?? show.totalSeasonCount;
  const posterPath = detail?.posterPath ?? show.posterPath;
  const summary = tvSeasonSummaryText(detail ?? show);

  return (
    <div
      className="modal-backdrop details-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`${title} details`}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal details-modal tv-detail-modal">
        <div
          className="details-banner"
          style={detail?.backdropPath ? ({ backgroundImage: `url(${detail.backdropPath})` } as CSSProperties) : undefined}
        />
        <button className="icon-button details-close" onClick={onClose} aria-label="Close show details">
          <X size={20} />
        </button>

        <div className="details-identity">
          <div className="details-poster">
            {posterPath ? <img src={posterPath} alt="" /> : <Tv size={44} />}
          </div>
          <div className="details-title">
            <h2>{title}</h2>
            <div className="details-meta">
              {year ? <span>{year}</span> : null}
              {detail?.tmdbStatus ? <span>{detail.tmdbStatus}</span> : null}
              <span className={`inline-badge ${status === "missing" ? "missing" : status === "partial" ? "partial" : "owned"}`}>
                {status === "complete" ? "Complete" : status === "partial" ? "In progress" : "Missing"}
              </span>
            </div>
            {detail?.tagline ? <p className="details-tagline">{detail.tagline}</p> : null}
            <div className="tv-detail-progress">
              <div className="tv-detail-progress-head">
                <strong>{summary}</strong>
                {total > 0 ? <span>{ownershipPercent(owned, total)}%</span> : null}
              </div>
              {total > 0 ? (
                <div className="collection-progress" aria-label={`${owned} of ${total} seasons owned`}>
                  <span style={{ width: `${ownershipPercent(owned, total)}%` }} />
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="tv-detail-body">
          <h3 className="tv-detail-subhead">Seasons</h3>
          {loading ? <p className="status-line">Loading seasons from TMDb...</p> : null}
          {error ? <p className="error-line">{error}</p> : null}
          {!loading && !error && detail && !detail.seasons.length ? (
            <p className="muted-line">No aired seasons yet — nothing to compare against {serverName}.</p>
          ) : null}

          <div className="tv-season-list">
            {detail?.seasons.map((season) => {
              const isExpanded = expanded.has(season.seasonNumber);
              const load = seasonState[season.seasonNumber];
              return (
                <article className={`tv-season-row ${season.status}${isExpanded ? " expanded" : ""}`} key={season.seasonNumber}>
                  <div className="tv-season-heading">
                    <button
                      className="tv-season-toggle"
                      onClick={() => toggleSeason(season.seasonNumber)}
                      aria-expanded={isExpanded}
                    >
                      <span className="tv-season-chevron">{isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</span>
                      <span className="tv-season-headline">
                        <span className="tv-season-line">
                          <span className="tv-season-name">
                            {season.status === "complete" ? <Check size={16} className="tv-season-check" /> : null}
                            <strong>Season {season.seasonNumber}</strong>
                            {season.airYear ? <small>{season.airYear}</small> : null}
                          </span>
                          <span className={seasonBadgeClass(season.status)}>{SEASON_BADGE_LABEL[season.status]}</span>
                        </span>
                        <small className="tv-season-count">{seasonEpisodeText(season)}</small>
                      </span>
                    </button>
                    <div
                      className="collection-progress"
                      aria-label={`${season.ownedEpisodeCount} of ${season.episodeCount} episodes owned`}
                    >
                      <span style={{ width: `${ownershipPercent(season.ownedEpisodeCount, season.episodeCount)}%` }} />
                    </div>
                  </div>

                  {isExpanded ? (
                    <div className="tv-episode-list">
                      {load?.loading ? <p className="muted-line tv-episode-status">Loading episodes...</p> : null}
                      {load?.error ? <p className="error-line tv-episode-status">{load.error}</p> : null}
                      {load?.episodes && !load.episodes.length ? (
                        <p className="muted-line tv-episode-status">No aired episodes in this season yet.</p>
                      ) : null}
                      {load?.episodes?.map((episode) => (
                        <div className={`tv-episode-row ${episode.status}`} key={episode.episodeNumber}>
                          <span className="tv-episode-still">
                            {episode.stillPath ? <img src={episode.stillPath} alt="" loading="lazy" /> : <Tv size={16} />}
                          </span>
                          <span className="tv-episode-main">
                            <span className="tv-episode-title">
                              <span className="tv-episode-num">E{episode.episodeNumber}</span>
                              <strong>{episode.name ?? `Episode ${episode.episodeNumber}`}</strong>
                            </span>
                            {formatAirDate(episode.airDate) ? (
                              <small className="tv-episode-air">{formatAirDate(episode.airDate)}</small>
                            ) : null}
                          </span>
                          <span className={episode.status === "owned" ? "inline-badge owned" : "inline-badge missing"}>
                            {episode.status === "owned" ? "Owned" : "Missing"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
