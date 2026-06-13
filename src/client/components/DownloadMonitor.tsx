import { Pause, Play, RefreshCw, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { DownloadHistoryEntry, DownloaderStatusResponse } from "../../shared/types";
import { api } from "../lib/api";

interface DownloadMonitorProps {
  enabled: boolean;
  showHeading?: boolean;
}

export function DownloadMonitor({ enabled, showHeading = true }: DownloadMonitorProps) {
  const [status, setStatus] = useState<DownloaderStatusResponse | null>(null);
  const [history, setHistory] = useState<DownloadHistoryEntry[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void refresh();
    if (!enabled) return;
    const timer = window.setInterval(() => {
      void refresh(false);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [enabled]);

  async function refresh(showLoading = true) {
    if (showLoading) setLoading(true);
    setMessage("");
    try {
      const [statusResponse, historyResponse] = await Promise.all([api.downloaderStatus(), api.history()]);
      setStatus(statusResponse);
      setHistory(historyResponse.entries);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load downloader status.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  async function control(action: "pause" | "resume") {
    setLoading(true);
    setMessage("");
    try {
      const response = action === "pause" ? await api.pauseDownloader() : await api.resumeDownloader();
      setMessage(response.message);
      await refresh(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Could not ${action} downloads.`);
    } finally {
      setLoading(false);
    }
  }

  async function updateEntry(entry: DownloadHistoryEntry) {
    setMessage("");
    try {
      const updated = await api.updateHistory(entry.id, { status: entry.status, notes: entry.notes });
      setHistory((current) => current.map((item) => (item.id === entry.id ? updated : item)));
      setMessage("History updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update history.");
    }
  }

  async function deleteEntry(id: number) {
    setMessage("");
    try {
      await api.deleteHistory(id);
      setHistory((current) => current.filter((entry) => entry.id !== id));
      setMessage("History entry removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove history entry.");
    }
  }

  function patchEntry(id: number, patch: Partial<DownloadHistoryEntry>) {
    setHistory((current) => current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }

  const controls = (
    <div className="tracker-actions">
      <button className="secondary-button" onClick={() => control("pause")} disabled={!enabled || loading}>
        <Pause size={17} />
        Pause all
      </button>
      <button className="secondary-button" onClick={() => control("resume")} disabled={!enabled || loading}>
        <Play size={17} />
        Resume all
      </button>
      <button className="secondary-button" onClick={() => refresh()} disabled={loading}>
        <RefreshCw size={17} className={loading ? "spin" : ""} />
        Refresh
      </button>
    </div>
  );

  return (
    <section className="panel tracker-panel">
      {showHeading ? (
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Downloader</p>
            <h2>Tracker and history</h2>
          </div>
          {controls}
        </div>
      ) : (
        <div className="tracker-toolbar">{controls}</div>
      )}

      {message ? <p className="status-line">{message}</p> : null}
      {!enabled ? <p className="muted-line">Set up SABnzbd or NZBGet in Settings to enable live tracking.</p> : null}

      <div className="tracker-grid">
        <TrackerColumn title="Active queue" items={status?.queue ?? []} empty="No active downloads." />
        <TrackerColumn title="Downloader history" items={status?.history ?? []} empty="No downloader history loaded." />
      </div>

      <div className="local-history">
        <h3>Editable app history</h3>
        {history.length ? (
          <div className="history-list">
            {history.map((entry) => (
              <article className="history-row" key={entry.id}>
                <div>
                  <strong>{entry.title}</strong>
                  <span>
                    {entry.action} via {entry.downloader}
                    {entry.category ? ` · ${entry.category}` : ""} · {new Date(entry.createdAt).toLocaleString()}
                  </span>
                </div>
                <label>
                  Status
                  <input value={entry.status} onChange={(event) => patchEntry(entry.id, { status: event.target.value })} />
                </label>
                <label>
                  Notes
                  <input value={entry.notes} onChange={(event) => patchEntry(entry.id, { notes: event.target.value })} />
                </label>
                <div className="history-actions">
                  <button className="secondary-button" onClick={() => updateEntry(entry)}>
                    <Save size={16} />
                    Save
                  </button>
                  <button className="secondary-button" onClick={() => deleteEntry(entry.id)}>
                    <Trash2 size={16} />
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted-line">No app download history yet. Sending or downloading NZBs will add entries here.</p>
        )}
      </div>
    </section>
  );
}

function TrackerColumn({
  title,
  items,
  empty
}: {
  title: string;
  items: DownloaderStatusResponse["queue"];
  empty: string;
}) {
  return (
    <div className="tracker-column">
      <h3>{title}</h3>
      {items.length ? (
        <div className="tracker-list">
          {items.map((item) => (
            <article className="tracker-row" key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <span>
                  {item.status}
                  {item.category ? ` · ${item.category}` : ""}
                  {item.size ? ` · ${item.size}` : ""}
                </span>
              </div>
              <div className="progress-line">
                <span style={{ width: `${item.progress ?? 0}%` }} />
              </div>
              <small>
                {item.progress ?? 0}%{item.speed ? ` · ${item.speed}` : ""}
                {item.eta ? ` · ${item.eta}` : ""}
              </small>
            </article>
          ))}
        </div>
      ) : (
        <p className="muted-line">{empty}</p>
      )}
    </div>
  );
}
