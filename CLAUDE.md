# F1 Vietiniai Predictions: project notes

F1 predictions game for friends. Cloudflare Worker + D1 + static assets. Owner: Vytautas.

## Live setup
- GitHub: Silainis/F1VietiniaiPredictions (branch main). Every push redeploys through Cloudflare Workers Builds.
- Worker name in `wrangler.jsonc` MUST equal the Git-connected Worker: `f1vietiniaiprediction`
  (a different name makes the build fail). Live URL: https://f1vietiniaiprediction.f1vietiniai.workers.dev
- D1 database `f1-predictions`, id in `wrangler.jsonc`. Cron every 30 min syncs calendar, drivers, results.
- `ADMIN_KEY` secret is not set yet (only needed for /api/admin/sync?key=...).
- After frontend changes users need a hard refresh (browser cache).

## Rules agreed with the owner
- Accounts + leagues, invite by link only (no email service). Creator is always admin and the only one who grants/revokes admin.
- Picks: P1-P5, P10, up to 3 DNFs. +1 per correct pick. Voting closes at race start.
- Late predictions (also for finished races) are allowed and go to the league admins' Approvals tab; they count only once approved.
- A driver can be used once per prediction; choosing a used driver in the picker moves them (greyed out but clickable).
- Admins reset a member's password (random temp password, member must change it).
- Favorite team (sign-up or account page) shows a side panel: logo, drivers, car, race photos (`src/f1teams.js`).
- Images are linked from formula1.com (driver photos `src/f1photos.js`, track maps `src/f1tracks.js`, team images `src/f1teams.js`). Track maps are shown black and white with a country flag (flagcdn.com) in the corner.
- Header logo is `public/f1-logo.png`.
- Race page shows a Qualifying table and Track history (`src/insights.js`, `GET /api/races/:round/insights`).
  Qualifying: formula1.com results page (meeting id read from /en/results/<year>/races, stored in races.f1_meeting_id), Jolpica fallback.
  Before it is published the page says it is not public yet; history still shows.
  Live: opening the race page of a race that has not started (after quali start) re-reads formula1.com, at most once a
  minute for all users (claim via races.quali_checked_at); open pages re-ask every 2 min. Starting grid
  (/starting-grid page) is stored in qualifying.grid and shown as a Grid column once published.
  History: last 5 editions at the circuit (podium + winner's grid), lead changes, overtakes estimated from Jolpica laps
  (pit in/out laps and >15% slow cars excluded, first lap excluded). Jolpica answers the Worker with HTTP 429, so the
  first visitor's browser collects it (collectHistory in public/app.js) and POSTs to /api/races/:round/history[/:season];
  the server validates and only fills empty rows. Cached forever in track_history.

## Working notes
- Data sources: Jolpica F1 API (calendar, drivers, results, laps), formula1.com media for images and qualifying pages.
- Cron runs share a request budget of 45 (free plan limit 50): fixed jobs, then qualifying, Wikipedia photos.
- Jolpica rate-limits the Worker (HTTP 429 seen on 2026-10-15, e.g. drivers.json). Watch sync_log in D1 (last 20 cron results);
  if race results stop arriving, a formula1.com race-result fallback may be needed.
- Photo/track/team lists need re-checking at the start of each season (README sections 7 and 8).
- Tests used so far were local scripts (mock Jolpica, D1 shim); they are not in the repo.
