import { Calendar, Clock, Download, ExternalLink, Film, Layers, PlayCircle, UserRound, X } from "lucide-react";
import type { MovieCollectionSummary, MovieDetails, MovieResult } from "../../shared/types";
import { SeerrRequestButton } from "./SeerrRequestButton";

interface MovieDetailsModalProps {
  movie: MovieResult | null;
  details: MovieDetails | null;
  loading: boolean;
  error: string;
  collection: MovieCollectionSummary | null;
  ownedUrl: string | null;
  onClose: () => void;
  onSearchNzb: (movie: MovieResult) => void;
  onSearchPerson: (name: string) => void;
  onOpenCollection: (collectionId: number) => void;
  onOpenTrailer: () => void;
  hidden?: boolean;
  serverName: string;
  seerrEnabled?: boolean;
}

export function MovieDetailsModal({
  movie,
  details,
  loading,
  error,
  collection,
  ownedUrl,
  onClose,
  onSearchNzb,
  onSearchPerson,
  onOpenCollection,
  onOpenTrailer,
  hidden = false,
  serverName,
  seerrEnabled = false
}: MovieDetailsModalProps) {
  if (!movie) return null;
  const display = details ?? movie;
  const titleLogo = details?.logoPath ?? null;

  return (
    <div
      className="modal-backdrop details-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`${display.title} details`}
      style={hidden ? { display: "none" } : undefined}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal details-modal">
        <div className="details-banner" style={{ backgroundImage: details?.backdropPath ? `url(${details.backdropPath})` : undefined }}>
          <button className="icon-button details-close" onClick={onClose} aria-label="Close movie details">
            <X size={20} />
          </button>
        </div>
        <div className="details-identity">
          <div className="details-poster">
            {display.posterPath ? <img src={display.posterPath} alt="" /> : <Film size={42} />}
          </div>
          <div className="details-title">
            <span className={display.owned ? "inline-badge owned" : "inline-badge missing"}>{display.owned ? `In ${serverName}` : "Missing"}</span>
            {titleLogo ? (
              <img className="details-logo" src={titleLogo} alt={display.title} />
            ) : (
              <h2>{display.title}</h2>
            )}
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
              {details?.contentRating ? <span>{details.contentRating}</span> : null}
              {details?.genres.length ? <span>{details.genres.slice(0, 3).join(", ")}</span> : null}
            </div>
            {hasRatings(display, details) ? (
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
            {details?.directors.length ? (
              <p className="details-director">
                Directed by{" "}
                {details.directors.map((name, index) => (
                  <span key={name}>
                    {index > 0 ? ", " : null}
                    <button type="button" className="person-link" onClick={() => onSearchPerson(name)}>
                      {name}
                    </button>
                  </span>
                ))}
              </p>
            ) : null}
          </div>
        </div>

        <div className="details-body">
          {collection ? (
            <button type="button" className="details-collection-line clickable" onClick={() => onOpenCollection(collection.id)}>
              <Layers size={16} />
              <span>
                Part of: <strong>{collection.name}</strong> — {collection.ownedCount} of {collection.totalCount} in {serverName}
              </span>
            </button>
          ) : null}

          {loading ? <p className="status-line">Loading movie details...</p> : null}
          {error ? <p className="error-line">{error}</p> : null}
          {display.overview ? <p className="details-overview">{display.overview}</p> : <p className="muted-line">No overview available.</p>}

          <div className="details-actions">
            {display.owned ? (
              ownedUrl ? (
                <a className="secondary-button details-open-button" href={ownedUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={17} />
                  Open in {serverName}
                </a>
              ) : (
                <button className="secondary-button" disabled>
                  <Film size={17} />
                  Owned
                </button>
              )
            ) : (
              <button className="secondary-button" onClick={() => onSearchNzb(display)}>
                <Download size={17} />
                Search
              </button>
            )}
            {!display.owned && seerrEnabled ? <SeerrRequestButton movie={display} /> : null}
            {details?.trailerKey ? (
              <button className="secondary-button details-trailer-button" onClick={onOpenTrailer}>
                <PlayCircle size={17} />
                Trailer
              </button>
            ) : null}
          </div>

          <section className="cast-section">
            <h3>Cast</h3>
            {details?.cast.length ? (
              <div className="cast-grid">
                {details.cast.map((member) => (
                  <button
                    type="button"
                    className="cast-card clickable"
                    key={`${member.id}-${member.character ?? ""}`}
                    onClick={() => onSearchPerson(member.name)}
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

function hasRatings(display: MovieResult, details: MovieDetails | null) {
  return Boolean(display.imdbRating || details?.tmdbRating);
}

function formatVotes(votes: number) {
  if (votes >= 1_000_000) return `${(votes / 1_000_000).toFixed(1)}M`;
  if (votes >= 1_000) return `${Math.round(votes / 1_000)}K`;
  return votes.toLocaleString();
}
