export async function fetchNzb(link: string, title: string) {
  const response = await fetch(link);
  if (!response.ok) throw new Error(`NZB download returned ${response.status} for ${title}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    filename: `${safeFilename(title)}.nzb`,
    bytes
  };
}

export async function fetchManyNzbs(releases: Array<{ link: string; title: string }>) {
  const files = [];
  for (const release of releases) {
    files.push(await fetchNzb(release.link, release.title));
  }
  return files;
}

export function safeFilename(value: string) {
  return (
    value
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140) || "release"
  );
}
