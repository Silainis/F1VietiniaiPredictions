# F1 Vietiniai Predictions

A web app for predicting Formula 1 races with friends. Runs entirely on Cloudflare (Worker + D1 database), free tier is enough.

**What it does**

- Accounts (username + password, no email). Anyone can create a league and becomes its admin. Everyone can pick a profile picture.
- Invite people with a link (works with any messenger).
- The **creator** of a league is always an admin and is the only one who can give or take away admin rights for other members (and delete the league).
- **Admins** approve late predictions, create a new invite link, remove regular members and **reset a member's password**.
- **Forgot your password?** There is no email reset. An admin opens the Members tab, clicks *Reset password* next to the person and gets a random one-time password to send them (WhatsApp etc.). The member must choose their own password at the next login. Only the creator can reset another admin; nobody can reset the creator. Everybody can change their own password by clicking their name at the top.
- For every Grand Prix each player predicts **P1-P5, P10 and up to 3 DNFs**, picking from driver cards with photo, full name and team.
- The race calendar (GP name, start time, track layout) is imported automatically.
- Predictions are open until the race start time. After that a player can still send a **late prediction**: league admins get a notification and approve or reject it.
- Scores are collected automatically after each race. **+1 for every correct pick.**
- Scoreboard: standings, a trend line over the season, and per player the list of tracks where the score **increased** and where it **stayed the same**.

---

## Quick way: one double-click

