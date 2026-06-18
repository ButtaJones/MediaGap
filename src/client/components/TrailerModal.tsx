import { Calendar, Clock, ExternalLink, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { MovieDetails, MovieResult } from "../../shared/types";

interface TrailerModalProps {
  movie: MovieResult | null;
  details: MovieDetails | null;
  onClose: () => void;
}

export function TrailerModal({ movie, details, onClose }: TrailerModalProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!movie || !details?.trailerKey) return null;

  const display = details ?? movie;
  const titleLogo = details?.logoPath ?? null;
  const trailerKey = details.trailerKey;
  const watchUrl = `https://www.youtube.com/watch?v=${trailerKey}`;

  return (
    <div
      className="modal-backdrop trailer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`${display.title} trailer`}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal trailer-modal">
        {details?.backdropPath ? (
          <div className="trailer-backdrop-image" style={{ backgroundImage: `url(${details.backdropPath})` }} aria-hidden="true" />
        ) : null}
        <button className="icon-button trailer-close" onClick={onClose} aria-label="Close trailer">
          <X size={20} />
        </button>

        <div className="trailer-content">
          <div className="trailer-player">
            {failed ? (
              <div className="trailer-fallback">
                <p>This trailer can't be embedded here.</p>
                <a className="secondary-button" href={watchUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={17} />
                  Watch on YouTube
                </a>
              </div>
            ) : (
              <iframe
                src={`https://www.youtube.com/embed/${trailerKey}`}
                title={`${display.title} trailer`}
                allow="accelerated-motion; encrypted-media; picture-in-picture; web-share"
                allowFullScreen
                onError={() => setFailed(true)}
              />
            )}
          </div>

          <div className="trailer-meta details-title">
            {titleLogo ? (
              <img className="details-logo trailer-logo" src={titleLogo} alt={display.title} />
            ) : (
              <h2>{display.title}</h2>
            )}
            <div className="details-meta">
              <span>
                <Calendar size={16} />
                {display.year ?? "Unknown year"}
              </span>
              <span>
                <Clock size={16} />
                {formatRuntime(details?.runtime ?? null)}
              </span>
              {details?.contentRating ? <span>{details.contentRating}</span> : null}
            </div>
            {display.imdbRating || details?.tmdbRating ? (
              <div className="ratings-row" aria-label="Movie ratings">
                {display.imdbRating ? (
                  <span className="rating-pill">
                    <span className="imdb-badge">IMDb</span>
                    {display.imdbRating.toFixed(1)}
                    {display.imdbVotes ? <small>{formatVotes(display.imdbVotes)}</small> : null}
                  </span>
                ) : null}
                {details?.tmdbRating ? (
                  <span className="rating-pill">
                    <span className="tmdb-badge">TMDb</span>
                    {Math.round(details.tmdbRating * 10)}%
                    {details.tmdbVotes ? <small>{formatVotes(details.tmdbVotes)}</small> : null}
                  </span>
                ) : null}
              </div>
            ) : null}
            <a className="trailer-youtube-link" href={watchUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={15} />
              Can't see the trailer? Watch on YouTube
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatRuntime(runtime: number | null) {
  if (!runtime) return "Runtime unknown";
  const hours = Math.floor(runtime / 60);
  const minutes = runtime % 60;
  if (!hours) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function formatVotes(votes: number) {
  if (votes >= 1_000_000) return `${(votes / 1_000_000).toFixed(1)}M`;
  if (votes >= 1_000) return `${Math.round(votes / 1_000)}K`;
  return votes.toLocaleString();
}
