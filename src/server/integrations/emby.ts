import { EmbyFamilyServer } from "./jellyfin.js";

export class EmbyServer extends EmbyFamilyServer {
  constructor(baseUrl: string, apiKey: string, userId: string, tmdbApiKey: string) {
    super({
      type: "emby",
      displayName: "Emby",
      baseUrl,
      apiKey,
      userId,
      tmdbApiKey
    });
  }
}
