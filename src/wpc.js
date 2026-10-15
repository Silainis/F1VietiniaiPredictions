// WPC: World Prediction Champion. Our own championship across seasons.
//
// Seasons before the app existed are typed in below from the owner's spreadsheets: the running
// total of every player after each race. The current season comes live from the app league
// WPC_LEAGUE_ID (its scoreboard).
//
// PLAYERS links a name used in the old tables to an app account (by username, lower case).
// Names without an account yet are shown as plain names; add them here once the person has signed up.

export const WPC_LEAGUE_ID = 1; // "Vietiniai"

export const PLAYERS = {
  'Šilainis': 'silainis',
  'Agnė': 'agny',
  'Martynas': 'martynas',
  'Darius': 'muerto',
  // no account yet: Vakaris, Eglė, Karolis, Justas, Racer X, Andrius, Ramūnas, Veronika
};

const R2024 = ['Bahrain', 'Saudi Arabian', 'Australian', 'Japanese', 'Chinese', 'Miami', 'Emilia Romagna', 'Monaco', 'Canadian', 'Spanish', 'Austrian', 'British',
  'Hungarian', 'Belgian', 'Dutch', 'Italian', 'Azerbaijan', 'Singapore', 'United States', 'Mexico City', 'São Paulo', 'Las Vegas', 'Qatar', 'Abu Dhabi'];
const R2025 = ['Australian', 'Chinese', 'Japanese', 'Bahrain', 'Saudi Arabian', 'Miami', 'Emilia-Romagna', 'Monaco', 'Spanish', 'Canadian', 'Austrian', 'British',
  'Belgian', 'Hungarian', 'Dutch', 'Italian', 'Azerbaijan', 'Singapore', 'United States', 'Mexico City', 'São Paulo', 'Las Vegas', 'Qatar', 'Abu Dhabi'];

const R2026 = ['Australian', 'Chinese', 'Japanese', 'Miami', 'Canadian', 'Monaco', 'Barcelona', 'Austrian', 'British', 'Belgian', 'Hungarian', 'Dutch',
  'Italian', 'Spanish', 'Azerbaijan', 'Bahrain', 'Singapore', 'United States', 'Mexico City', 'São Paulo', 'Las Vegas', 'Qatar', 'Abu Dhabi'];

