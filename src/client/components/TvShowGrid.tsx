import { Info, Search, Tv } from "lucide-react";
import type { CSSProperties } from "react";
import type { TvOwnershipStatus, TvShowResult } from "../../shared/types";
import { api } from "../lib/api";
import { SeerrRequestAction } from "./SeerrRequestButton";

interface TvShowGridProps {
  shows: TvShowResult[];
  viewMode: "poster" | "list";
  posterSize: number;
  seerrEnabled: boolean;
  onShowDetails: (show: TvShowResult) => void;
  emptyTitle?: string;
  emptyDescription?: string;
}

const STATUS_LABEL: Record<TvOwnershipStatus, string> = {
  complete: "Complete",
  partial: "In progress",
  missing: "Missing"
};

function statusBadgeClass(status: TvOwnershipStatus): string {
  if (status === "complete") return "inline-badge owned";
  if (status === "partial") return "inline-badge partial";
  return "inline-badge missing";
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// The same "X of Y" partial-completion language the movie collections use, applied to seasons.
export function tvSeasonSummaryText(show: Pick<TvShowResult, "ownedSeasonCount" | "totalSeasonCount" | "status" | "inLibrary">): string {
  if (show.totalSeasonCount === 0) return show.inLibrary ? "No aired seasons yet" : "Not in your library";
  if (show.status === "complete") return `All ${plural(show.totalSeasonCount, "season")} owned`;
  if (show.status === "missing") return `Missing all ${plural(show.totalSeasonCount, "season")}`;
  return `Owns ${show.ownedSeasonCount} of ${plural(show.totalSeasonCount, "season")}`;
}

export function ownershipPercent(owned: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((owned / total) * 100)));
}

// Card-level actions: "View details" (also what a card click does) plus a quick "Request" for the
// seasons the user owns nothing of — reuses the shared SeerrRequestAction feedback. Stacked the same
// way the movie card stacks Search/Request. Fully-owned shows show only "View details".
function CardActions({ show, seerrEnabled, onShowDetails }: { show: TvShowResult; seerrEnabled: boolean; onShowDetails: (show: TvShowResult) => void }) {
  const canRequest = seerrEnabled && show.missingSeasonNumbers.length > 0;
  return (
    <div className="movie-actions">
      <button
        className="secondary-button"
        onClick={(event) => {
          event.stopPropagation();
          onShowDetails(show);
        }}
        aria-label={`View ${show.title} details`}
      >
        <Info size={17} />
        View
      </button>
      {canRequest ? (
        <SeerrRequestAction
          onRequest={() => api.requestSeerrTv({ tmdbId: show.tmdbId, seasons: show.missingSeasonNumbers, title: show.title })}
          idleLabel="Request"
          ariaTitle={show.title}
          stopPropagation
        />
      ) : null}
    </div>
  );
}

function SeasonProgress({ show }: { show: TvShowResult }) {
  if (show.totalSeasonCount <= 0) return null;
  return (
    <div className="collection-progress" aria-label={`${show.ownedSeasonCount} of ${show.totalSeasonCount} seasons owned`}>
      <span style={{ width: `${ownershipPercent(show.ownedSeasonCount, show.totalSeasonCount)}%` }} />
    </div>
  );
}

export function TvShowGrid({
  shows,
  viewMode,
  posterSize,
  seerrEnabled,
  onShowDetails,
  emptyTitle = "Search for a TV show",
  emptyDescription = "Show results appear here with how many seasons you own vs. are missing."
}: TvShowGridProps) {
  if (!shows.length) {
    return (
      <div className="empty-state">
        <Search size={34} />
        <h3>{emptyTitle}</h3>
        <p>{emptyDescription}</p>
      </div>
    );
  }

  if (viewMode === "list") {
    return (
      <div className="movie-list">
        {shows.map((show) => (
          <article
            className="movie-list-row clickable"
            key={show.tmdbId}
            tabIndex={0}
            role="button"
            onClick={() => onShowDetails(show)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onShowDetails(show);
            }}
          >
            <div className="list-poster">{show.posterPath ? <img src={show.posterPath} alt="" /> : <Tv size={24} />}</div>
            <div className="movie-copy">
              <div className="list-title-line">
                <h3>{show.title}</h3>
                <span className={statusBadgeClass(show.status)}>{STATUS_LABEL[show.status]}</span>
              </div>
              <p>{show.year ?? "Unknown year"}</p>
              <div className="tv-card-status">
                <small>{tvSeasonSummaryText(show)}</small>
                <SeasonProgress show={show} />
              </div>
            </div>
            <CardActions show={show} seerrEnabled={seerrEnabled} onShowDetails={onShowDetails} />
          </article>
        ))}
      </div>
    );
  }

  return (
    <div
      className="movie-grid"
      style={
        {
          "--poster-size": `${posterSize}px`,
          gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, var(--poster-size)), var(--poster-size)))"
        } as CSSProperties
      }
    >
      {shows.map((show) => (
        <article
          className="tv-card clickable"
          key={show.tmdbId}
          tabIndex={0}
          role="button"
          onClick={() => onShowDetails(show)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") onShowDetails(show);
          }}
        >
          <div className="poster-frame">
            {show.posterPath ? <img src={show.posterPath} alt="" /> : <Tv size={42} />}
            <span className={`badge ${show.status}`}>{STATUS_LABEL[show.status]}</span>
          </div>
          <div className="tv-card-body">
            <h3>{show.title}</h3>
            <p className="tv-card-year">{show.year ?? "Unknown year"}</p>
            <div className="tv-card-status">
              <small>{tvSeasonSummaryText(show)}</small>
              <SeasonProgress show={show} />
            </div>
          </div>
          <CardActions show={show} seerrEnabled={seerrEnabled} onShowDetails={onShowDetails} />
        </article>
      ))}
    </div>
  );
}
