import type { AppSettings, MediaServerLibrary, MediaServerMovie, MediaServerType } from "../../shared/types.js";
import { mediaServerLabel } from "../../shared/types.js";

export interface MediaServerConnectionResult {
  name: string;
  version?: string | null;
}

export interface MediaServerScanResult {
  movies: MediaServerMovie[];
  sections: string[];
}

export interface MediaServer {
  type: MediaServerType;
  displayName: string;
  testConnection(): Promise<MediaServerConnectionResult>;
  getMovieLibraries(): Promise<MediaServerLibrary[]>;
  scanMovies(libraryIds?: string[]): Promise<MediaServerScanResult>;
  /**
   * The server's own identifier used to build deep-links into its web UI:
   * Plex's machineIdentifier, or the Jellyfin/Emby System/Info Id. Returns null
   * if it cannot be determined.
   */
  getServerId(): Promise<string | null>;
}

export function activeMediaServerLabel(settings: Pick<AppSettings, "mediaServerType">): string {
  return mediaServerLabel(settings.mediaServerType);
}
