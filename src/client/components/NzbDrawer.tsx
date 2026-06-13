import { Download, Send, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { QUALITY_FILTERS, SOURCE_FILTERS, type MovieResult, type NzbResult } from "../../shared/types";
import { api } from "../lib/api";

const FALLBACK_QUALITIES = ["1080p"];
const FALLBACK_SOURCES = ["BluRay", "WEB-DL"];

interface NzbDrawerProps {
  movie: MovieResult | null;
  defaultQualities: string[];
  defaultSources: string[];
  defaultCategory: string;
  downloaderEnabled: boolean;
  onClose: () => void;
}

export function NzbDrawer({ movie, defaultQualities, defaultSources, defaultCategory, downloaderEnabled, onClose }: NzbDrawerProps) {
  const effectiveDefaultQualities = defaultQualities.length ? defaultQualities : FALLBACK_QUALITIES;
  const effectiveDefaultSources = defaultSources.length ? defaultSources : FALLBACK_SOURCES;
  const [qualities, setQualities] = useState<string[]>(effectiveDefaultQualities);
  const [sources, setSources] = useState<string[]>(effectiveDefaultSources);
  const [results, setResults] = useState<NzbResult[]>([]);
  const [query, setQuery] = useState("");
  const [extraTerms, setExtraTerms] = useState("");
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<"date" | "size" | "title">("date");
  const [sortDirection, setSortDirection] = useState<"desc" | "asc">("desc");
  const [category, setCategory] = useState(defaultCategory);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedLinks, setSelectedLinks] = useState<string[]>([]);

  useEffect(() => {
    setQualities(effectiveDefaultQualities);
    setSources(effectiveDefaultSources);
    setResults([]);
    setQuery(movie ? buildEditableQuery(movie, effectiveDefaultQualities, effectiveDefaultSources, "") : "");
    setExtraTerms("");
    setOffset(0);
    setTotal(null);
    setCategory(defaultCategory);
    setError("");
    setNotice("");
    setSelectedLinks([]);
  }, [movie, defaultQualities, defaultSources, defaultCategory]);

  const sortedResults = useMemo(() => {
    const sorted = [...results].sort((a, b) => {
      const direction = sortDirection === "desc" ? -1 : 1;
      if (sortBy === "size") return ((a.size ?? 0) - (b.size ?? 0)) * direction;
      if (sortBy === "title") return a.title.localeCompare(b.title) * direction;
      return (new Date(a.publishDate ?? 0).getTime() - new Date(b.publishDate ?? 0).getTime()) * direction;
    });
    return sorted;
  }, [results, sortBy, sortDirection]);

  const hasNextPage = total === null ? results.length >= limit : offset + limit < total;
  const pageStart = results.length ? offset + 1 : 0;
  const pageEnd = offset + results.length;

  if (!movie) return null;

  function rebuildQuery(nextQualities = qualities, nextSources = sources, nextExtraTerms = extraTerms) {
    if (!movie) return;
    setQuery(buildEditableQuery(movie, nextQualities, nextSources, nextExtraTerms));
  }

  function toggleQuality(value: string) {
    const next = qualities.includes(value) ? qualities.filter((item) => item !== value) : [...qualities, value];
    setQualities(next);
    rebuildQuery(next, sources, extraTerms);
  }

  function toggleSource(value: string) {
    const next = sources.includes(value) ? sources.filter((item) => item !== value) : [...sources, value];
    setSources(next);
    rebuildQuery(qualities, next, extraTerms);
  }

  async function search(nextOffset = offset) {
    if (!movie) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await api.searchNzb(movie, qualities, sources, extraTerms, query, limit, nextOffset);
      setResults(response.results);
      setSelectedLinks([]);
      setQuery(response.query);
      setOffset(response.offset);
      setLimit(response.limit);
      setTotal(response.total);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "NZBHydra search failed.");
    } finally {
      setLoading(false);
    }
  }

  async function sendRelease(result: NzbResult) {
    setError("");
    setNotice("");
    try {
      const response = await api.sendToDownloader(result, category);
      setNotice(response.message);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Could not send release.");
    }
  }

  async function sendSelected() {
    const selected = sortedResults.filter((result) => selectedLinks.includes(result.link));
    if (!selected.length) {
      setError("Select at least one release first.");
      return;
    }
    setError("");
    setNotice("");
    try {
      const response = await api.sendManyToDownloader(selected, category);
      if (response.errors.length) {
        setError(response.errors.join("\n"));
      }
      setNotice(response.message);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Could not send selected releases.");
    }
  }

  async function downloadSelected() {
    const selected = sortedResults.filter((result) => selectedLinks.includes(result.link));
    if (!selected.length || !movie) {
      setError("Select at least one release first.");
      return;
    }
    setError("");
    setNotice("");
    try {
      const response = await api.downloadNzbZip(movie.title, selected);
      const url = URL.createObjectURL(response.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = response.filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice(`Downloaded ${selected.length} selected NZB${selected.length === 1 ? "" : "s"} as a zip.`);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Could not download selected NZBs.");
    }
  }

  function toggleSelected(link: string, checked: boolean) {
    setSelectedLinks((current) => (checked ? [...new Set([...current, link])] : current.filter((item) => item !== link)));
  }

  return (
    <aside className="drawer" aria-label="NZBHydra search">
      <div className="drawer-header">
        <div>
          <p className="eyebrow">NZBHydra search</p>
          <h2>{movie.title}</h2>
          <p>{movie.year ?? "Unknown year"}</p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close NZBHydra search">
          <X size={20} />
        </button>
      </div>

      <div className="drawer-section">
        <h3>Quality</h3>
        <div className="chip-row">
          {QUALITY_FILTERS.map((quality) => (
            <button key={quality} className={qualities.includes(quality) ? "chip selected" : "chip"} onClick={() => toggleQuality(quality)}>
              {quality}
            </button>
          ))}
        </div>
      </div>

      <div className="drawer-section">
        <h3>Source</h3>
        <div className="chip-row">
          {SOURCE_FILTERS.map((source) => (
            <button key={source} className={sources.includes(source) ? "chip selected" : "chip"} onClick={() => toggleSource(source)}>
              {source}
            </button>
          ))}
        </div>
      </div>

      <div className="drawer-section">
        <h3>Search query</h3>
        <input
          className="query-box query-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Exact NZBHydra query"
        />
        <label className="manual-query">
          Add terms
          <input
            value={extraTerms}
            onChange={(event) => {
              const next = event.target.value;
              setExtraTerms(next);
              rebuildQuery(qualities, sources, next);
            }}
            placeholder="remux, proper, x265, atmos"
          />
        </label>
      </div>

      <div className="drawer-toolbar">
        <label>
          Show
          <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
        <label>
          Sort
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value as "date" | "size" | "title")}>
            <option value="date">Date</option>
            <option value="size">Size</option>
            <option value="title">Title</option>
          </select>
        </label>
        <label>
          Order
          <select value={sortDirection} onChange={(event) => setSortDirection(event.target.value as "desc" | "asc")}>
            <option value="desc">Desc</option>
            <option value="asc">Asc</option>
          </select>
        </label>
      </div>

      <label className="manual-query">
        Downloader category
        <input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="movies" />
      </label>

      <button className="primary-button wide" onClick={() => search(0)} disabled={loading}>
        {loading ? "Searching" : "Search releases"}
      </button>

      {error ? <p className="error-line">{error}</p> : null}
      {notice ? <p className="status-line">{notice}</p> : null}

      <Pager
        pageStart={pageStart}
        pageEnd={pageEnd}
        total={total}
        canPrevious={offset > 0}
        canNext={hasNextPage}
        loading={loading}
        onPrevious={() => search(Math.max(0, offset - limit))}
        onNext={() => search(offset + limit)}
      />

      {results.length ? (
        <div className="bulk-actions">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={selectedLinks.length > 0 && selectedLinks.length === sortedResults.length}
              onChange={(event) => setSelectedLinks(event.target.checked ? sortedResults.map((result) => result.link) : [])}
            />
            Select all on page
          </label>
          <button className="secondary-button" onClick={() => setSelectedLinks([])} disabled={!selectedLinks.length}>
            Clear
          </button>
          <button className="secondary-button" onClick={downloadSelected} disabled={!selectedLinks.length}>
            <Download size={17} />
            {selectedLinks.length > 1 ? `Download ZIP (${selectedLinks.length})` : "Download selected"}
          </button>
          <button className="primary-button" onClick={sendSelected} disabled={!downloaderEnabled || !selectedLinks.length}>
            <Send size={17} />
            Send selected ({selectedLinks.length})
          </button>
        </div>
      ) : null}

      <div className="release-list">
        {sortedResults.map((result) => (
          <div className="release-row" key={`${result.title}-${result.link}`}>
            <input
              className="release-checkbox"
              type="checkbox"
              checked={selectedLinks.includes(result.link)}
              onChange={(event) => toggleSelected(result.link, event.target.checked)}
              aria-label={`Select ${result.title}`}
            />
            <div>
              <strong>{result.title}</strong>
              <span>
                {result.indexer ?? "Unknown indexer"} · {formatBytes(result.size)} · {result.ageDays ?? "?"} days
              </span>
            </div>
            <div className="release-actions">
              <a className="icon-button small" href={result.link} target="_blank" rel="noreferrer" title="Download NZB">
                <Download size={16} />
              </a>
              <button
                className="icon-button small"
                onClick={() => sendRelease(result)}
                disabled={!downloaderEnabled}
                title={downloaderEnabled ? "Send to downloader" : "Set up a downloader first"}
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <Pager
        pageStart={pageStart}
        pageEnd={pageEnd}
        total={total}
        canPrevious={offset > 0}
        canNext={hasNextPage}
        loading={loading}
        onPrevious={() => search(Math.max(0, offset - limit))}
        onNext={() => search(offset + limit)}
      />
    </aside>
  );
}

function Pager({
  pageStart,
  pageEnd,
  total,
  canPrevious,
  canNext,
  loading,
  onPrevious,
  onNext
}: {
  pageStart: number;
  pageEnd: number;
  total: number | null;
  canPrevious: boolean;
  canNext: boolean;
  loading: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  if (!pageEnd) return null;
  return (
    <div className="pager">
      <span>
        Showing {pageStart}-{pageEnd}
        {total !== null ? ` of ${total}` : ""}
      </span>
      <div>
        <button className="secondary-button" onClick={onPrevious} disabled={!canPrevious || loading}>
          Previous
        </button>
        <button className="secondary-button" onClick={onNext} disabled={!canNext || loading}>
          Next
        </button>
      </div>
    </div>
  );
}

function formatBytes(size: number | null) {
  if (!size) return "Unknown size";
  const gb = size / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(size / 1024 / 1024).toFixed(0)} MB`;
}

function buildEditableQuery(movie: Pick<MovieResult, "title" | "year">, qualities: string[], sources: string[], extraTerms: string) {
  return [
    normalizeReleaseTitle(movie.title),
    movie.year ? String(movie.year) : "",
    ...[...qualities, ...sources].map((term) => term.replace("4K", "2160p")),
    extraTerms.trim()
  ]
    .filter(Boolean)
    .join(" ");
}

function normalizeReleaseTitle(title: string) {
  return title
    .normalize("NFKD")
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
