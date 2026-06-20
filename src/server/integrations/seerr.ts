// Seerr integration — the unified successor to Overseerr/Jellyseerr. MediaGap proxies these
// calls through the server so the Seerr API key never reaches the browser, mirroring the other
// integrations. Movies only: every request sends mediaType "movie".

export function seerrApiUrl(baseUrl: string, path: string) {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(`api/v1/${path.replace(/^\//, "")}`, base);
}

async function readErrorMessage(response: Response): Promise<string> {
  // Seerr returns JSON error bodies (e.g. { message: "..." }); fall back to the status text.
  try {
    const body = (await response.json()) as { message?: string } | null;
    if (body?.message) return body.message;
  } catch {
    // Non-JSON body; ignore and use the status code below.
  }
  return `Seerr returned ${response.status}`;
}

export async function testSeerrConnection(baseUrl: string, apiKey: string) {
  const response = await fetch(seerrApiUrl(baseUrl, "status"), {
    headers: { "X-Api-Key": apiKey }
  });
  if (!response.ok) throw new Error(await readErrorMessage(response));
  const status = (await response.json().catch(() => null)) as { version?: string } | null;
  return { name: "Seerr", version: status?.version };
}

export async function requestSeerrMovie(baseUrl: string, apiKey: string, tmdbId: number) {
  const response = await fetch(seerrApiUrl(baseUrl, "request"), {
    method: "POST",
    headers: {
      "X-Api-Key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ mediaType: "movie", mediaId: tmdbId })
  });
  if (!response.ok) throw new Error(await readErrorMessage(response));
  return { ok: true };
}
