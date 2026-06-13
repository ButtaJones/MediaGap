import { Router } from "express";
import { z } from "zod";
import {
  addHistoryEntry,
  deleteHistoryEntry,
  getLibraryStats,
  getSettings,
  listHistoryEntries,
  saveSettings,
  updateHistoryEntry,
  upsertPlexMovies
} from "../db.js";
import { controlDownloader, getDownloaderStatus, sendToDownloader, testDownloaderConnection } from "../integrations/downloader.js";
import { getMovieSections, scanPlexMovies, testPlexConnection } from "../integrations/plex.js";
import {
  getMovieDetails,
  searchImdbList,
  searchCompanyMovies,
  searchMovies,
  searchPersonCredits,
  searchSuggestions,
  testTmdbConnection
} from "../integrations/tmdb.js";
import { searchNzbHydra, testNzbHydraConnection } from "../integrations/nzbhydra.js";
import { appendLog, openLogFolder, readRecentLogs } from "../services/logger.js";
import { fetchManyNzbs, safeFilename } from "../services/nzb.js";
import { createZip } from "../services/zip.js";
import { DOWNLOADER_TYPES, QUALITY_FILTERS, SOURCE_FILTERS, THEME_MODES } from "../../shared/types.js";

export const api = Router();

const settingsSchema = z.object({
  plexBaseUrl: z.string(),
  plexToken: z.string(),
  tmdbApiKey: z.string(),
  nzbHydraBaseUrl: z.string(),
  nzbHydraApiKey: z.string(),
  defaultQualities: z.array(z.enum(QUALITY_FILTERS)).default(["1080p"]),
  defaultSources: z.array(z.enum(SOURCE_FILTERS)).default(["BluRay", "WEB-DL"]),
  downloaderType: z.enum(DOWNLOADER_TYPES).default("none"),
  downloaderBaseUrl: z.string().default(""),
  downloaderApiKey: z.string().default(""),
  downloaderDefaultCategory: z.string().default("movies"),
  loggingEnabled: z.boolean().default(true),
  logPath: z.string().default(""),
  themeMode: z.enum(THEME_MODES).default("light"),
  refreshOnStart: z.boolean().default(false)
});

const searchTypeSchema = z.enum(["person", "movie", "studio", "imdb"]);
const suggestionTypeSchema = z.enum(["person", "movie", "studio"]);

function requireSettings() {
  const settings = getSettings();
  if (!settings.tmdbApiKey) throw new Error("Add a TMDb API key in Settings first.");
  return settings;
}

api.get("/health", (_req, res) => {
  res.json({ ok: true });
});

api.get("/settings", (_req, res) => {
  res.json(getSettings());
});

api.put("/settings", (req, res) => {
  const parsed = settingsSchema.parse(req.body);
  const saved = saveSettings(parsed);
  appendLog(saved.logPath, saved.loggingEnabled, "info", "Settings saved");
  res.json(saved);
});

api.get("/stats", (_req, res) => {
  res.json(getLibraryStats());
});

