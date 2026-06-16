import type {
  AppSettings,
  AppMeta,
  BulkDownloaderSendResponse,
  ConnectionResult,
  CollectionsRefreshStatus,
  CollectionsResponse,
  DownloadHistoryEntry,
  DownloaderStatusResponse,
  DownloaderSendResponse,
  LogResponse,
  MovieDetails,
  MovieResult,
  NzbResult,
  NzbSearchResponse,
  MediaServerLibrary,
  ScanResponse,
  SearchResponse,
  SearchSuggestion
} from "../../shared/types";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    },
    ...options
  });

  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    const payload = contentType.includes("application/json")
      ? ((await response.json().catch(() => null)) as { message?: string } | null)
      : null;
    throw new Error(payload?.message ?? `Request failed with ${response.status}`);
  }

  if (!contentType.includes("application/json")) {
    throw new Error("The API returned the app page instead of JSON. Restart the app server so the latest API routes are active.");
  }

  return (await response.json()) as T;
}

export const api = {
  meta: () => request<AppMeta>("/meta"),
  settings: () => request<AppSettings>("/settings"),
  saveSettings: (settings: AppSettings) =>
    request<AppSettings>("/settings", {
      method: "PUT",
      body: JSON.stringify(settings)
    }),
  stats: () => request<{ movieCount: number; lastScannedAt: string | null }>("/stats"),
  testConnection: (service: "media-server" | "plex" | "tmdb" | "nzbhydra" | "downloader", settings?: AppSettings) =>
    request<ConnectionResult>(`/connections/${service}/test`, {
      method: "POST",
      body: settings ? JSON.stringify(settings) : undefined
    }),
  mediaLibraries: () => request<{ libraries: MediaServerLibrary[] }>("/media-server/libraries"),
  scanMediaServer: (sectionKeys: string[]) =>
    request<ScanResponse>("/media-server/scan", {
      method: "POST",
      body: JSON.stringify({ sectionKeys })
    }),
  plexLibraries: () => request<{ libraries: MediaServerLibrary[] }>("/plex/libraries"),
  scanPlex: (sectionKeys: string[]) =>
    request<ScanResponse>("/plex/scan", {
      method: "POST",
      body: JSON.stringify({ sectionKeys })
    }),
  search: (query: string, type: "person" | "movie" | "studio") =>
    request<SearchResponse>(`/search?q=${encodeURIComponent(query)}&type=${type}`),
  suggest: (query: string, type: "person" | "movie" | "studio") =>
    request<{ query: string; suggestions: SearchSuggestion[] }>(`/suggest?q=${encodeURIComponent(query)}&type=${type}`),
  collections: () => request<CollectionsResponse>("/collections/continue"),
  discoverCollections: () => request<CollectionsResponse>("/collections/discover"),
  refreshCollections: () => request<CollectionsRefreshStatus>("/collections/refresh", { method: "POST" }),
  collectionsRefreshStatus: () => request<CollectionsRefreshStatus>("/collections/refresh/status"),
  searchNzb: (
    movie: Pick<MovieResult, "title" | "year">,
    qualities: string[],
    sources: string[],
    extraTerms: string,
    query: string,
    limit: number,
    offset: number
  ) =>
    request<NzbSearchResponse>("/nzbhydra/search", {
      method: "POST",
      body: JSON.stringify({ title: movie.title, year: movie.year, qualities, sources, extraTerms, query, limit, offset })
    }),
  movieDetails: (tmdbId: number) => request<MovieDetails>(`/movies/${tmdbId}/details`),
  sendToDownloader: (release: Pick<NzbResult, "link" | "title">, category: string) =>
    request<DownloaderSendResponse>("/downloader/send", {
      method: "POST",
      body: JSON.stringify({ link: release.link, title: release.title, category })
    }),
  sendManyToDownloader: (releases: Array<Pick<NzbResult, "link" | "title">>, category: string) =>
    request<BulkDownloaderSendResponse>("/downloader/send-many", {
      method: "POST",
      body: JSON.stringify({ releases, category })
    }),
  downloadNzbZip: async (movieTitle: string, releases: Array<Pick<NzbResult, "link" | "title">>) => {
    const response = await fetch("/api/nzb/download-zip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ movieTitle, releases })
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(payload?.message ?? `Request failed with ${response.status}`);
    }
    const disposition = response.headers.get("content-disposition") ?? "";
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "selected-nzbs.zip";
    return { blob: await response.blob(), filename };
  },
  recentLogs: () => request<LogResponse>("/logs/recent"),
  openLogFolder: () => request<{ ok: boolean; message: string }>("/logs/open-folder", { method: "POST" }),
  downloaderStatus: () => request<DownloaderStatusResponse>("/downloader/status"),
  pauseDownloader: () => request<{ ok: boolean; message: string }>("/downloader/control/pause", { method: "POST" }),
  resumeDownloader: () => request<{ ok: boolean; message: string }>("/downloader/control/resume", { method: "POST" }),
  history: () => request<{ entries: DownloadHistoryEntry[] }>("/history"),
  updateHistory: (id: number, patch: Pick<DownloadHistoryEntry, "status" | "notes">) =>
    request<DownloadHistoryEntry>(`/history/${id}`, {
      method: "PUT",
      body: JSON.stringify(patch)
    }),
  deleteHistory: (id: number) => request<{ ok: boolean }>(`/history/${id}`, { method: "DELETE" })
};
