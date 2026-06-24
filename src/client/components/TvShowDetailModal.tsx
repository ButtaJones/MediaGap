import { Check, Tv, X } from "lucide-react";
import type { CSSProperties } from "react";
import type { TvOwnershipStatus, TvSeasonSummary, TvShowDetail, TvShowResult } from "../../shared/types";
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

export function TvShowDetailModal({ show, detail, loading, error, serverName, onClose }: TvShowDetailModalProps) {
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
            {detail?.seasons.map((season) => (
              <article className={`tv-season-row ${season.status}`} key={season.seasonNumber}>
                <div className="tv-season-line">
                  <div className="tv-season-name">
                    {season.status === "complete" ? <Check size={16} className="tv-season-check" /> : null}
                    <strong>Season {season.seasonNumber}</strong>
                    {season.airYear ? <small>{season.airYear}</small> : null}
                  </div>
                  <span className={seasonBadgeClass(season.status)}>{SEASON_BADGE_LABEL[season.status]}</span>
                </div>
                <small className="tv-season-count">{seasonEpisodeText(season)}</small>
                <div
                  className="collection-progress"
                  aria-label={`${season.ownedEpisodeCount} of ${season.episodeCount} episodes owned`}
                >
                  <span style={{ width: `${ownershipPercent(season.ownedEpisodeCount, season.episodeCount)}%` }} />
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