On Windows, unzip the project, open the folder and **double-click `release.bat`** (on Mac or Linux run `npm run release` in the folder). Requirements: [Node.js](https://nodejs.org) (LTS) installed.

It does everything in sections 1 to 3 below for you:

1. installs the project tools (first time only),
2. opens your browser for the Cloudflare login (you only click **Allow**),
3. creates the database and writes its id into `wrangler.jsonc`,
4. publishes the app to your Worker address,
5. creates a random admin key and stores it in Cloudflare (a copy is saved in `admin-key.txt` on your computer; keep it private),
6. checks that the live site answers and imports the race calendar.

At the end it prints your app address and your private data-refresh link. Run it again whenever you change something: it skips the steps that are already done and simply publishes the update.

If it stops, the last lines say why in plain words. Fix that and run it again; nothing is harmed by repeating it.

---

## 1. Manual setup (what the script does, about 15 minutes)

You need [Node.js](https://nodejs.org) (LTS), plus the VS Code and GitHub you already installed.

```bash
cd f1-predictions
npm install
npx wrangler login                      # opens the browser, log in to Cloudflare
npx wrangler d1 create f1-predictions   # creates the database, prints a database_id
```

Open `wrangler.jsonc`, replace `PASTE-YOUR-DATABASE-ID-HERE` with that `database_id`.

Set an admin key (used only to force a data refresh, pick any long random text):

```bash
npx wrangler secret put ADMIN_KEY
```

## 2. Deploy

```bash
npx wrangler deploy
```

This replaces the placeholder page on `https://f1-vietiniai-predictions.f1vietiniai.workers.dev` with the app. Tables are created automatically on the first request, and the calendar, drivers, results and images are imported on the first visit.

### Updating later through GitHub (optional)

1. Create a GitHub repository and push this folder (`git init`, `git add .`, `git commit`, `git push`).
2. Cloudflare dashboard → Workers & Pages → your Worker → **Settings → Builds → Connect**. Pick the repository. Build command: leave empty. Deploy command: `npx wrangler deploy`.
3. From then on every push to GitHub redeploys the app.

## 3. First run

1. Open the URL, **Create account**, then **Create a league**.
2. On the Members tab copy the invite link and send it to your friends.
3. Open `https://f1-vietiniai-predictions.f1vietiniai.workers.dev/api/admin/sync?key=YOUR_ADMIN_KEY` once if you want to force an immediate data refresh (it also refreshes by itself every 30 minutes).

## 4. Accounts

Players sign up with a **username and password** only; the app never sends email. Invite links are shared by you (WhatsApp, Messenger, …), admins see approval requests in the app (bell icon), and a forgotten password is reset by a league admin (Members tab), who passes the temporary password on.

Accounts made before usernames existed got their old display name as username (lower case); they can also still log in with their old email address.

Everybody can choose a **picture** on the Account page: a helmet in a team's colours, a team logo, a driver photo, or an own photo (cropped to a square and shrunk to 256×256 in the browser, stored in the database).

## 5. Rules and choices you may want to change

| Topic | What the app does | Where to change |
|---|---|---|
| Scoring | +1 per correct P1, P2, P3, P4, P5, P10 and +1 per correctly predicted DNF | `src/scoring.js` |
| DNF | A driver counts as DNF if the official result shows them as retired ("R"). Drivers who did not start also count. | `COUNT_DNS_AS_DNF` in `src/scoring.js` |
| DNF picks | Max 3 per race, optional | `MAX_DNF_PICKS` in `src/scoring.js` |
| Wrong DNF picks | No penalty | `src/scoring.js` |
| Predictions | One per player per league per race (a player in two leagues enters them in each) | |
| Visibility | Other players' picks are hidden until the race starts | `getRacePredictions` in `src/index.js` |
| Late predictions | Approved inside the app by any admin of the league (bell icon + Approvals tab). Not counted until approved. If the league has a single admin, their own late entry is approved automatically. | `savePrediction` in `src/index.js` |

**Data sources.** Calendar, race start times and results come from the [Jolpica F1 API](https://github.com/jolpica/jolpica-f1) (the maintained successor of Ergast), which carries the official classification as clean JSON. The **qualifying** table on each race page is read from the formula1.com results page (for example `/en/results/2026/races/1296/singapore/qualifying`); the number in that address is read from the season results page, because it skips numbers when the calendar changes. If formula1.com cannot be read, Jolpica's qualifying data is used instead. The **track history** (podium, lead changes and estimated overtakes of the last 5 races at the circuit) is worked out from Jolpica's lap-by-lap data. Jolpica turns away requests from Cloudflare's servers, so the browser of the first player who opens a race page collects it (about half a minute) and the app stores it for everyone; see `collectHistory` in `public/app.js` and `src/insights.js`. Driver photos come from **formula1.com/en/drivers** (listed in `src/f1photos.js`). Track maps come from the **race pages on formula1.com** (for example `/en/racing/2026/australia`, listed in `src/f1tracks.js`) and are shown in black and white. A driver without a formula1.com photo falls back to Wikipedia, then to initials; a circuit without a map shows a chequered-flag placeholder.

## 6. Troubleshooting

- **A player sees "Error 1102" or a CPU-limit error when logging in or registering.** Password hashing is deliberately heavy. On the free Workers plan, lower it: in `wrangler.jsonc` under `vars` add `"PBKDF2_ITERATIONS": "20000"`, redeploy. Existing accounts keep working. (Or use the $5/month Workers Paid plan and keep the default.)
- **A track map is missing (chequered flag shown).** That circuit is not listed in `src/f1tracks.js` yet; see "Updating track maps" below. The circuit ids the app uses are visible at `/api/races` (while logged in).
- **Images appear slowly right after the first deploy.** Driver photos and track maps are applied immediately; only the Wikipedia fallback for unlisted drivers is fetched in small batches (the free plan allows 50 outgoing requests per run), so it fills in over a few 30-minute cycles, or immediately via the `/api/admin/sync` link above.
- **Results did not arrive after a race.** They are fetched 2 hours after the start time, then every 30 minutes until published.
- **Qualifying says "not public yet" after the session.** From the start of qualifying until the race starts, opening the race page checks formula1.com right away (at most once a minute for everybody), an open page checks again every 2 minutes, and the 30-minute schedule checks too. The official starting grid (after penalties) is added as a Grid column once formula1.com publishes it.
- **Track history says the data service is busy.** Jolpica limits how many requests one visitor can make; open the race page again later and it continues where it stopped. Once a track is complete it is never fetched again.
- **Run it locally:** create a file `.dev.vars` with `ADMIN_KEY=anything`, then `npm run dev` and open http://localhost:8787.

## 7. Updating driver photos

The photos are loaded straight from formula1.com's image server, so the app only stores their addresses. The 22 current drivers are already in `src/f1photos.js`. When the grid changes (new season, a driver swap) or a photo shows up as initials:

1. Open https://www.formula1.com/en/drivers in a desktop browser and scroll to the bottom so every card loads.
2. Press F12, open the **Console** tab, paste this and press Enter:

```js
copy(JSON.stringify(Object.fromEntries([...document.querySelectorAll('a[href*="/en/drivers/"]')].map(a => [a.getAttribute('href').split('/').pop(), (a.querySelector('img') || {}).src || '']).filter(([s, u]) => /\/v\d+\/common\//.test(u)).map(([s, u]) => [s, u.split(/\/v\d+\//)[1]])), null, 2))
```

3. In `src/f1photos.js` replace the contents of `PHOTOS = { ... }` with the pasted text and deploy. The photos switch over by themselves (within 30 minutes, or immediately via the `/api/admin/sync` link).

Note that the pictures belong to Formula One; they are only linked, not copied. If formula1.com ever changes its image addresses or blocks outside sites, the app simply shows initials until you refresh the list.

## 8. Updating track maps

Every race page on formula1.com has a CIRCUIT section with a map. The app links to those images (they are not copied) and shows them in black and white. All 23 circuits of the 2026 calendar are already in `src/f1tracks.js`, matched by circuit id. When a new season starts, or the calendar gets a new track:

1. Open https://www.formula1.com/en/racing/2026 (use the new year) in a desktop browser.
2. Press F12, open the **Console**, paste this and press Enter (it takes a few seconds):

```js
(async () => { const slugs = [...new Set([...document.documentElement.innerHTML.matchAll(/href="\/en\/racing\/2026\/([a-z0-9-]+)"/g)].map(m => m[1]))].filter(s => !s.startsWith('pre-season')); const out = []; for (const s of slugs) { const h = await (await fetch('/en/racing/2026/' + s)).text(); out.push(s + ' -> ' + ((h.match(/common\/f1\/2026\/track\/([A-Za-z0-9_.-]+?\.webp)/) || [])[1])); await new Promise(r => setTimeout(r, 300)); } console.log(out.join('\n')); })()
```

3. It prints one line per race, like `australia -> 2026trackmelbournedetailed.webp`. In `src/f1tracks.js` set each circuit's file name (the left side of each entry is the circuit id the app uses; look them up at `/api/races`). For a new year also change `2026` in the `BASE` address to the new year.
4. Deploy. Maps update within 30 minutes, or immediately via the `/api/admin/sync` link.

Like the photos, the maps belong to Formula One and are only linked. If formula1.com changes its image addresses, the app shows placeholders until the list is refreshed.

## 9. Project layout

```
wrangler.jsonc     Cloudflare configuration (name, database, schedule)
src/index.js       API: accounts, leagues, invites, predictions, approvals, scoreboard
src/sync.js        Imports calendar, drivers, results, photos and track layouts
src/insights.js    Qualifying results and track history shown on each race page
src/standings.js   Championship standings (formula1.com) for sorting the driver picker
src/f1photos.js    Driver photo addresses from formula1.com/en/drivers
src/f1tracks.js    Circuit map addresses from the formula1.com race pages
src/scoring.js     Scoring rules
src/avatars.js     Profile pictures (presets and uploads)
src/schema.js      Database tables (created automatically)
release.mjs        One-click release script (run by release.bat or npm run release)
public/            The web pages (index.html, style.css, app.js)
```
