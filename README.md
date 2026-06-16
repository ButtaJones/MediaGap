<div align="center">

<img src="docs/banner.png" alt="MediaGap" width="100%" />

<h1>MediaGap</h1>

<p><strong>Find the movies your media library is missing — then go get them.</strong></p>

<p>A local, self-hosted web app that compares your library against TMDb, shows you the gaps as a poster wall, completes your franchises, and hands missing titles straight to NZBHydra.</p>

<p>
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" />
  <img src="https://img.shields.io/badge/self--hosted-yes-success.svg" alt="Self-hosted" />
  <img src="https://img.shields.io/badge/built%20with-TypeScript-3178C6.svg" alt="TypeScript" />
  <img src="https://img.shields.io/badge/docker-optional-2496ED.svg" alt="Docker optional" />
  <img src="https://img.shields.io/github/stars/ButtaJones/MediaGap?style=social" alt="GitHub stars" />
</p>

</div>

<div align="center">
  <img src="docs/screenshot.png" alt="MediaGap library view" width="90%" />
</div>

---

## Why MediaGap

Most "what's missing from my library" tooling is built for set-and-forget automation. MediaGap is built for **browsing**. Search an actor, a studio, or a franchise, and see instantly — as a wall of posters — what you own and what you're missing, then send the gaps to your downloader in a couple of clicks.

- **Visual gap-finding.** Owned vs. missing at a glance, by person, movie, or studio — not a config screen.
- **Franchise completion.** MediaGap finds the collections you've *started but not finished* ("you own 2 of 4 John Wick") and surfaces the missing entries, with junk like unreleased announcements filtered out.
- **Straight to your downloader.** Missing titles flow into NZBHydra with quality/source filters, then to SABnzbd/NZBGet or a ZIP — no copy-pasting.

> **Server support:** Plex, Jellyfin, and Emby are supported today. The library layer normalizes each server into the same local movie records.

---

## What v1 Does

- Connects to Plex with a manual base URL/token, or Jellyfin/Emby with a base URL/API key/user ID.
- Lets you choose which movie libraries to scan into a local SQLite database.
- Searches TMDb for people, movies, and studios.
- Finds partially complete TMDb movie collections from your scanned library.
- Compares TMDb movie results with the local media-server scan and marks movies **owned** or **missing**.
- Searches NZBHydra for missing movies with quality and source filters.
- Sends selected NZBs to SABnzbd/NZBGet, or downloads checked releases as a ZIP.
- Tracks downloader queue/history, with pause/resume controls.
- Shows movie details, cast, director, posters, runtime, and IMDb ratings when available.
- Writes local app/integration logs to `data/app.log` by default.

> TV, Radarr, Sonarr, and direct per-indexer search are intentionally left for later versions.

---

## Run Locally

```bash
npm install
npm run dev
```

Open the app at [http://localhost:5173](http://localhost:5173).
The API runs at [http://localhost:4174](http://localhost:4174).

## Build And Start

```bash
npm run build
npm start
```

To run on a custom port:

```bash
PORT=4190 npm start
```

## Optional Docker

Docker is optional — the app is a regular Node/TypeScript project first.

```bash
docker compose up --build
```

Then open [http://localhost:4174](http://localhost:4174).

---

## Configuration

### Media Server

For Plex, paste a Plex token manually in Settings. For Jellyfin or Emby, enter the server URL, API key, and user ID or exact username. Credentials are stored locally in SQLite on your machine.

### Data

By default, local data is stored in `./data/app.db`. Set `DATABASE_PATH` to use another location.

Logs are written to `./data/app.log` by default and can be changed in Settings.

SABnzbd sends use file upload from the app server, so SAB does not need direct access to the NZBHydra release URL.

### Collections

The Collections view uses owned movies with TMDb IDs to find franchises you have started but have not finished. Refreshing collections caches TMDb collection members in SQLite, then overlays owned/missing status using the same matching and NZBHydra handoff as search results.

---

## Roadmap

- [x] Jellyfin library support
- [x] Emby library support
- [ ] "Discover" collections — browse famous franchises you own none of
- [ ] Bulk "grab all missing" per collection
- [ ] TV support (Sonarr)

---

## License

[MIT](LICENSE) — do what you like, no warranty.
