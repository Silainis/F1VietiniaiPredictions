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
- Accounts are username + password only (no email at all; mail.js removed). Old accounts: username = lower(old name), email login still accepted.
  New users get placeholder email `user:<username>` (column is NOT NULL UNIQUE).
- Profile pictures (`src/avatars.js`, users.avatar): helmet:<team> (SVG drawn in app.js), team:<team>, url:<driver photo>,
  upload:<ts> (256px JPEG made in browser, base64 in avatars table, served by /api/avatars/:id?v=ts). userAvatar() in app.js renders all.
- Leagues, invite by link only. Creator is always admin and the only one who grants/revokes admin.
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

- Driver picker has a "Sort by" menu (remembered per browser): Team A-Z (default), Driver A-Z, last season's team
  championship, last season's driver championship, this season's driver championship (leader first). Standings come from
  formula1.com /en/results/<year>/drivers and /team (`src/standings.js`, table standings, GET /api/standings);
  last season read once, current every 3 h by cron. Team names matched via teamKey() in public/app.js (Sauber=Audi, RB=Racing Bulls).

- WPC (World Prediction Champion), `src/wpc.js`: 2024 and 2025 running totals typed in from the owner's spreadsheets
  (2025 Abu Dhabi column was empty: standings after Qatar). Current season = live scoreboard of league WPC_LEAGUE_ID=1 (Vietiniai).
  PLAYERS maps old table names to usernames (Šilainis=silainis, Agnė=agny, Martynas=martynas, Darius=muerto);
  Vakaris, Eglė, Karolis, Justas, Racer X have no account yet: add them to PLAYERS when they sign up.
  Pages: /wpc (hall of fame, all-time, seasons + chart), /player/:id and /player/h/:name (trophies gold/silver/bronze
  per WPC year, highlights: best race, 3+ streaks, scoring streak, races led, droughts; season table; current pick accuracy).

## Working notes
- Data sources: Jolpica F1 API (calendar, drivers, results, laps), formula1.com media for images and qualifying pages.
- Cron runs share a request budget of 45 (free plan limit 50): fixed jobs, then qualifying, Wikipedia photos.
- Jolpica rate-limits the Worker (HTTP 429 seen on 2026-10-15, e.g. drivers.json). Watch sync_log in D1 (last 20 cron results);
  if race results stop arriving, a formula1.com race-result fallback may be needed.
- Photo/track/team lists need re-checking at the start of each season (README sections 7 and 8).
- Tests used so far were local scripts (mock Jolpica, D1 shim); they are not in the repo.
