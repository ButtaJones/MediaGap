import { Check, Loader2, Send } from "lucide-react";
import { useState } from "react";
import type { MovieResult } from "../../shared/types";
import { api } from "../lib/api";

interface SeerrRequestButtonProps {
  movie: Pick<MovieResult, "tmdbId" | "title">;
  /** Stops the card's click-through (poster/list rows open the details modal on click). */
  stopPropagation?: boolean;
}

type RequestState = "idle" | "requesting" | "requested" | "error";

// Reuses the NZB send→checkmark pattern: spinner while in flight, themed checkmark on success.
// On failure it reverts to an actionable "Retry" with the error surfaced as a tooltip.
export function SeerrRequestButton({ movie, stopPropagation = false }: SeerrRequestButtonProps) {
  const [state, setState] = useState<RequestState>("idle");
  const [error, setError] = useState("");

  async function request(event: React.MouseEvent) {
    if (stopPropagation) event.stopPropagation();
    if (state === "requesting" || state === "requested") return;
    setState("requesting");
    setError("");
    try {
      await api.requestSeerr(movie);
      setState("requested");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not request in Seerr.");
      setState("error");
    }
  }

  const label =
    state === "requested" ? "Requested" : state === "requesting" ? "Requesting" : state === "error" ? "Retry" : "Request";

  return (
    <button
      className={`secondary-button seerr-request-button${state === "requested" ? " requested" : ""}`}
      onClick={request}
      disabled={state === "requesting" || state === "requested"}
      title={state === "error" ? error : state === "requested" ? "Requested in Seerr" : "Request in Seerr"}
      aria-label={state === "requested" ? `Requested ${movie.title} in Seerr` : `Request ${movie.title} in Seerr`}
    >
      {state === "requested" ? (
        <Check size={17} />
      ) : state === "requesting" ? (
        <Loader2 size={17} className="spin" />
      ) : (
        <Send size={17} />
      )}
      {label}
    </button>
  );
}
