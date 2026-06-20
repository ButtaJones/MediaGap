import type { DownloaderQueueItem, DownloaderStatusResponse, DownloaderType } from "../../shared/types.js";
import { fetchNzb } from "../services/nzb.js";

export function serviceUrl(baseUrl: string, endpoint: string) {
  const url = new URL(baseUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.at(-1)?.toLowerCase() === endpoint.toLowerCase()) {
    return url;
  }
  return new URL(endpoint, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
}

export function redactUrl(url: URL) {
  const redacted = new URL(url.toString());
  if (redacted.searchParams.has("apikey")) redacted.searchParams.set("apikey", "REDACTED");
  return redacted.toString();
}

export async function testDownloaderConnection(type: DownloaderType, baseUrl: string, apiKey: string) {
  if (type === "sabnzbd") {
    const url = serviceUrl(baseUrl, "api");
    url.searchParams.set("mode", "version");
    url.searchParams.set("output", "json");
    url.searchParams.set("apikey", apiKey);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`SABnzbd returned ${response.status} at ${redactUrl(url)}`);
    return { name: "SABnzbd" };
  }

  if (type === "nzbget") {
    const response = await nzbGetRpc(baseUrl, "version", []);
    return { name: `NZBGet ${response ?? ""}`.trim() };
  }

  throw new Error("Choose SABnzbd or NZBGet first.");
}

export async function getDownloaderStatus(type: DownloaderType, baseUrl: string, apiKey: string): Promise<DownloaderStatusResponse> {
  if (type === "sabnzbd") {
    const [queue, history] = await Promise.all([
      sabApi<{ queue?: { slots?: SabQueueSlot[] } }>(baseUrl, apiKey, "queue"),
      sabApi<{ history?: { slots?: SabHistorySlot[] } }>(baseUrl, apiKey, "history", { limit: "10" })
    ]);

    return {
      ok: true,
      type,
      queue: (queue.queue?.slots ?? []).map(mapSabQueue),
      history: (history.history?.slots ?? []).map(mapSabHistory),
      message: "Downloader status loaded."
    };
  }

  if (type === "nzbget") {
    const [groups, history] = await Promise.all([
      nzbGetRpc(baseUrl, "listgroups", []),
      nzbGetRpc(baseUrl, "history", [])
    ]);

    return {
      ok: true,
      type,
      queue: Array.isArray(groups) ? groups.slice(0, 20).map(mapNzbGetGroup) : [],
      history: Array.isArray(history) ? history.slice(0, 10).map(mapNzbGetHistory) : [],
      message: "Downloader status loaded."
    };
  }

  return {
    ok: false,
    type,
    queue: [],
    history: [],
    message: "Choose SABnzbd or NZBGet in Settings first."
  };
}

// Best-effort fetch of the downloader's configured categories. Returns [] (never throws) so
// the UI can fall back to a free-text field per AGENTS' graceful-fallback rule.
export async function getDownloaderCategories(type: DownloaderType, baseUrl: string, apiKey: string): Promise<string[]> {
  try {
    if (type === "sabnzbd") {
      const data = await sabApi<{ categories?: string[] }>(baseUrl, apiKey, "get_cats");
      const categories = Array.isArray(data.categories) ? data.categories : [];
      // SABnzbd lists "*" as the catch-all default; drop it and blanks/dupes.
      return [...new Set(categories.filter((cat) => cat && cat !== "*"))];
    }

    if (type === "nzbget") {
      const config = await nzbGetRpc(baseUrl, "config", []);
      if (!Array.isArray(config)) return [];
      const categories = config
        .filter((entry): entry is { Name?: string; Value?: string } => typeof entry === "object" && entry !== null)
        .filter((entry) => /^Category\d+\.Name$/.test(String(entry.Name)))
        .map((entry) => String(entry.Value ?? "").trim())
        .filter(Boolean);
      return [...new Set(categories)];
    }
  } catch {
    // Non-fatal: fall back to free text / default category.
  }
  return [];
}

export async function sendToDownloader(
  type: DownloaderType,
  baseUrl: string,
  apiKey: string,
  releaseUrl: string,
  releaseTitle: string,
  category: string
) {
  if (type === "sabnzbd") {
    const nzb = await fetchNzb(releaseUrl, releaseTitle);
    const url = serviceUrl(baseUrl, "api");
    url.searchParams.set("mode", "addfile");
    url.searchParams.set("output", "json");
    url.searchParams.set("apikey", apiKey);
    if (category) url.searchParams.set("cat", category);

    const form = new FormData();
    form.append("name", new Blob([nzb.bytes], { type: "application/x-nzb" }), nzb.filename);

    const response = await fetch(url, {
      method: "POST",
      body: form
    });
    if (!response.ok) throw new Error(`SABnzbd returned ${response.status} at ${redactUrl(url)}`);
    const payload = (await response.json()) as { status?: boolean; error?: string };
    if (payload.status === false) throw new Error(payload.error ?? "SABnzbd rejected the release.");
    return { ok: true, message: `Sent "${releaseTitle}" to SABnzbd.` };
  }

  if (type === "nzbget") {
    const nzb = await fetchNzb(releaseUrl, releaseTitle);
    await nzbGetRpc(baseUrl, "append", [nzb.filename, nzb.bytes.toString("base64"), category, 0, false, false, "", 0, "SCORE", []]);
    return { ok: true, message: `Sent "${releaseTitle}" to NZBGet.` };
  }

  throw new Error("Choose SABnzbd or NZBGet in Settings first.");
}

