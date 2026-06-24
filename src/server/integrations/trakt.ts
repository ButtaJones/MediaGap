import { config, isTraktConfigured } from "../config.js";
import { clearTraktAuth, getTraktAuth, saveTraktAuth, type TraktAuth } from "../db.js";
import type { TraktStatus } from "../../shared/types.js";

// All Trakt calls run server-side: the MediaGap server holds the client secret and the user's
// tokens, the browser never sees them. Auth uses the device-code flow (the documented path for
// self-hosted/CLI/service apps with no clean redirect URL).

const TRAKT_BASE = "https://api.trakt.tv";
// Refresh the access token once it's within this window of expiry (tokens last ~3 months).
const REFRESH_BEFORE_MS = 24 * 60 * 60 * 1000;

interface PendingDevice {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresAt: number;
  interval: number;
}

// In-memory device-flow state (single-process, self-hosted). Tokens themselves live in SQLite.
let pending: PendingDevice | null = null;
let lastMessage: string | null = null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Trakt sits behind Cloudflare, which 403s requests with no User-Agent — always send one.
const USER_AGENT = "MediaGap/0.1";

function jsonHeaders() {
  return { "Content-Type": "application/json", "User-Agent": USER_AGENT };
}

function apiHeaders(accessToken: string) {
  return {
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    "trakt-api-version": "2",
    "trakt-api-key": config.traktClientId,
    Authorization: `Bearer ${accessToken}`
  };
}

interface TraktTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export function getTraktStatus(): TraktStatus {
  const configured = isTraktConfigured();
  const auth = getTraktAuth();
  const connected = Boolean(auth?.accessToken);
  const isPending = Boolean(pending && Date.now() < pending.expiresAt);
  return {
    configured,
    connected,
    username: auth?.username ?? null,
    pending: isPending,
    userCode: isPending ? pending!.userCode : null,
    verificationUrl: isPending ? pending!.verificationUrl : null,
    expiresAt: isPending ? new Date(pending!.expiresAt).toISOString() : null,
    message: connected ? null : lastMessage
  };
}

export async function startTraktDeviceFlow(): Promise<TraktStatus> {
  if (!isTraktConfigured()) throw new Error("Trakt is not configured on this server.");
  // Replace any in-flight flow; the previous poller exits when it sees pending changed.
  pending = null;
  lastMessage = null;

  const response = await fetch(`${TRAKT_BASE}/oauth/device/code`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ client_id: config.traktClientId })
  });
  if (!response.ok) throw new Error(`Trakt device-code request failed (${response.status}).`);
  const data = (await response.json()) as {
    device_code: string;
    user_code: string;
    verification_url: string;
    expires_in: number;
    interval: number;
  };

  const device: PendingDevice = {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUrl: data.verification_url || "https://trakt.tv/activate",
    expiresAt: Date.now() + data.expires_in * 1000,
    interval: Math.max(1, data.interval || 5)
  };
  pending = device;
  void pollDeviceToken(device);
  return getTraktStatus();
}

async function pollDeviceToken(device: PendingDevice): Promise<void> {
  while (pending === device && Date.now() < device.expiresAt) {
    await sleep(device.interval * 1000);
    if (pending !== device) return; // replaced or disconnected

    let response: Response;
    try {
      response = await fetch(`${TRAKT_BASE}/oauth/device/token`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          code: device.deviceCode,
          client_id: config.traktClientId,
          client_secret: config.traktClientSecret
        })
      });
    } catch {
      continue; // transient network error — keep polling
    }

    if (response.status === 200) {
      const token = (await response.json()) as TraktTokenResponse;
      await persistToken(token);
      if (pending === device) pending = null;
      return;
    }
    if (response.status === 400) continue; // still pending authorization
    if (response.status === 429) {
      device.interval += 1; // slow down
      continue;
    }
    // 404 / 409 / 410 / 418 → stop with a clear message.
    lastMessage = deviceErrorMessage(response.status);
    if (pending === device) pending = null;
    return;
  }

  if (pending === device) {
    pending = null;
    lastMessage ??= "Trakt authorization timed out. Try connecting again.";
  }
}

function deviceErrorMessage(status: number): string {
  switch (status) {
    case 404:
      return "Trakt could not find that device code. Try connecting again.";
    case 409:
      return "That Trakt code was already used. Try connecting again.";
    case 410:
      return "The Trakt code expired. Try connecting again.";
    case 418:
      return "Trakt authorization was denied.";
    default:
      return `Trakt authorization failed (${status}).`;
  }
}

