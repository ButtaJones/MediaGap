import { ChevronDown, ChevronRight, ChevronsDown, ChevronsUp, Grid2X2, List, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CollectionsRefreshStatus, MovieCollectionSummary, MovieResult } from "../../shared/types";
import { api } from "../lib/api";
import { MovieGrid } from "./MovieGrid";

interface CollectionsViewProps {
  viewMode: "poster" | "list";
  posterSize: number;
  onViewModeChange: (viewMode: "poster" | "list") => void;
  onPosterSizeChange: (posterSize: number) => void;
  onSearchNzb: (movie: MovieResult) => void;
  onShowDetails: (movie: MovieResult) => void;
  serverName: string;
  focusCollectionId?: number | null;
  onFocusHandled?: () => void;
}

type CollectionMode = "continue" | "discover";
type CollectionSort = "closest" | "missing" | "owned" | "alpha";
type CollectionFilter = "all" | "missing" | "complete" | "not-started";

const COLLECTION_PREFS_KEY = "plex-gap-finder:collections-view";

interface CollectionPrefs {
  mode?: CollectionMode;
  query?: string;
  sort?: CollectionSort;
  filter?: CollectionFilter;
  perPage?: number;
  collapsedIds?: number[];
}

export function CollectionsView({
  viewMode,
  posterSize,
  onViewModeChange,
  onPosterSizeChange,
  onSearchNzb,
  onShowDetails,
  serverName,
  focusCollectionId,
  onFocusHandled
}: CollectionsViewProps) {
  const [initialPrefs] = useState(readCollectionPrefs);
  const [continueCollections, setContinueCollections] = useState<MovieCollectionSummary[]>([]);
  const [discoverCollections, setDiscoverCollections] = useState<MovieCollectionSummary[]>([]);
  const [mode, setMode] = useState<CollectionMode>(initialPrefs.mode ?? "continue");
  const [loading, setLoading] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<CollectionsRefreshStatus | null>(null);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(initialPrefs.perPage ?? 10);
  const [query, setQuery] = useState(initialPrefs.query ?? "");
  const [sort, setSort] = useState<CollectionSort>(initialPrefs.sort ?? "closest");
  const [filter, setFilter] = useState<CollectionFilter>(initialPrefs.filter ?? "all");
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(() => new Set(initialPrefs.collapsedIds ?? []));
  const [collapseInitialized, setCollapseInitialized] = useState(Boolean(initialPrefs.collapsedIds));
  const refreshing = Boolean(refreshStatus?.running);
  const collections = mode === "continue" ? continueCollections : discoverCollections;
  const allCollections = useMemo(
    () => [...continueCollections, ...discoverCollections],
    [continueCollections, discoverCollections]
  );
  const filteredCollections = useMemo(
    () => filterAndSortCollections(collections, query, filter, sort),
    [collections, filter, query, sort]
  );
  const missingMovieTotal = useMemo(
    () => filteredCollections.reduce((total, collection) => total + collection.missingCount, 0),
    [filteredCollections]
  );
  const refreshTotal =
    refreshStatus?.phase === "collections" ? refreshStatus.totalCollections : refreshStatus?.totalMovies ?? 0;
  const refreshDone =
    refreshStatus?.phase === "collections" ? refreshStatus.fetchedCollections : refreshStatus?.checkedMovies ?? 0;
  const refreshPercent =
    refreshTotal > 0 ? Math.max(0, Math.min(100, Math.round((refreshDone / refreshTotal) * 100))) : refreshing ? 3 : 0;
  const showRefreshProgress = Boolean(refreshStatus?.running || refreshStatus?.phase === "error");
  const pageCount = Math.max(1, Math.ceil(filteredCollections.length / perPage));
  const safePage = Math.min(page, pageCount - 1);
  const pagedCollections = useMemo(
    () => filteredCollections.slice(safePage * perPage, safePage * perPage + perPage),
    [filteredCollections, perPage, safePage]
  );
  const pageStart = pagedCollections.length ? safePage * perPage + 1 : 0;
  const pageEnd = safePage * perPage + pagedCollections.length;

  useEffect(() => {
    void loadCollections();
    void loadRefreshStatus();
  }, []);

  useEffect(() => {
    setPage(0);
  }, [filter, mode, perPage, query, sort]);

  useEffect(() => {
    if (collapseInitialized || !allCollections.length) return;
    setCollapsedIds(new Set(allCollections.map((collection) => collection.id)));
    setCollapseInitialized(true);
  }, [allCollections, collapseInitialized]);

  useEffect(() => {
    writeCollectionPrefs({
      mode,
      query,
      sort,
      filter,
      perPage,
      collapsedIds: [...collapsedIds]
    });
  }, [collapsedIds, filter, mode, perPage, query, sort]);

  useEffect(() => {
    if (!refreshStatus?.running) return;
    const timer = window.setInterval(() => {
      void loadRefreshStatus(true);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [refreshStatus?.running]);

  // Reveal and scroll to a collection requested from the movie detail modal. Each render
  // performs the next normalization step (mode → query → filter → expand → page) toward
  // making the target visible, then scrolls to it and clears the request.
  useEffect(() => {
    if (focusCollectionId == null) return;
    if (!allCollections.length) return; // wait until collections have loaded

    const inContinue = continueCollections.some((collection) => collection.id === focusCollectionId);
    const inDiscover = discoverCollections.some((collection) => collection.id === focusCollectionId);
    if (!inContinue && !inDiscover) {
      onFocusHandled?.();
      return;
    }

    const targetMode: CollectionMode =
      (mode === "continue" && inContinue) || (mode === "discover" && inDiscover)
        ? mode
        : inContinue
          ? "continue"
          : "discover";
    if (mode !== targetMode) {
      setMode(targetMode);
      return;
    }
    if (query) {
      setQuery("");
      return;
    }
    if (filter !== "all") {
      setFilter("all");
      return;
    }
    if (collapsedIds.has(focusCollectionId)) {
      setCollapsedIds((current) => {
        const next = new Set(current);
        next.delete(focusCollectionId);
        return next;
      });
      return;
    }

    const index = filteredCollections.findIndex((collection) => collection.id === focusCollectionId);
    if (index >= 0) {
      const targetPage = Math.floor(index / perPage);
      if (safePage !== targetPage) {
        setPage(targetPage);
        return;
      }
    }

    const handle = window.requestAnimationFrame(() => {
      document.getElementById(`collection-card-${focusCollectionId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    onFocusHandled?.();
    return () => window.cancelAnimationFrame(handle);
  }, [
    focusCollectionId,
    allCollections,
    continueCollections,
    discoverCollections,
    mode,
    query,
    filter,
    collapsedIds,
    filteredCollections,
    perPage,
    safePage,
    onFocusHandled
  ]);

  async function loadCollections() {
    setLoading(true);
    setMessage("");
    try {
      const [continueResponse, discoverResponse] = await Promise.all([api.collections(), api.discoverCollections()]);
      setContinueCollections(continueResponse.collections);
      setDiscoverCollections(discoverResponse.collections);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load collections.");
    } finally {
      setLoading(false);
    }
  }

  async function loadRefreshStatus(reloadWhenDone = false) {
    try {
      const status = await api.collectionsRefreshStatus();
      setRefreshStatus(status);
      if (reloadWhenDone && !status.running && status.phase === "complete") {
        await loadCollections();
        setMessage(status.message);
      } else if (status.phase === "error") {
        setMessage(status.message);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load collection refresh status.");
    }
  }

  async function refreshCollections() {
    setMessage("");
    try {
      const status = await api.refreshCollections();
      setRefreshStatus(status);
      setMessage(status.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not refresh collections.");
    }
  }

  function toggleCollection(collectionId: number) {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(collectionId)) {
        next.delete(collectionId);
      } else {
        next.add(collectionId);
      }
      return next;
    });
  }

  function expandAll() {
    const ids = new Set(filteredCollections.map((collection) => collection.id));
    setCollapsedIds((current) => new Set([...current].filter((id) => !ids.has(id))));
  }

  function collapseAll() {
    setCollapsedIds((current) => new Set([...current, ...filteredCollections.map((collection) => collection.id)]));
  }

  return (
    <section className="panel collections-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Collections</p>
          <h2>{mode === "continue" ? "Continue franchises" : "Discover franchises"}</h2>
          <p className="muted-line">
            {mode === "continue"
              ? `Partially complete TMDb collections from movies already in ${serverName}, ranked closest-to-complete first.`
              : "Curated famous TMDb collections, shown even when you own none of the movies."}
          </p>
        </div>
        <button className="primary-button" onClick={refreshCollections} disabled={refreshing}>
          <RefreshCw size={17} className={refreshing ? "spin" : ""} />
          {refreshing ? "Refreshing" : "Refresh collections"}
        </button>
      </div>

      <div className="collection-toolbar">
        <div className="segmented-control" aria-label="Collection mode">
          <button className={mode === "continue" ? "selected" : ""} onClick={() => setMode("continue")}>
            Continue
            <span>{continueCollections.length}</span>
          </button>
          <button className={mode === "discover" ? "selected" : ""} onClick={() => setMode("discover")}>
            Discover
            <span>{discoverCollections.length}</span>
          </button>
        </div>
        <div className="view-tools">
          <div className="segmented-control" aria-label="Collection movie view mode">
            <button className={viewMode === "poster" ? "selected" : ""} onClick={() => onViewModeChange("poster")} title="Poster view">
              <Grid2X2 size={16} />
              Posters
            </button>
            <button className={viewMode === "list" ? "selected" : ""} onClick={() => onViewModeChange("list")} title="List view">
              <List size={16} />
              List
            </button>
          </div>
          <label className="range-control">
            Poster size
            <input
              type="range"
              min="150"
              max="300"
              step="1"
              value={posterSize}
              onChange={(event) => onPosterSizeChange(Number(event.target.value))}
              onInput={(event) => onPosterSizeChange(Number((event.target as HTMLInputElement).value))}
              disabled={viewMode === "list"}
            />
          </label>
        </div>
      </div>

      <div className="collection-filterbar">
        <label className="collection-search">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search collections or movies"
          />
        </label>
        <label>
          Filter
          <select value={filter} onChange={(event) => setFilter(event.target.value as CollectionFilter)}>
            <option value="all">All</option>
            <option value="missing">Has missing</option>
            <option value="complete">Complete</option>
            <option value="not-started">Not started</option>
          </select>
        </label>
        <label>
          Sort
          <select value={sort} onChange={(event) => setSort(event.target.value as CollectionSort)}>
            <option value="closest">Closest</option>
            <option value="missing">Most missing</option>
            <option value="owned">Most owned</option>
            <option value="alpha">A-Z</option>
          </select>
        </label>
        <div className="collection-actions">
          <button className="secondary-button" onClick={expandAll} disabled={!filteredCollections.length}>
            <ChevronsDown size={17} />
            Expand all
          </button>
          <button className="secondary-button" onClick={collapseAll} disabled={!filteredCollections.length}>
            <ChevronsUp size={17} />
            Collapse all
          </button>
        </div>
      </div>

      <p className="muted-line collection-summary-line">
        Showing {filteredCollections.length.toLocaleString()} of {collections.length.toLocaleString()} collections ·{" "}
        {missingMovieTotal.toLocaleString()} missing movie{missingMovieTotal === 1 ? "" : "s"} in this view
      </p>

      {message ? <p className="status-line">{message}</p> : null}
      {loading ? <p className="status-line">Loading collections...</p> : null}
      {showRefreshProgress && refreshStatus ? (
        <div className="refresh-progress" role="status" aria-live="polite">
          <div className="refresh-progress-head">
            <span>{refreshLabel(refreshStatus)}</span>
            <strong>{refreshPercent}%</strong>
          </div>
          <div className="refresh-progress-track" aria-label={`Collection refresh ${refreshPercent}% complete`}>
            <span style={{ width: `${refreshPercent}%` }} />
          </div>
          <p>
            {refreshStatus.message}
            {refreshStatus.skippedItems ? ` ${refreshStatus.skippedItems.toLocaleString()} item${refreshStatus.skippedItems === 1 ? "" : "s"} skipped.` : ""}
          </p>
        </div>
      ) : null}

      {!loading && !filteredCollections.length ? (
        <div className="empty-state">
          <Search size={34} />
          <h3>{collections.length ? "No collections match" : mode === "continue" ? "No partial collections yet" : "No discover collections cached yet"}</h3>
          <p>
            {collections.length
                ? "Try a different search, filter, or sort."
                : mode === "continue"
                ? `Run a ${serverName} scan, then refresh collections to find franchises you have started but have not finished.`
                : "Refresh collections once to fetch the curated franchise seed list from TMDb."}
          </p>
        </div>
      ) : null}

      <CollectionPager
        total={filteredCollections.length}
        pageStart={pageStart}
        pageEnd={pageEnd}
        page={safePage}
        pageCount={pageCount}
        perPage={perPage}
        onPerPage={setPerPage}
        onPage={setPage}
      />

      <div className="collection-stack">
        {pagedCollections.map((collection) => {
          const collapsed = collapsedIds.has(collection.id);
          return (
          <article
            className={collapsed ? "collection-card collapsed" : "collection-card"}
            key={collection.id}
            id={`collection-card-${collection.id}`}
          >
            <div className="collection-heading">
              <button
                className="collection-toggle-button"
                onClick={() => toggleCollection(collection.id)}
                aria-expanded={!collapsed}
              >
                {collapsed ? <ChevronRight size={19} /> : <ChevronDown size={19} />}
                <span>
                  {collection.logoPath ? (
                    <img className="collection-logo" src={collection.logoPath} alt={collection.name} />
                  ) : (
                    <strong>{collection.name}</strong>
                  )}
                  <small>
                    {collection.ownedCount} of {collection.totalCount} in {serverName} · {collection.missingCount} missing
                  </small>
                </span>
              </button>
              <div className="collection-progress" aria-label={`${collection.ownedCount} of ${collection.totalCount} owned`}>
                <span style={{ width: `${Math.round((collection.ownedCount / Math.max(1, collection.totalCount)) * 100)}%` }} />
              </div>
            </div>
            {!collapsed ? (
              <MovieGrid
                movies={collection.movies}
                viewMode={viewMode}
                posterSize={posterSize}
                onSearchNzb={onSearchNzb}
                onShowDetails={onShowDetails}
                serverName={serverName}
                emptyTitle="No usable collection movies"
                emptyDescription="Unreleased entries and movies without runtime are hidden from collection counts."
              />
            ) : null}
          </article>
        );
        })}
      </div>

      <CollectionPager
        total={filteredCollections.length}
        pageStart={pageStart}
        pageEnd={pageEnd}
        page={safePage}
        pageCount={pageCount}
        perPage={perPage}
        onPerPage={setPerPage}
        onPage={setPage}
        compact
      />
    </section>
  );
}

function filterAndSortCollections(
  collections: MovieCollectionSummary[],
  query: string,
  filter: CollectionFilter,
  sort: CollectionSort
) {
  const normalizedQuery = query.trim().toLowerCase();
  return [...collections]
    .filter((collection) => {
      if (filter === "missing" && collection.missingCount === 0) return false;
      if (filter === "complete" && collection.missingCount !== 0) return false;
      if (filter === "not-started" && collection.ownedCount !== 0) return false;
      if (!normalizedQuery) return true;
      return (
        collection.name.toLowerCase().includes(normalizedQuery) ||
        collection.movies.some((movie) => movie.title.toLowerCase().includes(normalizedQuery))
      );
    })
    .sort((a, b) => {
      if (sort === "alpha") return a.name.localeCompare(b.name);
      if (sort === "missing") return b.missingCount - a.missingCount || a.name.localeCompare(b.name);
      if (sort === "owned") return b.ownedCount - a.ownedCount || a.name.localeCompare(b.name);
      const aRatio = a.ownedCount / Math.max(1, a.totalCount);
      const bRatio = b.ownedCount / Math.max(1, b.totalCount);
      return bRatio - aRatio || a.missingCount - b.missingCount || a.name.localeCompare(b.name);
    });
}

function readCollectionPrefs(): CollectionPrefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(COLLECTION_PREFS_KEY);
    return raw ? (JSON.parse(raw) as CollectionPrefs) : {};
  } catch {
    return {};
  }
}

function writeCollectionPrefs(prefs: CollectionPrefs) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLLECTION_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore private browsing/storage quota issues; preferences are nice-to-have.
  }
}

function CollectionPager({
  total,
  pageStart,
  pageEnd,
  page,
  pageCount,
  perPage,
  compact = false,
  onPerPage,
  onPage
}: {
  total: number;
  pageStart: number;
  pageEnd: number;
  page: number;
  pageCount: number;
  perPage: number;
  compact?: boolean;
  onPerPage: (value: number) => void;
  onPage: (value: number) => void;
}) {
  if (!total) return null;

  return (
    <div className={compact ? "result-controls collection-pager compact" : "result-controls collection-pager"}>
      <span>
        Showing collections {pageStart}-{pageEnd} of {total}
      </span>
      <div className="result-control-fields">
        <label>
          Collections
          <select value={perPage} onChange={(event) => onPerPage(Number(event.target.value))}>
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
        </label>
      </div>
      <div className="result-page-actions">
        <button className="secondary-button" onClick={() => onPage(Math.max(0, page - 1))} disabled={page === 0}>
          Previous
        </button>
        <span>
          Page {page + 1} of {pageCount}
        </span>
        <button className="secondary-button" onClick={() => onPage(Math.min(pageCount - 1, page + 1))} disabled={page >= pageCount - 1}>
          Next
        </button>
      </div>
    </div>
  );
}

function refreshLabel(status: CollectionsRefreshStatus) {
  if (status.phase === "mapping") {
    return `Checking movies ${status.checkedMovies.toLocaleString()} / ${status.totalMovies.toLocaleString()}`;
  }
  if (status.phase === "collections") {
    return `Fetching collections ${status.fetchedCollections.toLocaleString()} / ${status.totalCollections.toLocaleString()}`;
  }
  if (status.phase === "complete") return "Refresh complete";
  if (status.phase === "error") return "Refresh failed";
  return "Collection refresh";
}