export async function controlDownloader(type: DownloaderType, baseUrl: string, apiKey: string, action: "pause" | "resume") {
  if (type === "sabnzbd") {
    await sabApi(baseUrl, apiKey, action);
    return { ok: true, message: action === "pause" ? "Paused SABnzbd downloads." : "Resumed SABnzbd downloads." };
  }

  if (type === "nzbget") {
    await nzbGetRpc(baseUrl, action === "pause" ? "pausedownload" : "resumedownload", []);
    return { ok: true, message: action === "pause" ? "Paused NZBGet downloads." : "Resumed NZBGet downloads." };
  }

  throw new Error("Choose SABnzbd or NZBGet in Settings first.");
}

async function nzbGetRpc(baseUrl: string, method: string, params: unknown[]) {
  const url = serviceUrl(baseUrl, "jsonrpc");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
      id: 1
    })
  });

  if (!response.ok) throw new Error(`NZBGet returned ${response.status} at ${redactUrl(url)}`);
  const payload = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message ?? "NZBGet rejected the request.");
  return payload.result;
}

async function sabApi<T>(baseUrl: string, apiKey: string, mode: string, params: Record<string, string> = {}) {
  const url = serviceUrl(baseUrl, "api");
  url.searchParams.set("mode", mode);
  url.searchParams.set("output", "json");
  url.searchParams.set("apikey", apiKey);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`SABnzbd returned ${response.status} at ${redactUrl(url)}`);
  return (await response.json()) as T;
}

interface SabQueueSlot {
  nzo_id?: string;
  filename?: string;
  status?: string;
  cat?: string;
  percentage?: string | number;
  mb?: string;
  mbleft?: string;
  speed?: string;
  timeleft?: string;
}

interface SabHistorySlot {
  nzo_id?: string;
  name?: string;
  status?: string;
  category?: string;
  size?: string;
  completed?: number;
}

function mapSabQueue(item: SabQueueSlot): DownloaderQueueItem {
  return {
    id: item.nzo_id ?? item.filename ?? crypto.randomUUID(),
    name: item.filename ?? "Unknown download",
    status: item.status ?? "queued",
    category: item.cat ?? null,
    progress: toPercent(item.percentage),
    size: item.mb ? `${item.mb} MB` : null,
    remaining: item.mbleft ? `${item.mbleft} MB` : null,
    speed: item.speed ?? null,
    eta: item.timeleft ?? null
  };
}

function mapSabHistory(item: SabHistorySlot): DownloaderQueueItem {
  return {
    id: item.nzo_id ?? item.name ?? crypto.randomUUID(),
    name: item.name ?? "Unknown download",
    status: item.status ?? "history",
    category: item.category ?? null,
    progress: 100,
    size: item.size ?? null,
    remaining: null,
    speed: null,
    eta: item.completed ? new Date(item.completed * 1000).toLocaleString() : null
  };
}

function mapNzbGetGroup(item: Record<string, unknown>): DownloaderQueueItem {
  const size = Number(item.FileSizeMB ?? item.FileSizeLo ?? 0);
  const remaining = Number(item.RemainingSizeMB ?? item.RemainingSizeLo ?? 0);
  const rate = Number(item.DownloadRate ?? 0);
  const progress = size > 0 ? Math.round(((size - remaining) / size) * 100) : null;
  return {
    id: String(item.NZBID ?? item.Name ?? crypto.randomUUID()),
    name: String(item.Name ?? "Unknown download"),
    status: String(item.Status ?? "queued"),
    category: item.Category ? String(item.Category) : null,
    progress,
    size: size ? `${size} MB` : null,
    remaining: remaining ? `${remaining} MB` : null,
    speed: rate ? formatRate(rate) : null,
    eta: rate && remaining ? formatEta((remaining * 1024 * 1024) / rate) : null
  };
}

function mapNzbGetHistory(item: Record<string, unknown>): DownloaderQueueItem {
  return {
    id: String(item.ID ?? item.NZBID ?? item.Name ?? crypto.randomUUID()),
    name: String(item.Name ?? "Unknown download"),
    status: String(item.Status ?? "history"),
    category: item.Category ? String(item.Category) : null,
    progress: 100,
    size: item.FileSizeMB ? `${item.FileSizeMB} MB` : null,
    remaining: null,
    speed: null,
    eta: item.Time ? new Date(Number(item.Time) * 1000).toLocaleString() : null
  };
}

function toPercent(value: string | number | undefined) {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : null;
}

function formatRate(bytesPerSecond: number) {
  if (bytesPerSecond >= 1024 * 1024) return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`;
  if (bytesPerSecond >= 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  return `${bytesPerSecond.toFixed(0)} B/s`;
}

function formatEta(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}