async function persistToken(token: TraktTokenResponse): Promise<TraktAuth> {
  const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
  let username: string | null = null;
  try {
    username = await fetchUsername(token.access_token);
  } catch {
    // Username is cosmetic; connection still succeeds without it.
  }
  lastMessage = null;
  return saveTraktAuth({ accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt, username });
}

async function fetchUsername(accessToken: string): Promise<string | null> {
  const response = await fetch(`${TRAKT_BASE}/users/settings`, { headers: apiHeaders(accessToken) });
  if (!response.ok) return null;
  const data = (await response.json()) as { user?: { username?: string; name?: string } };
  return data.user?.username ?? data.user?.name ?? null;
}

async function refreshAccessToken(refreshToken: string): Promise<TraktAuth> {
  const response = await fetch(`${TRAKT_BASE}/oauth/token`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      refresh_token: refreshToken,
      client_id: config.traktClientId,
      client_secret: config.traktClientSecret,
      grant_type: "refresh_token"
    })
  });
  if (!response.ok) throw new Error(`Trakt token refresh failed (${response.status}).`);
  const token = (await response.json()) as TraktTokenResponse;
  const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
  const existing = getTraktAuth();
  let username = existing?.username ?? null;
  if (!username) {
    try {
      username = await fetchUsername(token.access_token);
    } catch {
      // ignore
    }
  }
  return saveTraktAuth({ accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt, username });
}

// Returns a valid access token, refreshing transparently when near expiry.
async function getValidAccessToken(): Promise<string> {
  if (!isTraktConfigured()) throw new Error("Trakt is not configured on this server.");
  const auth = getTraktAuth();
  if (!auth) throw new Error("Connect your Trakt account in Settings first.");

  const msToExpiry = new Date(auth.expiresAt).getTime() - Date.now();
  if (msToExpiry > REFRESH_BEFORE_MS) return auth.accessToken;

  try {
    const refreshed = await refreshAccessToken(auth.refreshToken);
    return refreshed.accessToken;
  } catch (error) {
    // Refresh failed but the current token may still be valid — use it rather than dropping the session.
    if (msToExpiry > 0) return auth.accessToken;
    clearTraktAuth();
    throw new Error("Your Trakt session expired. Reconnect your account in Settings.");
  }
}

export function disconnectTrakt(): TraktStatus {
  pending = null;
  lastMessage = null;
  clearTraktAuth();
  return getTraktStatus();
}

// Fetch the TMDb ids of the user's Trakt movie watchlist / watched list. Movies only —
// shows are ignored (MediaGap is movies-only). The TMDb id is MediaGap's common key, so the
// caller runs these through the existing owned/missing matching with no conversion.
export async function fetchTraktMovieTmdbIds(kind: "watchlist" | "watched"): Promise<number[]> {
  const accessToken = await getValidAccessToken();
  const path = kind === "watched" ? "/sync/watched/movies" : "/sync/watchlist/movies";
  const response = await fetch(`${TRAKT_BASE}${path}`, { headers: apiHeaders(accessToken) });
  if (!response.ok) throw new Error(`Trakt ${kind} request failed (${response.status}).`);
  const items = (await response.json()) as Array<{ movie?: { ids?: { tmdb?: number | null } } }>;
  const ids: number[] = [];
  for (const item of items) {
    const tmdb = item.movie?.ids?.tmdb;
    if (typeof tmdb === "number" && tmdb > 0) ids.push(tmdb);
  }
  return ids;
}

// TV equivalent of fetchTraktMovieTmdbIds: the user's Trakt show watchlist / watched list. Each item
// carries show.ids.tmdb — MediaGap's common key — so the caller runs these through the TV ownership
// rollup with no conversion, exactly like a TV search.
export async function fetchTraktShowTmdbIds(kind: "watchlist" | "watched"): Promise<number[]> {
  const accessToken = await getValidAccessToken();
  const path = kind === "watched" ? "/sync/watched/shows" : "/sync/watchlist/shows";
  const response = await fetch(`${TRAKT_BASE}${path}`, { headers: apiHeaders(accessToken) });
  if (!response.ok) throw new Error(`Trakt ${kind} shows request failed (${response.status}).`);
  const items = (await response.json()) as Array<{ show?: { ids?: { tmdb?: number | null } } }>;
  const ids: number[] = [];
  for (const item of items) {
    const tmdb = item.show?.ids?.tmdb;
    if (typeof tmdb === "number" && tmdb > 0) ids.push(tmdb);
  }
  return ids;
}
