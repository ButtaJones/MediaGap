# AGENTS.md — MediaGap

Standing context for any AI coding agent working in this repo (Codex, Claude Code, etc.).
Read this before making changes. It captures architecture, hard rules, and lessons that
are NOT obvious from reading the code alone.

> If you also use Claude Code: symlink this file so both agents read one source of truth:
> `ln -s AGENTS.md CLAUDE.md`

## What MediaGap is

A local, self-hosted web app that compares a user's movie library (Plex, Jellyfin, or
Emby) against TMDb and shows what's MISSING — searchable by person/movie/studio, browsable
by franchise/collection, with optional handoff to NZBHydra for the gaps. Movies only.

## Stack

- Node >= 22.5, TypeScript, ES modules (`"type": "module"`).
- Frontend: React 19 + Vite. Client at :5173 (dev), API at :4174.
- Backend: Express 5. Storage: SQLite (local file, default `./data/app.db`).
- zod for validation, fast-xml-parser for NZB/feed parsing, lucide-react for icons.
- Scripts: `npm run dev` (both), `npm run build` (tsc --noEmit + vite build + server tsc),
  `npm start`, `npm test` (vitest), `npm run typecheck`.
- Source layout: `src/client` (React), `src/server` (Express, integrations, routes,
  services), `src/shared` (shared types). Styles in `src/client/styles/app.css`.

## Architecture — the core abstraction

Everything downstream of the library scan operates on **normalized movie records in
SQLite**, not on server-specific data. The media server is abstracted behind a common
interface; Plex, Jellyfin, and Emby integrations each produce the SAME normalized record
shape. Search, owned/missing matching, collections, and the NZBHydra handoff all read
those normalized records and must work identically regardless of which server produced
them.

**Implication:** to add or change a data source, conform to the normalized-record
interface. Do NOT modify the matching, collections, or NZBHydra logic to accommodate a
new source — they are source-agnostic by design and must stay that way.

## HARD RULES (these are correctness guarantees, not preferences)

1. **Never show one server's data under another server's labels.** Scans are persisted
   PER server type (plex/jellyfin/emby) and `movie_collection_map` is scoped by
   `media_server_type`. On server switch, load that server's saved data (do NOT wipe and
   force a re-scan). The active server's stats, search results, and collections must
   always match the server name shown in the UI.

2. **Every external image / logo / ID lookup needs a fallback chain.** It will be present
   for popular titles and absent for obscure ones — so it must degrade gracefully:
   - Movie title logo: TMDb clearlogo (`/movie/{id}/images`, prefer `en`, then
     language-neutral) → styled text. Never leave a blank.
   - Collection art: Fanart.tv (keyed by TMDb collection id) → TMDb → text. Fanart is
     OPTIONAL: only active if the user supplies a Fanart API key; with no key the app must
     work fully on TMDb/text.
   - Content rating, ratings, vote counts: show only when present, omit silently when not.

3. **TMDb-ID fallback for non-Plex servers.** Jellyfin/Emby may provide an IMDb id but no
   TMDb id depending on the user's metadata setup. Collections REQUIRE the TMDb id. For any
   scanned movie with an IMDb id but no TMDb id, resolve via TMDb
   `/find/{imdb_id}?external_source=imdb_id` and cache it. Without this, collections
   silently miss movies on Jellyfin/Emby (looks fine on Plex, breaks elsewhere).

4. **Collections bloat filter.** When computing "owned X of Y" for a collection, exclude
   members with no release date, a future release date, or no runtime (unreleased
   announcements, shorts, regional cuts). A miscounted "X of Y" makes the feature feel
   broken — accuracy is the whole point.

5. **Cache image/art/id lookups in SQLite.** Art and ids don't change. Resolve during
   scan / collection refresh, not per render. Don't fire a network lookup on every poster.

## SCOPE — do not build these

- No TV. No Radarr/Sonarr. Movies only, intentionally, for v1.
- No Rotten Tomatoes (no clean public API; do not scrape). IMDb + TMDb only.
- No bulk "send all missing to NZBHydra" — the NZBHydra flow is one movie at a time
  (search → pick a release → send). Each missing movie keeps its own Search button.
- No per-action server picker — server is a connection-level setting chosen once.

## UI / layout notes

- Themes: `dark`, `plex`, `emby`, `jellyfin` (set via `html[data-theme=...]`). Any new
  UI must be styled for all themes, or it breaks in three of four. Light is the default
  `:root`.
- Movie detail modal (`MovieDetailsModal.tsx` + `.details-*` rules in app.css): backdrop
  banner on top, poster overlaps UP into the banner seam (negative margin on
  `.details-identity`, higher z-index on `.details-poster`), title/meta to the right,
  body below. The backdrop should be full 16:9 (`aspect-ratio: 16/9`), not a cropped
  fixed height — the poster overlap recovers the vertical space.
- Three breakpoints exist and must stay consistent with each other: base (desktop),
  `max-width: 960px` (tablet), `max-width: 620px` (mobile). When changing modal geometry,
  update all three so desktop and mobile don't diverge.
- Mobile specifics already in place: hamburger nav (`.mobile-menu-button` /
  `.nav-actions.open`), compact stats, ratings hide vote counts (`.rating-pill small`
  hidden), 2-up posters.

## Working discipline (learned the hard way)

- **One focused change at a time; verify before the next.** Multi-server support, modal
  redesign, etc. were done in verified passes. Stacking unverified changes hides which one
  broke.
- **Reuse, don't rebuild.** When extending (e.g. Emby from Jellyfin), share code and only
  branch where APIs genuinely differ. Do not duplicate a working integration.
- **When given a small ask, make the small change.** Do not refactor adjacent code "while
  you're there" (e.g. a request for description padding is not a request to re-clamp
  titles).
- **Test the failure case, not just the happy path.** Things look fine on Plex / popular
  titles / desktop and break on Jellyfin / obscure titles / mobile. Verify the hard case.
- Run `npm run build` and `npm test` before declaring done.
