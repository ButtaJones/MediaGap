import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";
import type { RefObject } from "react";

interface ScrollToTopButtonProps {
  /** The scrollable element to watch/scroll. Defaults to the window (main page). */
  scrollContainerRef?: RefObject<HTMLElement | null>;
  /** Show once scrolled past this many px. Defaults to one viewport of the scroll area. */
  threshold?: number;
  /** Extra class for positioning context (e.g. the NZB drawer variant). */
  className?: string;
}

// A floating "scroll to top" button that appears once the user has scrolled down past a viewport
// and smoothly returns to the top. Watches either the window (main results) or a given scroll
// container (the NZB drawer's scrollable aside).
export function ScrollToTopButton({ scrollContainerRef, threshold, className = "" }: ScrollToTopButtonProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = scrollContainerRef?.current ?? null;
    const target: Window | HTMLElement = el ?? window;
    const measure = () => {
      const scrolled = el ? el.scrollTop : window.scrollY;
      const limit = threshold ?? (el ? el.clientHeight : window.innerHeight);
      setVisible(scrolled > limit);
    };
    measure();
    target.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      target.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [scrollContainerRef, threshold]);

  if (!visible) return null;

  function scrollToTop() {
    const el = scrollContainerRef?.current;
    (el ?? window).scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <button
      type="button"
      className={`icon-button scroll-top-button${className ? ` ${className}` : ""}`}
      onClick={scrollToTop}
      aria-label="Scroll to top"
      title="Scroll to top"
    >
      <ArrowUp size={20} />
    </button>
  );
}
