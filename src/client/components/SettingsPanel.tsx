import { CheckCircle2, FolderOpen, PlugZap, RefreshCw, Save, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import {
  DOWNLOADER_TYPES,
  MEDIA_SERVER_TYPES,
  QUALITY_FILTERS,
  SOURCE_FILTERS,
  THEME_MODES,
  mediaServerLabel,
  themeLabel,
  type AppSettings,
  type ConnectionResult
} from "../../shared/types";
import { api } from "../lib/api";
import { CategorySelect } from "./CategorySelect";

interface SettingsPanelProps {
  settings: AppSettings;
  onSaved: (settings: AppSettings) => void;
}

export function SettingsPanel({ settings, onSaved }: SettingsPanelProps) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [status, setStatus] = useState<string>("");
  const [connection, setConnection] = useState<Record<string, ConnectionResult | null>>({});
  const [saving, setSaving] = useState(false);
  const [logPath, setLogPath] = useState("");
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    if (
      [
        "mediaServerType",
        "plexBaseUrl",
        "plexToken",
        "jellyfinBaseUrl",
        "jellyfinApiKey",
        "jellyfinUserId",
        "embyBaseUrl",
        "embyApiKey",
        "embyUserId"
      ].includes(String(key))
    ) {
      setConnection((current) => ({ ...current, "media-server": null }));
    }
  }

  function toggleList(key: "defaultQualities" | "defaultSources", value: string) {
    setDraft((current) => {
      const list = current[key] as string[];
      const next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
      return { ...current, [key]: next };
    });
  }

  async function save() {
    setSaving(true);
    setStatus("");
    try {
      const saved = await api.saveSettings(draft);
      onSaved(saved);
      setStatus("Settings saved locally.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function test(service: "media-server" | "tmdb" | "nzbhydra" | "downloader") {
    setConnection((current) => ({ ...current, [service]: null }));
    try {
      const result = await api.testConnection(service, draft);
      setConnection((current) => ({ ...current, [service]: result }));
    } catch (error) {
      setConnection((current) => ({
        ...current,
        [service]: { ok: false, message: error instanceof Error ? error.message : "Connection failed." }
      }));
    }
  }

  async function refreshLogs() {
    setLogsLoading(true);
    setStatus("");
    try {
      const response = await api.recentLogs();
      setLogPath(response.path);
      setLogLines(response.lines);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load logs.");
    } finally {
      setLogsLoading(false);
    }
  }

  async function openLogs() {
    setStatus("");
    try {
      const response = await api.openLogFolder();
      setStatus(response.message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not open log folder.");
    }
  }

  return (
    <section className="panel settings-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Local setup</p>
          <h2>Connections</h2>
        </div>
        <button className="primary-button" onClick={save} disabled={saving}>
          <Save size={18} />
          {saving ? "Saving" : "Save"}
        </button>
      </div>

      <div className="settings-grid">
        <ConnectionCard
          title="Media server"
          description="Choose which local library MediaGap scans for owned movies."
          onTest={() => test("media-server")}
          result={connection["media-server"]}
        >
          <label>
            Type
            <select value={draft.mediaServerType} onChange={(event) => update("mediaServerType", event.target.value as AppSettings["mediaServerType"])}>
              {MEDIA_SERVER_TYPES.map((type) => (
                <option value={type} key={type}>
                  {mediaServerLabel(type)}
                </option>
              ))}
            </select>
          </label>
          {draft.mediaServerType === "plex" ? (
            <>
              <label>
                Plex URL
                <input value={draft.plexBaseUrl} onChange={(event) => update("plexBaseUrl", event.target.value)} placeholder="http://localhost:32400" />
              </label>
              <label>
                Plex token
                <input value={draft.plexToken} onChange={(event) => update("plexToken", event.target.value)} placeholder="Paste token" />
              </label>
            </>
          ) : null}
          {draft.mediaServerType === "jellyfin" || draft.mediaServerType === "emby" ? (
            <EmbyFamilyFields draft={draft} update={update} />
          ) : null}
        </ConnectionCard>

        <ConnectionCard
          title="TMDb (required)"
          description="Required for MediaGap to work. Powers filmographies, posters, release dates, ratings, and optional collection artwork."
          onTest={() => test("tmdb")}
          result={connection.tmdb}
        >
          <label>
            API key
            <input value={draft.tmdbApiKey} onChange={(event) => update("tmdbApiKey", event.target.value)} placeholder="TMDb API key" />
          </label>
          <p className="muted-line">
            Required — MediaGap needs this to search and match movies.{" "}
            <a href="https://www.themoviedb.org/signup" target="_blank" rel="noopener noreferrer">
              Create a free account
            </a>{" "}
            at themoviedb.org, then get a key under{" "}
            <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer">
              Settings → API
            </a>
            .
          </p>
          <label>
            Fanart.tv API key optional
            <input
              value={draft.fanartApiKey}
              onChange={(event) => update("fanartApiKey", event.target.value)}
              placeholder="Fanart.tv API key for collection logos"
            />
          </label>
          <p className="muted-line">
            Optional — Fanart is only used for franchise/collection artwork. Leave it blank to use TMDb art and text.{" "}
            <a href="https://fanart.tv/get-an-api-key/" target="_blank" rel="noopener noreferrer">
              Get a Fanart.tv key
            </a>
            .
          </p>
        </ConnectionCard>

        <ConnectionCard
          title="NZBHydra"
          description="Used to search for missing movie releases."
          onTest={() => test("nzbhydra")}
          result={connection.nzbhydra}
        >
          <label>
            Hydra URL
            <input
              value={draft.nzbHydraBaseUrl}
              onChange={(event) => update("nzbHydraBaseUrl", event.target.value)}
              placeholder="http://localhost:5076"
            />
          </label>
          <label>
            API key
            <input value={draft.nzbHydraApiKey} onChange={(event) => update("nzbHydraApiKey", event.target.value)} placeholder="NZBHydra API key" />
          </label>
        </ConnectionCard>

        <ConnectionCard
          title="Downloader"
          description="Send selected releases straight to SABnzbd or NZBGet."
          onTest={() => test("downloader")}
          result={connection.downloader}
        >
          <label>
            Type
            <select value={draft.downloaderType} onChange={(event) => update("downloaderType", event.target.value as AppSettings["downloaderType"])}>
              {DOWNLOADER_TYPES.map((type) => (
                <option value={type} key={type}>
                  {type === "none" ? "None" : type === "sabnzbd" ? "SABnzbd" : "NZBGet"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Downloader URL
            <input
              value={draft.downloaderBaseUrl}
              onChange={(event) => update("downloaderBaseUrl", event.target.value)}
              placeholder="http://localhost:8080"
            />
          </label>
          <label>
            API key
            <input value={draft.downloaderApiKey} onChange={(event) => update("downloaderApiKey", event.target.value)} placeholder="SABnzbd API key" />
          </label>
          <label>
            Default category
            <CategorySelect
              value={draft.downloaderDefaultCategory}
              onChange={(value) => update("downloaderDefaultCategory", value)}
              downloaderType={draft.downloaderType}
              downloaderBaseUrl={draft.downloaderBaseUrl}
              downloaderApiKey={draft.downloaderApiKey}
            />
          </label>
        </ConnectionCard>

        <ConnectionCard title="Logging" description="Write local app activity and integration errors to a log file." onTest={refreshLogs} result={null}>
          <label className="toggle-row">
            <input type="checkbox" checked={draft.loggingEnabled} onChange={(event) => update("loggingEnabled", event.target.checked)} />
            Enable logging
          </label>
          <label>
            Log file path
            <input value={draft.logPath} onChange={(event) => update("logPath", event.target.value)} placeholder="data/app.log" />
          </label>
          <div className="settings-actions">
            <button className="secondary-button" onClick={() => update("logPath", "")}>
              Use default
            </button>
            <button className="secondary-button" onClick={openLogs}>
              <FolderOpen size={17} />
              Open folder
            </button>
            <button className="secondary-button" onClick={refreshLogs} disabled={logsLoading}>
              <RefreshCw size={17} className={logsLoading ? "spin" : ""} />
              Refresh logs
            </button>
          </div>
          <div className="log-viewer">
            <strong>{logPath || "Recent logs"}</strong>
            {logLines.length ? (
              <pre>{logLines.join("\n")}</pre>
            ) : (
              <p>No log entries yet. Run a scan, search, or send action and refresh.</p>
            )}
          </div>
        </ConnectionCard>
      </div>

      <div className="filter-settings">
        <div>
          <h3>Default quality</h3>
          <div className="chip-row">
            {QUALITY_FILTERS.map((quality) => (
              <button
                key={quality}
                className={draft.defaultQualities.includes(quality) ? "chip selected" : "chip"}
                onClick={() => toggleList("defaultQualities", quality)}
              >
                {quality}
              </button>
            ))}
          </div>
        </div>
        <div>
          <h3>Default source</h3>
          <div className="chip-row">
            {SOURCE_FILTERS.map((source) => (
              <button
                key={source}
                className={draft.defaultSources.includes(source) ? "chip selected" : "chip"}
                onClick={() => toggleList("defaultSources", source)}
              >
                {source}
              </button>
            ))}
          </div>
          <p className="muted-line">Leave all sources off if you only want quality terms in new searches.</p>
        </div>
        <div>
          <h3>Theme</h3>
          <select value={draft.themeMode} onChange={(event) => update("themeMode", event.target.value as AppSettings["themeMode"])}>
            {THEME_MODES.map((theme) => (
              <option value={theme} key={theme}>
                {themeLabel(theme)}
              </option>
            ))}
          </select>
        </div>
        <label className="toggle-row">
          <input type="checkbox" checked={draft.refreshOnStart} onChange={(event) => update("refreshOnStart", event.target.checked)} />
          Refresh {mediaServerLabel(draft.mediaServerType)} library when the app starts
        </label>
      </div>

      {status ? <p className="status-line">{status}</p> : null}
    </section>
  );
}

function ConnectionCard({
  title,
  description,
  children,
  onTest,
  result
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  onTest: () => void;
  result?: ConnectionResult | null;
}) {
  return (
    <div className="connection-card">
      <div className="connection-title">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <button className="ghost-button" onClick={onTest}>
          <PlugZap size={17} />
          Test
        </button>
      </div>
      <div className="field-stack">{children}</div>
      {result ? (
        <p className={result.ok ? "connection-result ok" : "connection-result bad"}>
          {result.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          {result.message}
        </p>
      ) : null}
    </div>
  );
}

function EmbyFamilyFields({
  draft,
  update
}: {
  draft: AppSettings;
  update: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}) {
  const isEmby = draft.mediaServerType === "emby";
  const label = mediaServerLabel(draft.mediaServerType);
  const baseUrlKey = isEmby ? "embyBaseUrl" : "jellyfinBaseUrl";
  const apiKeyKey = isEmby ? "embyApiKey" : "jellyfinApiKey";
  const userIdKey = isEmby ? "embyUserId" : "jellyfinUserId";

  return (
    <>
      <label>
        {label} URL
        <input
          value={draft[baseUrlKey]}
          onChange={(event) => update(baseUrlKey, event.target.value)}
          placeholder="http://localhost:8096"
        />
      </label>
      <label>
        API key
        <input
          value={draft[apiKeyKey]}
          onChange={(event) => update(apiKeyKey, event.target.value)}
          placeholder={`${label} API key`}
        />
      </label>
      <label>
        User ID
        <input
          value={draft[userIdKey]}
          onChange={(event) => update(userIdKey, event.target.value)}
          placeholder={`${label} user ID or username`}
        />
      </label>
      <p className="muted-line">{label} scans are user-scoped, so MediaGap needs the user ID or exact username for library views.</p>
    </>
  );
}
