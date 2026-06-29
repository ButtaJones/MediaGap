import { Check, ChevronDown, ChevronRight, Download, Maximize2, Tv, UserRound, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type {
  TvEpisodeSummary,
  TvNzbTarget,
  TvOwnershipStatus,
  TvSeasonSummary,
  TvShowDetail,
  TvShowResult
} from "../../shared/types";
import { api } from "../lib/api";
import { PosterLightbox } from "./PosterLightbox";
import { SeerrRequestAction } from "./SeerrRequestButton";
import { ownershipPercent, tvSeasonSummaryText } from "./TvShowGrid";

interface TvShowDetailModalProps {
  // The clicked card summary — drives the header instantly while the full detail loads.
  show: TvShowResult | null;
  detail: TvShowDetail | null;
  loading: boolean;
  error: string;
  serverName: string;
  seerrEnabled?: boolean;
  nzbEnabled?: boolean;
  onNzbSearch?: (target: TvNzbTarget) => void;
  onSearchPerson?: (name: string) => void;
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

function formatVotes(votes: number): string {
  if (votes >= 1_000_000) return `${(votes / 1_000_000).toFixed(1)}M`;
  if (votes >= 1_000) return `${Math.round(votes / 1_000)}K`;
  return votes.toLocaleString();
}

export function TvShowDetailModal({ show, detail, loading, error, serverName, seerrEnabled = false, nzbEnabled = false, onNzbSearch, onSearchPerson, onClose }: TvShowDetailModalProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [seasonState, setSeasonState] = useState<Record<number, SeasonLoadState>>({});
  const [lightboxOpen, setLightboxOpen] = useState(false);
  // Reset the enlarge overlay whenever the modal opens a different show.
  useEffect(() => setLightboxOpen(false), [show?.tmdbId]);
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
  const titleLogo = detail?.logoPath ?? null;
  const hasRatings = Boolean(detail?.imdbRating || detail?.tmdbRating);
  const statusBadge =
    status === "complete"
      ? { className: "inline-badge owned", label: "Complete" }
      : status === "partial"
        ? { className: "inline-badge partial", label: "In progress" }
        : { className: "inline-badge missing", label: "Missing" };

  // Seerr TV requests (only when Seerr is configured and the full detail has loaded). The show-level
  // action requests every not-fully-owned eligible season at once — or "all" when the user owns none.
  const canRequestSeerr = seerrEnabled && Boolean(detail);
  const notOwnedSeasons = detail ? detail.seasons.filter((season) => season.status !== "complete").map((season) => season.seasonNumber) : [];
  const requestAllSeasons: number[] | "all" = detail?.ownedSeasonCount === 0 ? "all" : notOwnedSeasons;

  // NZBHydra season/episode search (only when NZBHydra is configured and the detail has loaded).
  const canSearchNzb = nzbEnabled && Boolean(detail) && Boolean(onNzbSearch);
  function nzbTargetFor(seasonNumber: number, episode: number | null): TvNzbTarget {
    return { title, year, tvdbId: detail?.tvdbId ?? null, tmdbId: detail!.tmdbId, season: seasonNumber, episode };
  }

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
        >
          <button className="icon-button details-close" onClick={onClose} aria-label="Close show details">
            <X size={20} />
          </button>
        </div>

        <div className="details-identity">
          {posterPath ? (
            <button type="button" className="details-poster details-poster-zoom" onClick={() => setLightboxOpen(true)} aria-label="Enlarge poster">
              <img src={posterPath} alt="" />
              <span className="poster-zoom-hint">
                <Maximize2 size={16} />
              </span>
            </button>
          ) : (
            <div className="details-poster">
              <Tv size={44} />
            </div>
          )}
          <div className="details-title">
            <span className={statusBadge.className}>{statusBadge.label}</span>
            {titleLogo ? <img className="details-logo" src={titleLogo} alt={title} /> : <h2>{title}</h2>}
            {detail?.tagline ? <p className="details-tagline">{detail.tagline}</p> : null}
            <div className="details-meta">
              {year ? <span>{year}</span> : null}
              {detail?.tmdbStatus ? <span>{detail.tmdbStatus}</span> : null}
              {detail?.network ? (
                <span className="tv-network">
                  {detail.networkLogoPath ? (
                    <img className="tv-network-logo" src={detail.networkLogoPath} alt={detail.network} />
                  ) : (
                    detail.network
                  )}
                </span>
              ) : null}
            </div>
            {hasRatings ? (
              <div className="ratings-row" aria-label="Show ratings">
                {detail?.imdbRating ? (
                  <span className="rating-pill">
                    <span className="imdb-badge">IMDb</span>
                    {detail.imdbRating.toFixed(1)}
                    {detail.imdbVotes ? <small>{formatVotes(detail.imdbVotes)}</small> : null}
                  </span>
                ) : null}
                {detail?.tmdbRating ? (
                  <span className="rating-pill">
                    <span className="tmdb-badge">TMDb</span>
                    {Math.round(detail.tmdbRating * 10)}%
                    {detail.tmdbVotes ? <small>{formatVotes(detail.tmdbVotes)}</small> : null}
                  </span>
                ) : null}
              </div>
            ) : null}
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
          {detail?.overview ?? show.overview ? (
            <p className="details-overview">{detail?.overview ?? show.overview}</p>
          ) : !loading && detail ? (
            <p className="muted-line">No overview available.</p>
          ) : null}

          {canRequestSeerr && notOwnedSeasons.length ? (
            <div className="details-actions tv-detail-actions">
              <SeerrRequestAction
                key={`all-${detail?.tmdbId}`}
                onRequest={() => api.requestSeerrTv({ tmdbId: detail!.tmdbId, seasons: requestAllSeasons, title })}
                idleLabel={`Request all missing season${notOwnedSeasons.length === 1 ? "" : "s"}`}
                requestedLabel="Requested missing seasons"
                ariaTitle={`${title} missing seasons`}
              />
            </div>
          ) : null}
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
                <article
                  className={`tv-season-row ${season.status}${isExpanded ? " expanded" : ""}`}
                  key={`${detail?.tmdbId}-${season.seasonNumber}`}
                >
                  <div className="tv-season-heading">
                    <div className="tv-season-top">
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
                      {season.status !== "complete" && (canSearchNzb || canRequestSeerr) ? (
                        <div className="tv-season-actions">
                          {canSearchNzb ? (
                            <button
                              className="secondary-button tv-season-search"
                              onClick={() => onNzbSearch?.(nzbTargetFor(season.seasonNumber, null))}
                              aria-label={`Search NZB releases for ${title} Season ${season.seasonNumber}`}
                            >
                              <Download size={16} />
                              Search
                            </button>
                          ) : null}
                          {canRequestSeerr ? (
                            <SeerrRequestAction
                              className="tv-season-request"
                              onRequest={() => api.requestSeerrTv({ tmdbId: detail!.tmdbId, seasons: [season.seasonNumber], title })}
                              idleLabel="Request"
                              ariaTitle={`${title} Season ${season.seasonNumber}`}
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </div>
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
                          {canSearchNzb && episode.status === "missing" ? (
                            <button
                              className="icon-button small tv-episode-search"
                              onClick={() => onNzbSearch?.(nzbTargetFor(season.seasonNumber, episode.episodeNumber))}
                              title="Search NZB releases"
                              aria-label={`Search NZB releases for ${title} S${season.seasonNumber}E${episode.episodeNumber}`}
                            >
                              <Download size={16} />
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>

          <section className="cast-section">
            <h3>Cast</h3>
            {detail?.cast.length ? (
              <div className="cast-grid">
                {detail.cast.map((member) => (
                  <button
                    type="button"
                    className="cast-card clickable"
                    key={`${member.id}-${member.character ?? ""}`}
                    onClick={() => onSearchPerson?.(member.name)}
                    aria-label={`Search ${member.name}`}
                  >
                    <div className="cast-photo">{member.profilePath ? <img src={member.profilePath} alt="" /> : <UserRound size={24} />}</div>
                    <strong>{member.name}</strong>
                    {member.character ? <span>{member.character}</span> : null}
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted-line">{loading ? "Cast will appear here." : "No cast list available."}</p>
            )}
          </section>
        </div>
      </div>
      {lightboxOpen ? (
        <PosterLightbox posterUrl={posterPath} alt={title} onClose={() => setLightboxOpen(false)} />
      ) : null}
    </div>
  );
}
