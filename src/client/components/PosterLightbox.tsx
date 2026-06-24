import { X } from "lucide-react";
import { useEffect } from "react";

interface PosterLightboxProps {
  // The displayed (small) poster URL; upgraded to a larger TMDb size for the enlarged view.
  posterUrl: string | null;
  alt: string;
  onClose: () => void;
}

// Shared poster enlarge/lightbox used by both the movie and TV detail modals. Theme-agnostic dark
// overlay (a lightbox is universally dark); closes on Esc, the X, or a click anywhere.
export function PosterLightbox({ posterUrl, alt, onClose }: PosterLightboxProps) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!posterUrl) return null;

  return (
    <div className="poster-lightbox" role="dialog" aria-modal="true" aria-label={`${alt} poster`} onClick={onClose}>
      <button className="icon-button poster-lightbox-close" onClick={onClose} aria-label="Close enlarged poster">
        <X size={22} />
      </button>
      <img className="poster-lightbox-img" src={enlargePosterUrl(posterUrl)} alt={alt} />
    </div>
  );
}

// Swap the TMDb size segment (e.g. /t/p/w342/) for a larger one. Falls back to the original URL if
// it isn't a recognizable TMDb image path.
function enlargePosterUrl(url: string): string {
  return url.replace(/\/t\/p\/w\d+(_and_h\d+[^/]*)?\//, "/t/p/w780/");
}
