import { Check, Loader2, Send } from "lucide-react";
import { useState } from "react";
import type { MovieResult } from "../../shared/types";
import { api } from "../lib/api";

type RequestState = "idle" | "requesting" | "requested" | "error";

interface SeerrRequestActionProps {
  /** Performs the actual request (movie or TV). Resolves on success, rejects with the error. */
  onRequest: () => Promise<unknown>;
  idleLabel: string;
  requestedLabel?: string;
  requestingLabel?: string;
  /** Used to build the title/aria text, e.g. a movie title or "Severance Season 2". */
  ariaTitle: string;
  /** Stops a parent's click-through (cards/season rows open the details modal on click). */
  stopPropagation?: boolean;
  className?: string;
}

// The shared Seerr request state machine + checkmark feedback (reuses the NZB send pattern): spinner
// while in flight, themed checkmark on success, "Retry" with the error in a tooltip on failure. Both
// the movie button and the TV season/show actions render this so the feedback is identical.
export function SeerrRequestAction({
  onRequest,
  idleLabel,
  requestedLabel = "Requested",
  requestingLabel = "Requesting",
  ariaTitle,
  stopPropagation = false,
  className = ""
}: SeerrRequestActionProps) {
  const [state, setState] = useState<RequestState>("idle");
  const [error, setError] = useState("");

  async function request(event: React.MouseEvent) {
    if (stopPropagation) event.stopPropagation();
    if (state === "requesting" || state === "requested") return;
    setState("requesting");
    setError("");
    try {
      await onRequest();
      setState("requested");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not request in Seerr.");
      setState("error");
    }
  }

  const label =
    state === "requested" ? requestedLabel : state === "requesting" ? requestingLabel : state === "error" ? "Retry" : idleLabel;

  return (
    <button
      className={`secondary-button seerr-request-button${state === "requested" ? " requested" : ""}${className ? ` ${className}` : ""}`}
      onClick={request}
      disabled={state === "requesting" || state === "requested"}
      title={state === "error" ? error : state === "requested" ? "Requested in Seerr" : `Request ${ariaTitle} in Seerr`}
      aria-label={state === "requested" ? `Requested ${ariaTitle} in Seerr` : `Request ${ariaTitle} in Seerr`}
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

interface SeerrRequestButtonProps {
  movie: Pick<MovieResult, "tmdbId" | "title">;
  /** Stops the card's click-through (poster/list rows open the details modal on click). */
  stopPropagation?: boolean;
}

// Movie request button — a thin wrapper over the shared action (unchanged behavior).
export function SeerrRequestButton({ movie, stopPropagation = false }: SeerrRequestButtonProps) {
  return (
    <SeerrRequestAction
      onRequest={() => api.requestSeerr(movie)}
      idleLabel="Request"
      ariaTitle={movie.title}
      stopPropagation={stopPropagation}
    />
  );
}