// Running totals after each race (null = not filled in the spreadsheet).
export const HISTORY = [
  {
    season: 2024,
    races: R2024,
    rows: {
      'Šilainis': [2, 5, 5, 8, 11, 12, 18, 19, 22, 24, 24, 25, 27, 27, 30, 32, 32, 35, 35, 39, 39, 39, 40, 41],
      'Vakaris': [2, 5, 5, 8, 9, 10, 15, 17, 18, 23, 24, 25, 26, 26, 26, 27, 27, 28, 31, 34, 34, 36, 37, 40],
      'Eglė': [1, 3, 3, 3, 6, 7, 11, 12, 12, 12, 13, 15, 16, 17, 17, 21, 23, 26, 27, 28, 30, 30, 31, 34],
      'Darius': [1, 4, 4, 6, 7, 9, 12, 15, 17, 20, 21, 22, 22, 22, 23, 25, 25, 26, 28, 31, 31, 32, 33, 33],
      'Agnė': [1, 3, 3, 6, 9, 10, 11, 13, 16, 19, 20, 21, 21, 22, 24, 24, 24, 24, 24, 24, 24, 27, 28, 28],
      'Martynas': [1, 3, 3, 6, 7, 8, 10, 12, 14, 16, 17, 18, 20, 20, 20, 21, 21, 23, 23, 25, 25, 25, 26, 26],
      'Karolis': [2, 3, 3, 3, 3, 4, 5, 5, 6, 6, 6, 6, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8],
      'Justas': [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    },
  },
  {
    season: 2025,
    races: R2025,
    // The Abu Dhabi column was empty in the spreadsheet; standings are taken after Qatar.
    rows: {
      'Racer X': [1, 3, 9, 11, 11, 12, 12, 15, 18, 20, 23, 24, 26, 28, 29, 33, 35, 37, 41, 43, 45, 45, 46, null],
      'Agnė': [1, 4, 4, 5, 6, 8, 9, 12, 15, 16, 21, 22, 24, 26, 27, 31, 32, 34, 38, 40, 42, 42, 42, null],
      'Vakaris': [2, 4, 6, 8, 10, 12, 13, 16, 19, 20, 23, 25, 28, 29, 30, 33, 34, 35, 37, 38, 39, 39, 40, null],
      'Darius': [1, 2, 2, 4, 6, 7, 8, 11, 14, 14, 16, 18, 21, 21, 22, 26, 27, 29, 33, 37, 39, 39, 40, null],
      'Šilainis': [0, 3, 5, 9, 9, 9, 10, 15, 17, 19, 22, 23, 26, 26, 27, 27, 28, 31, 32, 35, 37, 37, 38, null],
      'Eglė': [0, 3, 4, 6, 9, 9, 9, 12, 15, 16, 17, 17, 18, 20, 21, 25, 25, 25, 29, 32, 34, 34, 35, null],
      'Martynas': [0, 2, 8, 10, 11, 11, 13, 14, 17, 17, 19, 20, 20, 20, 20, 21, 22, 24, 25, 25, 27, 27, 28, null],
    },
  },
  {
    // Current season: the spreadsheet covers the races up to Singapore (round 17). The races after
    // that are added from the app league, in calendar order (app round n = column n).
    season: 2026,
    races: R2026,
    rows: {
      'Agnė': [1, 3, 5, 8, 8, 9, 9, 10, 12, 13, 14, 14, 14, 14, 14, 19, 19],
      'Andrius': [2, 2, 4, 7, 8, 8, 8, 9, 11, 12, 13, 13, 13, 14, 17, 17, 17],
      'Darius': [2, 2, 4, 4, 5, 5, 5, 5, 5, 6, 7, 7, 7, 7, 7, 7, 7],
      'Eglė': [1, 2, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5],
      'Martynas': [2, 2, 2, 2, 2, 4, 5, 7, 7, 10, 10, 10, 10, 10, 12, 13, 13],
      'Ramūnas': [1, 1, 3, 4, 5, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7],
      'Šilainis': [2, 2, 4, 5, 6, 7, 9, 9, 11, 13, 15, 16, 16, 18, 18, 20, 21],
      'Vakaris': [1, 3, 5, 6, 6, 6, 6, 6, 10, 12, 12, 14, 14, 14, 14, 18, 19],
      'Veronika': [0, 2, 3, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
    },
  },
];

// One season in a common shape: races (names) and players with running totals, sorted by final points.
// Ties share the better position.
function rankRows(rows) {
  rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  rows.forEach((r, i) => { r.position = i > 0 && rows[i - 1].total === r.total ? rows[i - 1].position : i + 1; });
  return rows;
}

async function accountsByUsername(env) {
  const names = Object.values(PLAYERS).filter(Boolean);
  if (!names.length) return new Map();
  const { results } = await env.DB.prepare(
    `SELECT id, name, username, avatar FROM users WHERE username IN (${names.map(() => '?').join(',')})`
  ).bind(...names).all();
  return new Map(results.map((u) => [u.username, u]));
}

export async function wpcSeasons(env, getScoreboard) {
  const accounts = await accountsByUsername(env);
  const userFor = (name) => accounts.get(PLAYERS[name]) || null;
  const year = Number(env.SEASON || new Date().getUTCFullYear());

  // The app league's scoreboard, for the current season's races after the spreadsheet stops.
  let app = null;
  try {
    const sb = await getScoreboard(env, WPC_LEAGUE_ID);
    const reverse = new Map(Object.entries(PLAYERS).map(([n, u]) => [u, n]));
    const { results: users } = await env.DB.prepare(`SELECT id, username FROM users`).all();
    const uname = new Map(users.map((u) => [u.id, u.username]));
    app = {
      // scored rounds only; app round n is column n-1 of the season
      rounds: sb.races.map((r) => r.round),
      names: sb.races.map((r) => r.name.replace(' Grand Prix', '')),
      // a known player keeps the name from the tables, so their seasons line up
      players: sb.board.map((b) => ({ name: reverse.get(uname.get(b.id)) || b.name, user: { id: b.id, name: b.name, avatar: b.avatar }, per: b.per_race })),
    };
  } catch (e) { console.error('WPC current season', e.message); }

  const seasons = HISTORY.map((h) => {
    const last = Math.max(...Object.values(h.rows).map((t) => t.reduce((n, v, i) => (v !== null ? i : n), -1)));
    let races = h.races.slice(0, last + 1);
    const rows = Object.entries(h.rows).map(([name, totals]) => {
      const u = userFor(name);
      return { name, user: u ? { id: u.id, name: u.name, avatar: u.avatar } : null, totals: totals.slice(0, last + 1) };
    });
    const live = h.season === year;
    if (live && app) {
      // add the races scored in the app after the spreadsheet's last column
      const extra = app.rounds.map((round, i) => ({ round, i })).filter((x) => x.round - 1 > last);
      for (const x of extra) races.push(h.races[x.round - 1] || app.names[x.i]);
      for (const p of app.players) {
        let row = rows.find((r) => r.name === p.name);
        if (!row) { row = { name: p.name, user: p.user, totals: Array(last + 1).fill(0) }; rows.push(row); }
        if (!row.user) row.user = p.user;
        let total = row.totals[row.totals.length - 1] ?? 0;
        for (const x of extra) { total += p.per[x.i]?.pts || 0; row.totals.push(total); }
      }
      for (const r of rows) while (r.totals.length < races.length) r.totals.push(r.totals[r.totals.length - 1] ?? 0);
    }
    for (const r of rows) r.total = r.totals[r.totals.length - 1] ?? 0;
    return { season: h.season, races, complete: !live && last === h.races.length - 1, live, rows: rankRows(rows) };
  });

  // a season with no spreadsheet at all comes only from the app
  if (app && !seasons.some((s) => s.season === year)) {
    const first = app.players.length ? app.names.findIndex((_, i) => app.players.some((p) => p.per[i]?.submitted)) : -1;
    const from = first < 0 ? app.names.length : first;
    seasons.push({
      season: year, races: app.names.slice(from), complete: false, live: true,
      rows: rankRows(app.players.map((p) => {
        const base = from > 0 ? p.per[from - 1].total : 0;
        const totals = p.per.slice(from).map((x) => x.total - base);
        return { name: p.name, user: p.user, totals, total: totals[totals.length - 1] ?? 0 };
      })),
    });
  }
  return seasons.sort((a, b) => a.season - b.season);
}

// All-time table: titles, podiums, seasons, points, best finish. Only finished seasons count for titles.
export function allTime(seasons) {
  const map = new Map();
  for (const s of seasons) {
    for (const r of s.rows) {
      const p = map.get(r.name) || { name: r.name, user: r.user, seasons: 0, titles: 0, podiums: 0, points: 0, best: null, finishes: [] };
      if (r.user) p.user = r.user;
      p.seasons++;
      p.points += r.total;
      p.finishes.push({ season: s.season, position: r.position, total: r.total, players: s.rows.length, live: s.live });
      if (!s.live) {
        if (r.position === 1) p.titles++;
        if (r.position <= 3) p.podiums++;
        p.best = p.best === null ? r.position : Math.min(p.best, r.position);
      }
      map.set(r.name, p);
    }
  }
  return [...map.values()].sort((a, b) => b.titles - a.titles || b.podiums - a.podiums || (a.best ?? 99) - (b.best ?? 99) || b.points - a.points);
}

// Numbers worth showing on a profile, worked out from the running totals of one season.
// points per race = difference between two totals. "Led" counts the races after which the
// player was top of the table (shared lead included).
export function seasonStats(season, row) {
  const per = row.totals.map((t, i) => (t ?? 0) - (i ? row.totals[i - 1] ?? 0 : 0));
  const run = (test) => {
    let best = 0, cur = 0, end = -1;
    per.forEach((p, i) => { cur = test(p) ? cur + 1 : 0; if (cur > best) { best = cur; end = i; } });
    return { length: best, from: best ? season.races[end - best + 1] : null, to: best ? season.races[end] : null };
  };
  let led = 0;
  season.races.forEach((_, i) => {
    const top = Math.max(...season.rows.map((r) => r.totals[i] ?? 0));
    if ((row.totals[i] ?? 0) === top && top > 0) led++;
  });
  const bestPts = Math.max(0, ...per);
  return {
    races: per.length,
    avg: per.length ? Math.round((row.total / per.length) * 10) / 10 : 0,
    best: { pts: bestPts, races: season.races.filter((_, i) => per[i] === bestPts && bestPts > 0) },
    hot: run((p) => p >= 3), // races in a row with 3 or more right guesses
    scoring: run((p) => p > 0), // races in a row with at least one point
    drought: run((p) => p === 0), // races in a row without a point
    led,
    per,
  };
}