api.post("/connections/:service/test", async (req, res, next) => {
  try {
    const settings = getSettings();
    const service = req.params.service;
    if (service === "plex") {
      if (!settings.plexBaseUrl || !settings.plexToken) throw new Error("Add Plex URL and token first.");
      const result = await testPlexConnection(settings.plexBaseUrl, settings.plexToken);
      appendLog(settings.logPath, settings.loggingEnabled, "info", "Plex connection test succeeded", { name: result.name });
      res.json({ ok: true, message: "Connected to Plex.", ...result });
      return;
    }
    if (service === "tmdb") {
      if (!settings.tmdbApiKey) throw new Error("Add a TMDb API key first.");
      const result = await testTmdbConnection(settings.tmdbApiKey);
      appendLog(settings.logPath, settings.loggingEnabled, "info", "TMDb connection test succeeded");
      res.json({ ok: true, message: "Connected to TMDb.", ...result });
      return;
    }
    if (service === "nzbhydra") {
      if (!settings.nzbHydraBaseUrl || !settings.nzbHydraApiKey) throw new Error("Add NZBHydra URL and API key first.");
      const result = await testNzbHydraConnection(settings.nzbHydraBaseUrl, settings.nzbHydraApiKey);
      appendLog(settings.logPath, settings.loggingEnabled, "info", "NZBHydra connection test succeeded");
      res.json({ ok: true, message: "Connected to NZBHydra.", ...result });
      return;
    }
    if (service === "downloader") {
      if (settings.downloaderType === "none") throw new Error("Choose SABnzbd or NZBGet first.");
      if (!settings.downloaderBaseUrl) throw new Error("Add a downloader URL first.");
      const result = await testDownloaderConnection(
        settings.downloaderType,
        settings.downloaderBaseUrl,
        settings.downloaderApiKey
      );
      appendLog(settings.logPath, settings.loggingEnabled, "info", "Downloader connection test succeeded", {
        type: settings.downloaderType,
        name: result.name
      });
      res.json({ ok: true, message: `Connected to ${result.name}.`, ...result });
      return;
    }
    res.status(404).json({ ok: false, message: "Unknown service." });
  } catch (error) {
    const settings = getSettings();
    appendLog(settings.logPath, settings.loggingEnabled, "error", "Connection test failed", {
      service: req.params.service,
      error: error instanceof Error ? error.message : String(error)
    });
    next(error);
  }
});

api.get("/plex/libraries", async (_req, res, next) => {
  try {
    const settings = getSettings();
    if (!settings.plexBaseUrl || !settings.plexToken) throw new Error("Add Plex URL and token in Settings first.");
    const libraries = await getMovieSections(settings.plexBaseUrl, settings.plexToken);
    appendLog(settings.logPath, settings.loggingEnabled, "info", "Loaded Plex libraries", { count: libraries.length });
    res.json({ libraries });
  } catch (error) {
    const settings = getSettings();
    appendLog(settings.logPath, settings.loggingEnabled, "error", "Failed to load Plex libraries", {
      error: error instanceof Error ? error.message : String(error)
    });
    next(error);
  }
});

