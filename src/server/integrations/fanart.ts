const FANART_BASE = "https://webservice.fanart.tv/v3";

interface FanartImage {
  url?: string;
  lang?: string;
  likes?: string;
}

interface FanartMovieResponse {
  hdmovielogo?: FanartImage[];
  movielogo?: FanartImage[];
}

export async function fetchCollectionFanartLogo(apiKey: string, collectionId: number): Promise<string | null> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) return null;

  const url = new URL(`${FANART_BASE}/movies/${collectionId}`);
  url.searchParams.set("api_key", trimmedKey);

  const response = await fetch(url);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Fanart.tv returned ${response.status} for collection ${collectionId}`);
  }

  const payload = (await response.json()) as FanartMovieResponse;
  return pickLogo([...(payload.hdmovielogo ?? []), ...(payload.movielogo ?? [])]);
}

function pickLogo(images: FanartImage[]) {
  const ranked = images
    .filter((image) => image.url)
    .sort((a, b) => languageScore(b) - languageScore(a) || Number(b.likes ?? 0) - Number(a.likes ?? 0));
  return ranked[0]?.url ?? null;
}

function languageScore(image: FanartImage) {
  if (image.lang === "en") return 2;
  if (!image.lang || image.lang === "00") return 1;
  return 0;
}
