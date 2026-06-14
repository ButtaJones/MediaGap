import { Download, Film, Search, Star } from "lucide-react";
import type { CSSProperties } from "react";
import type { MovieResult } from "../../shared/types";

interface MovieGridProps {
  movies: MovieResult[];
  viewMode: "poster" | "list";
  posterSize: number;
  onSearchNzb: (movie: MovieResult) => void;
  onShowDetails: (movie: MovieResult) => void;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function MovieGrid({
  movies,
  viewMode,
  posterSize,
  onSearchNzb,
  onShowDetails,
  emptyTitle = "Search a person, movie, or studio",
  emptyDescription = "Results will appear here with clear owned and missing states."
}: MovieGridProps) {
  if (!movies.length) {
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
        {movies.map((movie) => (
          <article
            className="movie-list-row clickable"
            key={movie.tmdbId}
            tabIndex={0}
            role="button"
            onClick={() => onShowDetails(movie)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onShowDetails(movie);
            }}
          >
            <div className="list-poster">
              {movie.posterPath ? <img src={movie.posterPath} alt="" /> : <Film size={24} />}
            </div>
            <div className="movie-copy">
              <div className="list-title-line">
                <h3>{movie.title}</h3>
                {movie.listRank ? <span className="rank-badge">#{movie.listRank}</span> : null}
                <span className={movie.owned ? "inline-badge owned" : "inline-badge missing"}>{movie.owned ? "In Plex" : "Missing"}</span>
              </div>
              <p>{movie.year ?? "Unknown year"}</p>
              {movie.imdbRating ? (
                <span className="rating-line">
                  <Star size={14} />
                  IMDb {movie.imdbRating.toFixed(1)}
                </span>
              ) : null}
              {movie.overview ? <p className="overview compact">{movie.overview}</p> : null}
            </div>
            <button
              className="secondary-button"
              onClick={(event) => {
                event.stopPropagation();
                onSearchNzb(movie);
              }}
              disabled={movie.owned}
            >
              <Download size={17} />
              {movie.owned ? "Owned" : "Search"}
            </button>
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
      {movies.map((movie) => (
        <article
          className="movie-card clickable"
          key={movie.tmdbId}
          tabIndex={0}
          role="button"
          onClick={() => onShowDetails(movie)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") onShowDetails(movie);
          }}
        >
          <div className="poster-frame">
            {movie.posterPath ? <img src={movie.posterPath} alt="" /> : <Film size={42} />}
            <span className={movie.owned ? "badge owned" : "badge missing"}>{movie.owned ? "In Plex" : "Missing"}</span>
            {movie.listRank ? <span className="rank-badge poster-rank">#{movie.listRank}</span> : null}
          </div>
          <div className="movie-copy">
            <h3>{movie.title}</h3>
            <p>{movie.year ?? "Unknown year"}</p>
            {movie.imdbRating ? (
              <span className="rating-line">
                <Star size={14} />
                IMDb {movie.imdbRating.toFixed(1)}
              </span>
            ) : null}
            {movie.overview ? <p className="overview">{movie.overview}</p> : null}
          </div>
          <button
            className="secondary-button"
            onClick={(event) => {
              event.stopPropagation();
              onSearchNzb(movie);
            }}
            disabled={movie.owned}
          >
            <Download size={17} />
            {movie.owned ? "Owned" : "Search"}
          </button>
        </article>
      ))}
    </div>
  );
}