api.post("/plex/scan", async (req, res, next) => {
  try {
    const settings = getSettings();
    if (!settings.plexBaseUrl || !settings.plexToken) throw new Error("Add Plex URL and token in Settings first.");
    const body = z.object({ sectionKeys: z.array(z.string()).default([]) }).parse(req.body ?? {});
    const scan = await scanPlexMovies(settings.plexBaseUrl, settings.plexToken, body.sectionKeys);
    const imported = upsertPlexMovies(scan.movies);
    appendLog(settings.logPath, settings.loggingEnabled, "info", "Plex scan completed", {
      imported,
      sections: scan.sections
    });
    res.json({ imported, sections: scan.sections, scannedAt: new Date().toISOString() });
  } catch (error) {
    const settings = getSettings();
    appendLog(settings.logPath, settings.loggingEnabled, "error", "Plex scan failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    next(error);
  }
});

api.get("/search", async (req, res, next) => {
  try {
    const settings = requireSettings();
    const query = z.string().min(1).parse(req.query.q);
    const type = searchTypeSchema.parse(req.query.type ?? "person");

    const results =
      type === "person"
        ? await searchPersonCredits(settings.tmdbApiKey, query)
        : type === "imdb"
          ? await searchImdbList(settings.tmdbApiKey, query)
        : type === "studio"
          ? await searchCompanyMovies(settings.tmdbApiKey, query)
          : await searchMovies(settings.tmdbApiKey, query);

    res.json({ query, results });
  } catch (error) {
    next(error);
  }
});

api.get("/suggest", async (req, res, next) => {
  try {
    const settings = requireSettings();
    const query = z.string().min(2).parse(req.query.q);
    const type = suggestionTypeSchema.parse(req.query.type ?? "person");
    const suggestions = await searchSuggestions(settings.tmdbApiKey, query, type);
    res.json({ query, suggestions });
  } catch (error) {
    next(error);
  }
});

api.get("/movies/:tmdbId/details", async (req, res, next) => {
  try {
    const settings = requireSettings();
    const tmdbId = z.coerce.number().int().positive().parse(req.params.tmdbId);
    const details = await getMovieDetails(settings.tmdbApiKey, tmdbId);
    res.json(details);
  } catch (error) {
    next(error);
  }
});

api.post("/nzbhydra/search", async (req, res, next) => {
  try {
    const settings = getSettings();
    if (!settings.nzbHydraBaseUrl || !settings.nzbHydraApiKey) {
      throw new Error("Add NZBHydra URL and API key in Settings first.");
    }

    const body = z
      .object({
        title: z.string().min(1),
        year: z.number().nullable(),
        qualities: z.array(z.enum(QUALITY_FILTERS)).default(settings.defaultQualities),
        sources: z.array(z.enum(SOURCE_FILTERS)).default(settings.defaultSources),
        extraTerms: z.string().default(""),
        query: z.string().default(""),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0)
      })
      .parse(req.body);

    const search = await searchNzbHydra(
      settings.nzbHydraBaseUrl,
      settings.nzbHydraApiKey,
      body.title,
      body.year,
      body.qualities,
      body.sources,
      body.extraTerms,
      body.limit,
      body.offset,
      body.query
    );

    appendLog(settings.logPath, settings.loggingEnabled, "info", "NZBHydra search completed", {
      query: search.query,
      count: search.results.length,
      total: search.total
    });
    res.json(search);
  } catch (error) {
    const settings = getSettings();
    appendLog(settings.logPath, settings.loggingEnabled, "error", "NZBHydra search failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    next(error);
  }
});

api.post("/downloader/send", async (req, res, next) => {
  try {
    const settings = getSettings();
    if (settings.downloaderType === "none") throw new Error("Choose SABnzbd or NZBGet in Settings first.");
    if (!settings.downloaderBaseUrl) throw new Error("Add downloader settings first.");

    const body = z
      .object({
        link: z.string().url(),
        title: z.string().min(1),
        category: z.string().default(settings.downloaderDefaultCategory)
      })
      .parse(req.body);

    const result = await sendToDownloader(
      settings.downloaderType,
      settings.downloaderBaseUrl,
      settings.downloaderApiKey,
      body.link,
      body.title,
      body.category
    );
    addHistoryEntry({
      title: body.title,
      action: "sent",
      downloader: settings.downloaderType,
      category: body.category,
      status: "sent"
    });
    appendLog(settings.logPath, settings.loggingEnabled, "info", "Release sent to downloader", {
      type: settings.downloaderType,
      title: body.title,
      category: body.category
    });
    res.json(result);
  } catch (error) {
    const settings = getSettings();
    appendLog(settings.logPath, settings.loggingEnabled, "error", "Failed to send release to downloader", {
      error: error instanceof Error ? error.message : String(error)
    });
    next(error);
  }
});

api.post("/downloader/send-many", async (req, res, next) => {
  try {
    const settings = getSettings();
    if (settings.downloaderType === "none") throw new Error("Choose SABnzbd or NZBGet in Settings first.");
    if (!settings.downloaderBaseUrl) throw new Error("Add downloader settings first.");

    const body = z
      .object({
        releases: z.array(z.object({ link: z.string().url(), title: z.string().min(1) })).min(1),
        category: z.string().default(settings.downloaderDefaultCategory)
      })
      .parse(req.body);

    const errors: string[] = [];
    let sent = 0;
    for (const release of body.releases) {
      try {
        await sendToDownloader(
          settings.downloaderType,
          settings.downloaderBaseUrl,
          settings.downloaderApiKey,
          release.link,
          release.title,
          body.category
        );
        sent += 1;
        addHistoryEntry({
          title: release.title,
          action: "sent",
          downloader: settings.downloaderType,
          category: body.category,
          status: "sent"
        });
      } catch (error) {
        errors.push(`${release.title}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    appendLog(settings.logPath, settings.loggingEnabled, errors.length ? "warn" : "info", "Bulk downloader send completed", {
      type: settings.downloaderType,
      sent,
      failed: errors.length,
      category: body.category,
      errors
    });

    res.json({
      ok: errors.length === 0,
      sent,
      failed: errors.length,
      errors,
      message: errors.length ? `Sent ${sent}, failed ${errors.length}.` : `Sent ${sent} releases.`
    });
  } catch (error) {
    const settings = getSettings();
    appendLog(settings.logPath, settings.loggingEnabled, "error", "Bulk downloader send failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    next(error);
  }
});

api.post("/nzb/download-zip", async (req, res, next) => {
  try {
    const settings = getSettings();
    const body = z
      .object({
        movieTitle: z.string().default("selected-releases"),
        releases: z.array(z.object({ link: z.string().url(), title: z.string().min(1) })).min(1)
      })
      .parse(req.body);

    const files = await fetchManyNzbs(body.releases);
    const zip = createZip(files);
    const filename = `${safeFilename(body.movieTitle)}-nzbs.zip`;
    for (const release of body.releases) {
      addHistoryEntry({
        title: release.title,
        action: "downloaded",
        downloader: "zip",
        category: null,
        status: "downloaded",
        notes: filename
      });
    }
    appendLog(settings.logPath, settings.loggingEnabled, "info", "Created selected NZB zip", {
      filename,
      count: files.length
    });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(zip);
  } catch (error) {
    const settings = getSettings();
    appendLog(settings.logPath, settings.loggingEnabled, "error", "Failed to create selected NZB zip", {
      error: error instanceof Error ? error.message : String(error)
    });
    next(error);
  }
});

api.get("/downloader/status", async (_req, res, next) => {
  try {
    const settings = getSettings();
    if (settings.downloaderType === "none" || !settings.downloaderBaseUrl) {
      res.json({
        ok: false,
        type: settings.downloaderType,
        queue: [],
        history: [],
        message: "Set up SABnzbd or NZBGet in Settings to enable tracking."
      });
      return;
    }
    const status = await getDownloaderStatus(settings.downloaderType, settings.downloaderBaseUrl, settings.downloaderApiKey);
    res.json(status);
  } catch (error) {
    const settings = getSettings();
    appendLog(settings.logPath, settings.loggingEnabled, "error", "Downloader status failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    next(error);
  }
});

api.post("/downloader/control/:action", async (req, res, next) => {
  try {
    const settings = getSettings();
    if (settings.downloaderType === "none") throw new Error("Choose SABnzbd or NZBGet in Settings first.");
    if (!settings.downloaderBaseUrl) throw new Error("Add downloader settings first.");
    const action = z.enum(["pause", "resume"]).parse(req.params.action);
    const result = await controlDownloader(settings.downloaderType, settings.downloaderBaseUrl, settings.downloaderApiKey, action);
    appendLog(settings.logPath, settings.loggingEnabled, "info", "Downloader control sent", {
      type: settings.downloaderType,
      action
    });
    res.json(result);
  } catch (error) {
    const settings = getSettings();
    appendLog(settings.logPath, settings.loggingEnabled, "error", "Downloader control failed", {
      action: req.params.action,
      error: error instanceof Error ? error.message : String(error)
    });
    next(error);
  }
});

api.get("/history", (_req, res, next) => {
  try {
    res.json({ entries: listHistoryEntries() });
  } catch (error) {
    next(error);
  }
});

api.put("/history/:id", (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const body = z.object({ status: z.string(), notes: z.string() }).parse(req.body);
    const entry = updateHistoryEntry(id, body);
    if (!entry) {
      res.status(404).json({ ok: false, message: "History entry not found." });
      return;
    }
    res.json(entry);
  } catch (error) {
    next(error);
  }
});

api.delete("/history/:id", (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    deleteHistoryEntry(id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

api.get("/logs/recent", (_req, res, next) => {
  try {
    const settings = getSettings();
    res.json(readRecentLogs(settings.logPath));
  } catch (error) {
    next(error);
  }
});

api.post("/logs/open-folder", async (_req, res, next) => {
  try {
    const settings = getSettings();
    const folder = await openLogFolder(settings.logPath);
    appendLog(settings.logPath, settings.loggingEnabled, "info", "Opened log folder", { folder });
    res.json({ ok: true, message: `Opened ${folder}.` });
  } catch (error) {
    next(error);
  }
});
