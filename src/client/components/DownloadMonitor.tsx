import { ChevronDown, ChevronRight, Pause, Play, RefreshCw, Save, Trash2 } from "lucide-react";
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
  const [activeTab, setActiveTab] = useState<"queue" | "history">("queue");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const queueItems = status?.queue ?? [];
  const downloaderHistoryItems = status?.history ?? [];

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
      deselect(id);
      setMessage("History entry removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove history entry.");
    }
  }

  function deselect(id: number) {
    setSelectedIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  function toggleSelected(id: number) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((current) => {
      const allChecked = history.length > 0 && history.every((entry) => current.has(entry.id));
      return allChecked ? new Set() : new Set(history.map((entry) => entry.id));
    });
  }

  async function deleteSelected() {
    const ids = history.filter((entry) => selectedIds.has(entry.id)).map((entry) => entry.id);
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} ${ids.length === 1 ? "entry" : "entries"}?`)) return;
    setMessage("");
    try {
      await Promise.all(ids.map((id) => api.deleteHistory(id)));
      const removed = new Set(ids);
      setHistory((current) => current.filter((entry) => !removed.has(entry.id)));
      setSelectedIds(new Set());
      setMessage(`Removed ${ids.length} ${ids.length === 1 ? "entry" : "entries"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove selected history entries.");
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

      <div className="tracker-tabs segmented-control" aria-label="Downloader tracker section">
        <button className={activeTab === "queue" ? "selected" : ""} onClick={() => setActiveTab("queue")}>
          Queue
          <span>{queueItems.length}</span>
        </button>
        <button className={activeTab === "history" ? "selected" : ""} onClick={() => setActiveTab("history")}>
          Downloader history
          <span>{downloaderHistoryItems.length}</span>
        </button>
      </div>

      <TrackerColumn
        title={activeTab === "queue" ? "Active queue" : "Downloader history"}
        items={activeTab === "queue" ? queueItems : downloaderHistoryItems}
        empty={activeTab === "queue" ? "No active downloads." : "No downloader history loaded."}
      />

      <div className="local-history">
        <button
          type="button"
          className="local-history-header"
          onClick={() => setHistoryCollapsed((current) => !current)}
          aria-expanded={!historyCollapsed}
        >
          {historyCollapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
          <h3>Editable app history</h3>
          {history.length ? <span className="history-count">{history.length}</span> : null}
        </button>

        {historyCollapsed ? null : history.length ? (
          <>
            <div className="history-bulk-actions">
              <label className="history-select-all">
                <input
                  type="checkbox"
                  className="history-select"
                  checked={history.every((entry) => selectedIds.has(entry.id))}
                  onChange={toggleSelectAll}
                />
                Select all
              </label>
              <button className="secondary-button" onClick={deleteSelected} disabled={selectedIds.size === 0}>
                <Trash2 size={16} />
                Delete selected{selectedIds.size ? ` (${selectedIds.size})` : ""}
              </button>
            </div>
            <div className="history-list">
              {history.map((entry) => (
                <article className={selectedIds.has(entry.id) ? "history-row selected" : "history-row"} key={entry.id}>
                  <div className="history-row-head">
                    <input
                      type="checkbox"
                      className="history-select"
                      checked={selectedIds.has(entry.id)}
                      onChange={() => toggleSelected(entry.id)}
                      aria-label={`Select ${entry.title}`}
                    />
                    <div>
                      <strong>{entry.title}</strong>
                      <span>
                        {entry.action} via {entry.downloader}
                        {entry.category ? ` · ${entry.category}` : ""} · {new Date(entry.createdAt).toLocaleString()}
                      </span>
                    </div>
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
          </>
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
