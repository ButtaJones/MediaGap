import { Activity, Clock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DownloaderStatusResponse } from "../../shared/types";
import { api } from "../lib/api";

interface DownloadStatusBarProps {
  enabled: boolean;
  onOpenTracker: () => void;
}

export function DownloadStatusBar({ enabled, onOpenTracker }: DownloadStatusBarProps) {
  const [status, setStatus] = useState<DownloaderStatusResponse | null>(null);
  const [now, setNow] = useState(Date.now());
  const seenAt = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!enabled) {
      setStatus(null);
      seenAt.current.clear();
      return;
    }

    let cancelled = false;
    async function refresh() {
      try {
        const response = await api.downloaderStatus();
        if (cancelled) return;
        const activeIds = new Set(response.queue.map((item) => item.id));
        const timestamps = seenAt.current;
        for (const item of response.queue) {
          if (!timestamps.has(item.id)) timestamps.set(item.id, Date.now());
        }
        for (const id of timestamps.keys()) {
          if (!activeIds.has(id)) timestamps.delete(id);
        }
        setStatus(response);
      } catch {
        if (!cancelled) setStatus(null);
      }
    }

    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled]);

  useEffect(() => {
    if (!status?.queue.length) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [status?.queue.length]);

  const active = status?.queue ?? [];
  if (!enabled || !active.length) return null;

  const item = active[0];
  const startedAt = seenAt.current.get(item.id) ?? now;
  const elapsed = Math.max(0, now - startedAt);
  const progress = item.progress ?? 0;

  return (
    <div className="download-status-bar" role="status">
      <div className="download-status-main">
        <div className="download-status-title">
          <Activity size={18} />
          <strong>{item.name}</strong>
          <span>{progress}%</span>
        </div>
        <div className="download-status-progress" aria-label={`Download progress ${progress}%`}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="download-status-meta">
          <span>
            <Clock size={15} />
            Elapsed {formatDuration(elapsed)}
          </span>
          <span>Left {item.eta ?? "unknown"}</span>
          {item.speed ? <span>{item.speed}</span> : null}
          {item.remaining ? <span>{item.remaining} remaining</span> : null}
          {active.length > 1 ? <span>+{active.length - 1} more</span> : null}
        </div>
      </div>
      <button className="secondary-button" onClick={onOpenTracker}>
        Tracker
      </button>
    </div>
  );
}

function formatDuration(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
