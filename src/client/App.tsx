import { Activity, Database, Film, Grid2X2, List, Menu, Moon, RefreshCw, Search, Settings, Sun, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { THEME_MODES, mediaServerLabel, themeLabel } from "../shared/types";
import type { AppMeta, AppSettings, MediaServerLibrary, MovieCollectionSummary, MovieDetails, MovieResult, SearchResponse, SearchSuggestion, ThemeMode } from "../shared/types";
import { DownloadStatusBar } from "./components/DownloadStatusBar";
import { DownloadMonitor } from "./components/DownloadMonitor";
import { MovieGrid } from "./components/MovieGrid";
import { CollectionsView } from "./components/CollectionsView";
import { MovieDetailsModal } from "./components/MovieDetailsModal";
import { NzbDrawer } from "./components/NzbDrawer";
import { SettingsPanel } from "./components/SettingsPanel";
import { api } from "./lib/api";

const EMPTY_SETTINGS: AppSettings = {
  mediaServerType: "plex",
  plexBaseUrl: "",
  plexToken: "",
  jellyfinBaseUrl: "",
  jellyfinApiKey: "",
  jellyfinUserId: "",
  embyBaseUrl: "",
  embyApiKey: "",
  embyUserId: "",
  plexMachineId: "",
  jellyfinServerId: "",
  embyServerId: "",
  tmdbApiKey: "",
  fanartApiKey: "",
  nzbHydraBaseUrl: "",
  nzbHydraApiKey: "",
  defaultQualities: ["1080p"],
  defaultSources: ["BluRay", "WEB-DL"],
  downloaderType: "none",
  downloaderBaseUrl: "",
  downloaderApiKey: "",
  downloaderDefaultCategory: "movies",
  loggingEnabled: true,
  logPath: "",
  themeMode: "light",
  refreshOnStart: false
};

type SearchType = "person" | "movie" | "studio";
type MovieSort = "list" | "year" | "title" | "owned" | "missing";

const CLIENT_META: AppMeta = {
  version: __APP_VERSION__,
  commit: __APP_COMMIT__ || null,
  dirty: __APP_DIRTY__,
  builtAt: __APP_BUILT_AT__ || null
};

function nextThemeMode(current: ThemeMode): ThemeMode {
  const currentIndex = THEME_MODES.indexOf(current);
  return THEME_MODES[(currentIndex + 1) % THEME_MODES.length] ?? "light";
}

const THEME_LOGOS: Record<ThemeMode, string> = {
  light: "/logo-main.png",
  dark: "/logo-main.png",
  plex: "/logo-plex.png",
  emby: "/logo-emby.png",
  jellyfin: "/logo-jellyfin.png"
};

function themeLogo(theme: ThemeMode): string {
  return THEME_LOGOS[theme] ?? "/logo-main.png";
}

function initialPosterSize() {
  if (typeof window === "undefined") return 210;
  return window.innerWidth <= 700 ? 150 : 210;
}

export function App() {
  const [settings, setSettings] = useState<AppSettings>(EMPTY_SETTINGS);
  const [apiMeta, setApiMeta] = useState<AppMeta | null>(null);
  const [activeView, setActiveView] = useState<"search" | "collections">("search");
  const [stats, setStats] = useState<{ movieCount: number; lastScannedAt: string | null }>({ movieCount: 0, lastScannedAt: null });
  const [query, setQuery] = useState("");
  const [type, setType] = useState<SearchType>("person");
  const [searchResponse, setSearchResponse] = useState<SearchResponse>({ query: "", results: [] });
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedMovie, setSelectedMovie] = useState<MovieResult | null>(null);
  const [detailMovie, setDetailMovie] = useState<MovieResult | null>(null);
  const [movieDetails, setMovieDetails] = useState<MovieDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [collections, setCollections] = useState<MovieCollectionSummary[]>([]);
  const [focusCollectionId, setFocusCollectionId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [trackerOpen, setTrackerOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [libraries, setLibraries] = useState<MediaServerLibrary[]>([]);
  const [selectedLibraryKeys, setSelectedLibraryKeys] = useState<string[]>([]);
  const [librariesLoading, setLibrariesLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"poster" | "list">("poster");
  const [posterSize, setPosterSize] = useState(initialPosterSize);
  const [moviePage, setMoviePage] = useState(0);
  const [moviesPerPage, setMoviesPerPage] = useState(25);
  const [movieSort, setMovieSort] = useState<MovieSort>("year");
  const [movieSortDirection, setMovieSortDirection] = useState<"asc" | "desc">("asc");
  const [scanError, setScanError] = useState("");
  const searchAreaRef = useRef<HTMLDivElement | null>(null);
  const suggestionsRef = useRef<HTMLDivElement | null>(null);

  const missingCount = useMemo(() => searchResponse.results.filter((movie) => !movie.owned).length, [searchResponse.results]);
  const ownedCount = searchResponse.results.length - missingCount;
  const hasSearchRun = searchResponse.query.trim().length > 0;
  const activeServerName = mediaServerLabel(settings.mediaServerType);
  const detailCollection = useMemo(() => {
    if (!detailMovie) return null;
    return collections.find((collection) => collection.movies.some((movie) => movie.tmdbId === detailMovie.tmdbId)) ?? null;
  }, [collections, detailMovie]);
  const sortedMovies = useMemo(() => {
    const direction = movieSortDirection === "asc" ? 1 : -1;
    return [...searchResponse.results].sort((a, b) => {
      if (movieSort === "title") return a.title.localeCompare(b.title) * direction;
      if (movieSort === "owned") return (Number(!a.owned) - Number(!b.owned)) * direction;
      if (movieSort === "missing") return (Number(a.owned) - Number(b.owned)) * direction;
      if (movieSort === "list") return ((a.listRank ?? 9999) - (b.listRank ?? 9999)) * direction;
      return ((a.year ?? 9999) - (b.year ?? 9999)) * direction;
    });
  }, [movieSort, movieSortDirection, searchResponse.results]);
  const moviePageCount = Math.max(1, Math.ceil(sortedMovies.length / moviesPerPage));
  const safeMoviePage = Math.min(moviePage, moviePageCount - 1);
  const pagedMovies = sortedMovies.slice(safeMoviePage * moviesPerPage, safeMoviePage * moviesPerPage + moviesPerPage);
  const moviePageStart = pagedMovies.length ? safeMoviePage * moviesPerPage + 1 : 0;
  const moviePageEnd = safeMoviePage * moviesPerPage + pagedMovies.length;

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.themeMode;
  }, [settings.themeMode]);

  useEffect(() => {
    setMoviePage(0);
  }, [moviesPerPage, movieSort, movieSortDirection, searchResponse.results]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!suggestionsOpen || trimmed.length < 2 || !settings.tmdbApiKey) {
      setSuggestions([]);
      setSuggestionsLoading(false);
      return;
    }

    let cancelled = false;
    setSuggestionsLoading(true);
    const handle = window.setTimeout(() => {
      void api
        .suggest(trimmed, type)
        .then((response) => {
          if (!cancelled) setSuggestions(response.suggestions);
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        })
        .finally(() => {
          if (!cancelled) setSuggestionsLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, settings.tmdbApiKey, suggestionsOpen, type]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (suggestionsRef.current?.contains(target)) return;

      const targetIsEditable = event.target instanceof Element && Boolean(event.target.closest("input, select"));
      if (!searchAreaRef.current?.contains(target) || !targetIsEditable) {
        setSuggestionsOpen(false);
        setSuggestions([]);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  async function bootstrap() {
    void api.meta().then(setApiMeta).catch(() => setApiMeta(null));
    void loadCollections();
    try {
      const [loadedSettings, loadedStats] = await Promise.all([api.settings(), api.stats()]);
      setSettings(loadedSettings);
      setStats(loadedStats);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load app state.");
    }
  }

  async function loadCollections() {
    try {
      const [continueResponse, discoverResponse] = await Promise.all([api.collections(), api.discoverCollections()]);
      const byId = new Map<number, MovieCollectionSummary>();
      for (const collection of [...continueResponse.collections, ...discoverResponse.collections]) {
        byId.set(collection.id, collection);
      }
      setCollections([...byId.values()]);
    } catch {
      // Collection context is a nice-to-have; the modal degrades to no "Part of" line.
      setCollections([]);
    }
  }

  async function handleSettingsSaved(saved: AppSettings) {
    const serverChanged = saved.mediaServerType !== settings.mediaServerType;
    const previousSearch = searchResponse.query.trim();
    const previousType = type;
    setSettings(saved);
    if (!serverChanged) return;

    const nextServerName = mediaServerLabel(saved.mediaServerType);
    setStats({ movieCount: 0, lastScannedAt: null });
    setSearchResponse({ query: "", results: [] });
    setSuggestions([]);
    setSuggestionsOpen(false);
    setSelectedMovie(null);
    setDetailMovie(null);
    setMovieDetails(null);
    setDetailsError("");
    setMoviePage(0);
    setLibraries([]);
    setSelectedLibraryKeys([]);
    setScanError("");
    setCollections([]);
    setFocusCollectionId(null);
    setMessage(`Switched to ${nextServerName}. Loading saved ${nextServerName} scan data...`);

    try {
      const loadedStats = await api.stats();
      setStats(loadedStats);
      void loadCollections();
      if (loadedStats.movieCount > 0) {
        setMessage(`Switched to ${nextServerName}. Loaded ${loadedStats.movieCount.toLocaleString()} saved ${nextServerName} movies.`);
        if (previousSearch) {
          setLoading(true);
          const response = await api.search(previousSearch, previousType);
          setSearchResponse(response);
          setQuery(previousSearch);
          setType(previousType);
        }
      } else {
        setQuery("");
        setMessage(`Switched to ${nextServerName}. Scan your ${nextServerName} movie library to begin.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Could not load saved ${nextServerName} scan data.`);
      setStats({ movieCount: 0, lastScannedAt: null });
    } finally {
      setLoading(false);
    }
  }

  async function openScanPicker() {
    setScanOpen(true);
    setLibrariesLoading(true);
    setLibraries([]);
    setScanError("");
    setMessage("");
    try {
      const response = await api.mediaLibraries();
      setLibraries(response.libraries);
      setSelectedLibraryKeys(response.libraries.map((library) => library.key));
    } catch (error) {
      setScanError(error instanceof Error ? error.message : `Could not load ${activeServerName} libraries.`);
    } finally {
      setLibrariesLoading(false);
    }
  }

  async function scan(sectionKeys = selectedLibraryKeys) {
    if (!sectionKeys.length) {
      setMessage(`Choose at least one ${activeServerName} movie library to scan.`);
      return;
    }
    setScanning(true);
    setMessage("");
    try {
      const response = await api.scanMediaServer(sectionKeys);
      const loadedStats = await api.stats();
      setStats(loadedStats);
      // Pick up the serverId/machineId the scan just persisted so the modal can deep-link.
      void api.settings().then(setSettings).catch(() => undefined);
      setMessage(`Imported ${response.imported} movies from ${response.sections.join(", ") || activeServerName}.`);
      setScanOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${activeServerName} scan failed.`);
    } finally {
      setScanning(false);
    }
  }

  async function runSearch(searchQuery: string, searchType: SearchType) {
    if (!searchQuery.trim()) return;
    setQuery(searchQuery);
    setType(searchType);
    setSuggestionsOpen(false);
    setSuggestions([]);
    setLoading(true);
    setMessage("");
    try {
      const response = await api.search(searchQuery.trim(), searchType);
      setSearchResponse(response);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Search failed.");
    } finally {
      setLoading(false);
    }
  }

  async function search(event?: React.FormEvent) {
    event?.preventDefault();
    await runSearch(query, type);
  }

  function closeMobileNav() {
    setMobileNavOpen(false);
  }

  async function toggleTheme() {
    const nextTheme = nextThemeMode(settings.themeMode);
    const nextSettings: AppSettings = {
      ...settings,
      themeMode: nextTheme
    };
    setSettings(nextSettings);
    try {
      const saved = await api.saveSettings(nextSettings);
      setSettings(saved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save theme.");
    }
  }

  async function openMovieDetails(movie: MovieResult) {
    setDetailMovie(movie);
    setMovieDetails(null);
    setDetailsError("");
    setDetailsLoading(true);
    try {
      const details = await api.movieDetails(movie.tmdbId);
      setMovieDetails(details);
    } catch (error) {
      setDetailsError(error instanceof Error ? error.message : "Could not load movie details.");
    } finally {
      setDetailsLoading(false);
    }
  }

  function openNzbSearch(movie: MovieResult) {
    setSelectedMovie(movie);
  }

  function closeMovieDetails() {
    setDetailMovie(null);
    setMovieDetails(null);
    setDetailsError("");
  }

  function searchPersonFromDetails(name: string) {
    closeMovieDetails();
    setActiveView("search");
    void runSearch(name, "person");
  }

  function openCollectionFromDetails(collectionId: number) {
    closeMovieDetails();
    setActiveView("collections");
    setFocusCollectionId(collectionId);
  }

  return (
    <main>
      <section className="app-top">
        <nav>
          <div className="brand-mark">
            <img className="brand-logo" src={themeLogo(settings.themeMode)} alt="" />
            <span>MediaGap</span>
          </div>
          <button
            className="ghost-button mobile-menu-button"
            onClick={() => setMobileNavOpen((current) => !current)}
            aria-expanded={mobileNavOpen}
            aria-controls="main-nav-actions"
          >
            <Menu size={18} />
            Menu
          </button>
          <div className={mobileNavOpen ? "nav-actions open" : "nav-actions"} id="main-nav-actions">
            <button
              className={activeView === "search" ? "ghost-button selected" : "ghost-button"}
              onClick={() => {
                setActiveView("search");
                closeMobileNav();
              }}
            >
              <Search size={17} />
              Search
            </button>
            <button
              className={activeView === "collections" ? "ghost-button selected" : "ghost-button"}
              onClick={() => {
                setActiveView("collections");
                closeMobileNav();
              }}
            >
              <Grid2X2 size={17} />
              Collections
            </button>
            <button
              className="ghost-button"
              onClick={() => {
                closeMobileNav();
                void toggleTheme();
              }}
              title="Cycle theme"
            >
              {settings.themeMode === "light" ? <Moon size={17} /> : settings.themeMode === "dark" ? <Film size={17} /> : <Sun size={17} />}
              {themeLabel(nextThemeMode(settings.themeMode))}
            </button>
            <button
              className="ghost-button"
              onClick={() => {
                closeMobileNav();
                setTrackerOpen(true);
              }}
            >
              <Activity size={17} />
              Tracker
            </button>
            <button
              className="ghost-button"
              onClick={() => {
                closeMobileNav();
                setSettingsOpen(true);
              }}
            >
              <Settings size={17} />
              Settings
            </button>
            <button
              className="ghost-button"
              onClick={() => {
                closeMobileNav();
                void openScanPicker();
              }}
              disabled={scanning}
            >
              <RefreshCw size={17} className={scanning ? "spin" : ""} />
              {scanning ? "Scanning" : `Scan ${activeServerName}`}
            </button>
          </div>
        </nav>

        <section className="stats-panel" aria-label="Library stats">
          <div className={hasSearchRun ? "stats-strip" : "stats-strip stats-strip-single"}>
            <Stat label={`${activeServerName} movies`} value={stats.movieCount.toLocaleString()} />
            {hasSearchRun ? (
              <>
                <Stat label="Owned in results" value={ownedCount.toLocaleString()} />
                <Stat label="Missing in results" value={missingCount.toLocaleString()} />
              </>
            ) : null}
            <div className="last-scan">
              <Database size={18} />
              {stats.lastScannedAt ? `Last scan ${new Date(stats.lastScannedAt).toLocaleString()}` : "No library scan yet"}
            </div>
          </div>
        </section>
      </section>

      <div className="workspace">
        {activeView === "search" ? (
          <section className="panel search-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Discovery</p>
              <h2>Search and compare</h2>
            </div>
            <div className="view-tools">
              <div className="segmented-control" aria-label="Result view mode">
                <button className={viewMode === "poster" ? "selected" : ""} onClick={() => setViewMode("poster")} title="Poster view">
                  <Grid2X2 size={16} />
                  Posters
                </button>
                <button className={viewMode === "list" ? "selected" : ""} onClick={() => setViewMode("list")} title="List view">
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
                  onChange={(event) => setPosterSize(Number(event.target.value))}
                  onInput={(event) => setPosterSize(Number((event.target as HTMLInputElement).value))}
                  disabled={viewMode === "list"}
                />
              </label>
            </div>
          </div>

          <div ref={searchAreaRef}>
            <form className="search-bar" onSubmit={search}>
              <select
                value={type}
                onChange={(event) => {
                  setType(event.target.value as SearchType);
                  setSuggestionsOpen(true);
                }}
              >
                <option value="person">Person</option>
                <option value="movie">Movie</option>
                <option value="studio">Studio</option>
              </select>
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSuggestionsOpen(true);
                }}
                onFocus={() => {
                  if (query.trim().length >= 2) setSuggestionsOpen(true);
                }}
                placeholder={searchPlaceholder(type, activeServerName)}
              />
              <button className="primary-button" disabled={loading}>
                <Search size={18} />
                {loading ? "Searching" : "Search"}
              </button>
            </form>

            {suggestionsOpen && (suggestions.length || suggestionsLoading) && query.trim().length >= 2 ? (
              <div className="suggestion-list" ref={suggestionsRef}>
                {suggestionsLoading ? <p className="muted-line">Looking up matches...</p> : null}
                {suggestions.map((suggestion) => (
                  <button
                    className="suggestion-row"
                    key={`${suggestion.type}-${suggestion.id}`}
                    onClick={() => void runSearch(suggestion.title, suggestion.type)}
                  >
                    <div className="suggestion-image">
                      {suggestion.imagePath ? <img src={suggestion.imagePath} alt="" /> : <Film size={22} />}
                    </div>
                    <div>
                      <strong>{suggestion.title}</strong>
                      {suggestion.subtitle ? <span>{suggestion.subtitle}</span> : null}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {message ? <p className="status-line">{message}</p> : null}

          <ResultControls
            total={sortedMovies.length}
            pageStart={moviePageStart}
            pageEnd={moviePageEnd}
            page={safeMoviePage}
            pageCount={moviePageCount}
            perPage={moviesPerPage}
            sort={movieSort}
            direction={movieSortDirection}
            onPerPage={setMoviesPerPage}
            onSort={setMovieSort}
            onDirection={setMovieSortDirection}
            onPage={setMoviePage}
          />

          <MovieGrid
            movies={pagedMovies}
            viewMode={viewMode}
            posterSize={posterSize}
            onSearchNzb={openNzbSearch}
            onShowDetails={(movie) => void openMovieDetails(movie)}
            serverName={activeServerName}
          />

          <ResultControls
            total={sortedMovies.length}
            pageStart={moviePageStart}
            pageEnd={moviePageEnd}
            page={safeMoviePage}
            pageCount={moviePageCount}
            perPage={moviesPerPage}
            sort={movieSort}
            direction={movieSortDirection}
            onPerPage={setMoviesPerPage}
            onSort={setMovieSort}
            onDirection={setMovieSortDirection}
            onPage={setMoviePage}
            compact
          />
          </section>
        ) : (
          <CollectionsView
            key={settings.mediaServerType}
            viewMode={viewMode}
            posterSize={posterSize}
            onViewModeChange={setViewMode}
            onPosterSizeChange={setPosterSize}
            onSearchNzb={openNzbSearch}
            onShowDetails={(movie) => void openMovieDetails(movie)}
            serverName={activeServerName}
            focusCollectionId={focusCollectionId}
            onFocusHandled={() => setFocusCollectionId(null)}
          />
        )}

      </div>

      {settingsOpen ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Settings"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <div className="modal large-modal">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">App menu</p>
                <h2>Settings</h2>
              </div>
              <button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Close settings">
                <X size={20} />
              </button>
            </div>
            <SettingsPanel settings={settings} onSaved={(saved) => void handleSettingsSaved(saved)} />
          </div>
        </div>
      ) : null}

      {scanOpen ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={`Choose ${activeServerName} libraries`}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setScanOpen(false);
          }}
        >
          <div className="modal">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">{activeServerName} scan</p>
                <h2>Choose libraries</h2>
              </div>
              <button className="icon-button" onClick={() => setScanOpen(false)} aria-label="Close library picker">
                <X size={20} />
              </button>
            </div>
            {librariesLoading ? <p className="status-line">Loading {activeServerName} libraries...</p> : null}
            {scanError ? <p className="error-line">{scanError}</p> : null}
            {!librariesLoading && !scanError && !libraries.length ? (
              <p className="muted-line">No {activeServerName} movie libraries were found. Check your media server settings, then try again.</p>
            ) : null}
            <div className="library-list">
              {libraries.map((library) => (
                <label className="check-row" key={library.key}>
                  <input
                    type="checkbox"
                    checked={selectedLibraryKeys.includes(library.key)}
                    onChange={(event) => {
                      setSelectedLibraryKeys((current) =>
                        event.target.checked ? [...current, library.key] : current.filter((key) => key !== library.key)
                      );
                    }}
                  />
                  <span>{library.title}</span>
                </label>
              ))}
            </div>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setSelectedLibraryKeys(libraries.map((library) => library.key))}>
                Select all
              </button>
              <button className="secondary-button" onClick={() => setSelectedLibraryKeys([])}>
                Clear
              </button>
              <button className="primary-button" onClick={() => scan()} disabled={scanning || librariesLoading}>
                <RefreshCw size={17} className={scanning ? "spin" : ""} />
                {scanning ? "Scanning" : "Scan selected"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {trackerOpen ? (
        <div
          className="drawer-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Downloader tracker"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setTrackerOpen(false);
          }}
        >
          <aside className="tracker-drawer">
            <div className="drawer-header">
              <div>
                <p className="eyebrow">Downloader</p>
                <h2>Tracker and history</h2>
              </div>
              <button className="icon-button" onClick={() => setTrackerOpen(false)} aria-label="Close tracker">
                <X size={20} />
              </button>
            </div>
            <DownloadMonitor enabled={settings.downloaderType !== "none" && Boolean(settings.downloaderBaseUrl)} showHeading={false} />
          </aside>
        </div>
      ) : null}

      <MovieDetailsModal
        movie={detailMovie}
        details={movieDetails}
        loading={detailsLoading}
        error={detailsError}
        collection={detailCollection}
        ownedUrl={buildOwnedDeepLink(settings, detailMovie)}
        onClose={closeMovieDetails}
        onSearchNzb={(movie) => {
          openNzbSearch(movie);
          setDetailMovie(null);
        }}
        onSearchPerson={searchPersonFromDetails}
        onOpenCollection={openCollectionFromDetails}
        serverName={activeServerName}
      />

      <NzbDrawer
        movie={selectedMovie}
        defaultQualities={settings.defaultQualities}
        defaultSources={settings.defaultSources}
        defaultCategory={settings.downloaderDefaultCategory}
        downloaderEnabled={settings.downloaderType !== "none"}
        onClose={() => setSelectedMovie(null)}
      />
      <footer className="app-footer" aria-label="App version">
        <span>Client {formatMeta(CLIENT_META)}</span>
        <span>{apiMeta ? `API ${formatMeta(apiMeta)}` : "API not detected"}</span>
      </footer>
      <DownloadStatusBar enabled={settings.downloaderType !== "none" && Boolean(settings.downloaderBaseUrl)} onOpenTracker={() => setTrackerOpen(true)} />
    </main>
  );
}

function formatMeta(meta: AppMeta) {
  const commit = meta.commit ? ` ${meta.commit}${meta.dirty ? "-dirty" : ""}` : "";
  return `v${meta.version}${commit}`;
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function serverWebRoot(baseUrl: string): string | null {
  const base = baseUrl.trim();
  if (!base) return null;
  return `${trimTrailingSlash(base)}/web/`;
}

function nativeItemId(ratingKey: string): string {
  // Jellyfin/Emby ratingKeys are stored prefixed (e.g. "jellyfin:abc"); Plex is already raw.
  return ratingKey.replace(/^(?:plex|jellyfin|emby):/, "");
}

// Build a deep-link that opens an owned movie in the active server's web UI. Returns null
// when no actionable link can be built (no ratingKey / no base URL), and degrades to the
// server web root when the deep-link id is required but missing (Emby / Plex).
function buildOwnedDeepLink(settings: AppSettings, movie: MovieResult | null): string | null {
  if (!movie || !movie.owned || !movie.plexRatingKey) return null;
  const itemId = nativeItemId(movie.plexRatingKey);
  if (!itemId) return null;

  if (settings.mediaServerType === "plex") {
    const baseUrl = settings.plexBaseUrl.trim();
    if (!baseUrl) return null;
    const machineId = settings.plexMachineId.trim();
    // Without the machineId we can't target the item; open the server web UI root instead.
    if (!machineId) return serverWebRoot(baseUrl);
    // Point at the user's own server (like Jellyfin/Emby), NOT app.plex.tv, which only
    // resolves when the browser is signed into a Plex account with access to that server.
    const key = encodeURIComponent(`/library/metadata/${itemId}`);
    return `${trimTrailingSlash(baseUrl)}/web/index.html#!/server/${encodeURIComponent(machineId)}/details?key=${key}`;
  }

  const isEmby = settings.mediaServerType === "emby";
  const baseUrl = (isEmby ? settings.embyBaseUrl : settings.jellyfinBaseUrl).trim();
  if (!baseUrl) return null;
  const host = trimTrailingSlash(baseUrl);
  const serverId = (isEmby ? settings.embyServerId : settings.jellyfinServerId).trim();
  const id = encodeURIComponent(itemId);

  if (isEmby) {
    // Emby deep-links don't resolve without serverId; fall back to the web UI root.
    if (!serverId) return serverWebRoot(baseUrl);
    return `${host}/web/index.html?#!/item?id=${id}&serverId=${encodeURIComponent(serverId)}`;
  }

  // Jellyfin resolves with or without serverId; include it when known.
  const query = serverId ? `id=${id}&serverId=${encodeURIComponent(serverId)}` : `id=${id}`;
  return `${host}/web/#/details?${query}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function searchPlaceholder(type: SearchType, serverName: string) {
  if (type === "studio") return `Search studios like A24 or Universal, then compare their movies with ${serverName}`;
  if (type === "movie") return "Search movie titles like Heat, Alien, or The Matrix";
  return `Search actors or directors, compare with ${serverName}, then find the gaps`;
}

function ResultControls({
  total,
  pageStart,
  pageEnd,
  page,
  pageCount,
  perPage,
  sort,
  direction,
  compact = false,
  onPerPage,
  onSort,
  onDirection,
  onPage
}: {
  total: number;
  pageStart: number;
  pageEnd: number;
  page: number;
  pageCount: number;
  perPage: number;
  sort: MovieSort;
  direction: "asc" | "desc";
  compact?: boolean;
  onPerPage: (value: number) => void;
  onSort: (value: MovieSort) => void;
  onDirection: (value: "asc" | "desc") => void;
  onPage: (value: number) => void;
}) {
  if (!total) return null;

  return (
    <div className={compact ? "result-controls compact" : "result-controls"}>
      <span>
        Showing {pageStart}-{pageEnd} of {total}
      </span>
      <div className="result-control-fields">
        <label>
          Movies
          <select value={perPage} onChange={(event) => onPerPage(Number(event.target.value))}>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
        <label>
          Sort
          <select value={sort} onChange={(event) => onSort(event.target.value as MovieSort)}>
            <option value="list">List order</option>
            <option value="year">Year</option>
            <option value="title">Title</option>
            <option value="owned">Owned</option>
            <option value="missing">Missing</option>
          </select>
        </label>
        <label>
          Order
          <select value={direction} onChange={(event) => onDirection(event.target.value as "asc" | "desc")}>
            <option value="asc">Asc</option>
            <option value="desc">Desc</option>
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
