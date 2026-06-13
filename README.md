# Plex Movie Gap Finder

A local, self-hosted web app for discovering which movies are missing from a Plex server, then searching NZBHydra for releases.

## What v1 Does

- Connects to Plex with a manual base URL and token.
- Lets you choose which Plex movie libraries to scan into a local SQLite database.
- Searches TMDb for people, movies, studios, and IMDb list imports.
- Compares TMDb movie results with the local Plex scan.
- Marks movies as owned or missing.
- Searches NZBHydra for missing movies with quality and source filters.
- Sends selected NZBs to SABnzbd/NZBGet or downloads checked releases as a ZIP.
- Tracks downloader queue/history, with pause/resume controls.
- Shows movie details, cast, director, posters, runtime, and IMDb ratings when available.
- Writes local app/integration logs to `data/app.log` by default.

TV, Radarr, Sonarr, and direct per-indexer search are intentionally left for later versions.

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

Docker is optional. The app is a regular Node/TypeScript project first.

```bash
docker compose up --build
```

Then open [http://localhost:4174](http://localhost:4174).

## Plex Token

For v1, paste a Plex token manually in Settings. The token is stored locally in SQLite on your machine.

## Data

By default, local data is stored in `./data/app.db`. Set `DATABASE_PATH` to use another location.

Logs are written to `./data/app.log` by default and can be changed in Settings.

SABnzbd sends use file upload from the app server, so SAB does not need direct access to the NZBHydra release URL.

## IMDb Lists

IMDb often blocks server-side URL fetching. If a list URL does not load, open the IMDb page in your browser, export/copy the list page content, and paste the CSV/page text or raw `tt...` IDs into the IMDb list search box.
