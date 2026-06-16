import type { AppSettings } from "../../shared/types.js";
import { EmbyServer } from "./emby.js";
import { JellyfinServer } from "./jellyfin.js";
import type { MediaServer } from "./mediaServer.js";
import { PlexServer } from "./plex.js";

export function createMediaServer(settings: AppSettings): MediaServer {
  if (settings.mediaServerType === "plex") {
    if (!settings.plexBaseUrl || !settings.plexToken) throw new Error("Add Plex URL and token in Settings first.");
    return new PlexServer(settings.plexBaseUrl, settings.plexToken);
  }

  if (settings.mediaServerType === "jellyfin") {
    if (!settings.jellyfinBaseUrl || !settings.jellyfinApiKey || !settings.jellyfinUserId) {
      throw new Error("Add Jellyfin URL, API key, and user ID in Settings first.");
    }
    return new JellyfinServer(settings.jellyfinBaseUrl, settings.jellyfinApiKey, settings.jellyfinUserId, settings.tmdbApiKey);
  }

  if (settings.mediaServerType === "emby") {
    if (!settings.embyBaseUrl || !settings.embyApiKey || !settings.embyUserId) {
      throw new Error("Add Emby URL, API key, and user ID in Settings first.");
    }
    return new EmbyServer(settings.embyBaseUrl, settings.embyApiKey, settings.embyUserId, settings.tmdbApiKey);
  }

  throw new Error("Choose Plex, Jellyfin, or Emby in Settings first.");
}
