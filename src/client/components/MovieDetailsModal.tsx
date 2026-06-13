import { Calendar, Clock, Download, Film, Star, UserRound, X } from "lucide-react";
import type { MovieDetails, MovieResult } from "../../shared/types";

interface MovieDetailsModalProps {
  movie: MovieResult | null;
  details: MovieDetails | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  onSearchNzb: (movie: MovieResult) => void;
}

export function MovieDetailsModal({ movie, details, loading, error, onClose, onSearchNzb }: MovieDetailsModalProps) {
  if (!movie) return null;
  const display = details ?? movie;

  return (
    <div className="modal-backdrop details-backdrop" role="dialog" aria-modal="true" aria-label={`${display.title} details`}>
      <div className="modal details-modal">
        <div className="details-hero" style={{ backgroundImage: details?.backdropPath ? `url(${details.backdropPath})` : undefined }}>
          <button className="icon-button details-close" onClick={onClose} aria-label="Close movie details">
            <X size={20} />
          </button>
          <div className="details-poster">
            {display.posterPath ? <img src={display.posterPath} alt="" /> : <Film size={42} />}
          </div>
          <div className="details-title">
            <span className={display.owned ? "inline-badge owned" : "inline-badge missing"}>{display.owned ? "In Plex" : "Missing"}</span>
            <h2>{display.title}</h2>
            {details?.tagline ? <p className="details-tagline">{details.tagline}</p> : null}
            <div className="details-meta">
              <span>
                <Calendar size={16} />
                {display.year ?? "Unknown year"}
              </span>
              <span>
                <Clock size={16} />
                {formatRuntime(details?.runtime ?? null)}
              </span>
              {display.imdbRating ? (
                <span>
                  <Star size={16} />
                  IMDb {display.imdbRating.toFixed(1)}
                  {display.imdbVotes ? ` (${formatVotes(display.imdbVotes)})` : ""}
                </span>
              ) : null}
              {details?.genres.length ? <span>{details.genres.slice(0, 3).join(", ")}</span> : null}
            </div>
            {details?.directors.length ? (
              <p className="details-director">
                Directed by <strong>{details.directors.join(", ")}</strong>
              </p>
            ) : null}
          </div>
        </div>

        <div className="details-body">
          {loading ? <p className="status-line">Loading movie details...</p> : null}
          {error ? <p className="error-line">{error}</p> : null}
          {display.overview ? <p className="details-overview">{display.overview}</p> : <p className="muted-line">No overview available.</p>}

          <div className="details-actions">
            <button className="secondary-button" onClick={() => onSearchNzb(display)} disabled={display.owned}>
              <Download size={17} />
              {display.owned ? "Owned" : "Search"}
            </button>
          </div>

          <section className="cast-section">
            <h3>Cast</h3>
            {details?.cast.length ? (
              <div className="cast-grid">
                {details.cast.map((member) => (
                  <article className="cast-card" key={`${member.id}-${member.character ?? ""}`}>
                    <div className="cast-photo">{member.profilePath ? <img src={member.profilePath} alt="" /> : <UserRound size={24} />}</div>
                    <strong>{member.name}</strong>
                    {member.character ? <span>{member.character}</span> : null}
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted-line">{loading ? "Cast will appear here." : "No cast list available."}</p>
            )}
          </section>
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
