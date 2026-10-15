// Race page extras: the qualifying classification and the history of the race at this circuit.
//
// Qualifying comes from the formula1.com results pages, e.g.
//   https://www.formula1.com/en/results/2026/races/1296/singapore/qualifying
// The number in that address (the "meeting id") is not simply round + something: it skips
// numbers when the calendar changes. So the ids are read once from the season results page
// (https://www.formula1.com/en/results/2026/races) and stored with each race. If formula1.com
// cannot be read, the Jolpica F1 API (same data, published a little later) is used instead.
//
// Track history (podium, lead changes and estimated overtakes of the last 5 editions at the circuit)
// is collected from the Jolpica F1 API by the players' browsers and stored here; see below.

const F1 = 'https://www.formula1.com';
const UA = 'Mozilla/5.0 (compatible; f1-vietiniai-predictions/1.0; +https://f1vietiniaiprediction.f1vietiniai.workers.dev)';
const HISTORY_YEARS = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jolpica = (env) => env.JOLPICA_BASE || 'https://api.jolpi.ca/ergast/f1';
const f1Base = (env) => env.F1_BASE || F1;
const season = (env) => Number(env.SEASON || new Date().getUTCFullYear());

// Counts requests so one cron run stays under the Workers limit (50 on the free plan).
export class Budget {
  constructor(max) { this.left = max; }
  take(n = 1) {
    if (this.left < n) return false;
    this.left -= n;
    return true;
  }
  spend(n) { this.left = Math.max(0, this.left - n); }
}

// Jolpica allows a few requests per second and a few hundred per hour, and Workers share their
// outgoing addresses with other sites, so "too many requests" (429) does happen. It waits as long as
// the answer asks (up to 15 s) and tries again; if it keeps happening the job stops for this run and
// carries on 30 minutes later.
export class RateLimited extends Error {}
async function getJolpica(env, path) {
  const gap = env.JOLPICA_DELAY_MS !== undefined ? Number(env.JOLPICA_DELAY_MS) : 600;
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(gap);
    const res = await fetch(`${jolpica(env)}${path}`, { headers: { 'User-Agent': UA, accept: 'application/json' } });
    if (res.status === 429) {
      const wait = Math.min(15, Number(res.headers.get('retry-after')) || 4 * (attempt + 1));
      if (attempt < 2) { await sleep(gap ? wait * 1000 : 0); continue; }
      throw new RateLimited(`${path} -> HTTP 429`);
    }
    if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
    return res.json();
  }
}

async function getPage(env, path) {
  const res = await fetch(`${f1Base(env)}${path}`, { headers: { 'User-Agent': UA, accept: 'text/html' } });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.text();
}

// ------------------------------------------------------------ formula1.com

const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const cellText = (html) =>
  html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ').trim();

// Season results page -> [{ id, slug }] in calendar order.
export function parseMeetingLinks(html, year) {
  const re = new RegExp(`/en/results/${year}/races/(\\d+)/([a-z0-9-]+)/race-result`, 'g');
  const seen = new Set();
  const out = [];
  for (const m of html.matchAll(re)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ id: m[1], slug: m[2] });
  }
  return out;
}

// Gives every race of the season its formula1.com meeting id. The results page lists the races in
// calendar order; when the count matches ours they are paired by order, otherwise by name.
export async function syncMeetingIds(env, budget) {
  const { results: races } = await env.DB.prepare(`SELECT round, name, country, locality, f1_meeting_id FROM races ORDER BY round`).all();
  if (!races.length || races.every((r) => r.f1_meeting_id)) return 0;
  if (!budget.take()) return 0;
  const links = parseMeetingLinks(await getPage(env, `/en/results/${season(env)}/races`), season(env));
  if (!links.length) return 0;

  const pairs = [];
  if (links.length === races.length) {
    races.forEach((r, i) => pairs.push([r, links[i]]));
  } else {
    for (const r of races) {
      const words = new Set(plain(`${r.name} ${r.country} ${r.locality}`).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && w !== 'grand' && w !== 'prix'));
      const hit = links.find((l) => l.slug.split('-').some((w) => words.has(w)));
      if (hit) pairs.push([r, hit]);
    }
  }
  const stmt = env.DB.prepare(`UPDATE races SET f1_meeting_id=?, f1_slug=? WHERE round=?`);
  if (pairs.length) await env.DB.batch(pairs.map(([r, l]) => stmt.bind(l.id, l.slug, r.round)));
  return pairs.length;
}

// Results table of a formula1.com page -> rows of cell texts. Only the <table> part is scanned, so
// the rest of the (large) page costs almost no CPU. An empty list means nothing is published yet
// (the page then shows "No results available").
function tableRows(html, minCells) {
  const start = html.indexOf('<tbody');
  if (start < 0) return [];
  const body = html.slice(start, html.indexOf('</tbody>', start));
  const rows = [];
  for (const tr of body.split(/<tr[\s>]/).slice(1)) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => cellText(m[1]));
    if (cells.length >= minCells) rows.push(cells);
  }
  return rows;
}
const splitDriver = (cell) => {
  const m = cell.match(/([A-Z]{3})$/); // "Max Verstappen" + "VER" (the short code is shown on phones)
  return m ? { code: m[1], name: cell.slice(0, -3).trim() } : { code: null, name: cell };
};

export function parseQualifying(html) {
  const time = (s) => (/^\d+:\d{2}\.\d{3}$/.test(s) ? s : null);
  return tableRows(html, 8).map((t) => ({
    pos_text: t[0], number: t[1] || null, ...splitDriver(t[2]), team: t[3] || null,
    q1: time(t[4]), q2: time(t[5]), q3: time(t[6]), laps: /^\d+$/.test(t[7]) ? Number(t[7]) : null,
  }));
}

// Starting grid page (published later, after grid penalties) -> [{ grid, number, code }].
export function parseGrid(html) {
  return tableRows(html, 4).map((t) => ({ grid: t[0], number: t[1] || null, code: splitDriver(t[2]).code }));
}

const f1Path = (env, race, page) => `/en/results/${season(env)}/races/${race.f1_meeting_id}/${race.f1_slug}/${page}`;

async function qualifyingFromJolpica(env, race) {
  const data = await getJolpica(env, `/${season(env)}/${race.round}/qualifying.json?limit=100`);
  const list = data.MRData.RaceTable.Races?.[0]?.QualifyingResults || [];
  return list.map((q) => ({
    pos_text: String(q.position), number: q.number || null, code: q.Driver.code || null,
    name: `${q.Driver.givenName} ${q.Driver.familyName}`, team: q.Constructor?.name || null,
    q1: q.Q1 || null, q2: q.Q2 || null, q3: q.Q3 || null, laps: null, driver_id: q.Driver.driverId,
  }));
}

// Reads qualifying (and, once qualifying is out, the starting grid) for one race and stores it.
// A check that finds nothing keeps what is stored. Returns true when rows were stored.
export async function refreshQualifying(env, race, budget = new Budget(3), { jolpicaFallback = true } = {}) {
  let rows = [];
  let source = null;
  if (race.f1_meeting_id && budget.take()) {
    try { rows = parseQualifying(await getPage(env, f1Path(env, race, 'qualifying'))); source = 'formula1.com'; } catch (e) { console.error('F1 qualifying', race.round, e.message); }
  }
  if (!rows.length && jolpicaFallback && budget.take()) {
    try { rows = await qualifyingFromJolpica(env, race); source = 'jolpica'; } catch (e) { console.error('Jolpica qualifying', race.round, e.message); }
  }
  if (!rows.length) return false;
  let grid = [];
  if (race.f1_meeting_id && budget.take()) {
    try { grid = parseGrid(await getPage(env, f1Path(env, race, 'starting-grid'))); } catch (e) { console.error('F1 grid', race.round, e.message); }
  }
  const gridByCode = new Map(grid.filter((g) => g.code).map((g) => [g.code, g.grid]));
  const gridByNumber = new Map(grid.filter((g) => g.number).map((g) => [String(g.number), g.grid]));
  for (const r of rows) r.grid = gridByCode.get(r.code) || gridByNumber.get(String(r.number)) || null;
  await storeQualifying(env, race.round, rows, source);
  return true;
}

// Cron (every 30 minutes): races whose qualifying has taken place and is not stored yet (newest first),
// and the coming race until it starts, so penalties and the starting grid are picked up. Old races
// without results are retried for two weeks after the race, then left alone.
export async function syncQualifying(env, budget, maxRaces = 3) {
  const t = Date.now();
  try { await syncMeetingIds(env, budget); } catch (e) { console.error('Meeting ids', e.message); }

  const { results: due } = await env.DB.prepare(
    `SELECT round, name, f1_meeting_id, f1_slug, race_ts, quali_ts FROM races r
     WHERE COALESCE(quali_ts, race_ts - 86400000) + 3600000 < ?
       AND (race_ts > ? OR (quali_checked_at IS NULL AND NOT EXISTS (SELECT 1 FROM qualifying q WHERE q.round = r.round))
            OR (race_ts > ? AND NOT EXISTS (SELECT 1 FROM qualifying q WHERE q.round = r.round)))
     ORDER BY round DESC LIMIT ?`
  ).bind(t, t, t - 14 * 86400000, maxRaces).all();

  let stored = 0;
  for (const race of due) {
    if (budget.left < 1) break;
    if (await refreshQualifying(env, race, budget)) stored++;
    await env.DB.prepare(`UPDATE races SET quali_checked_at=? WHERE round=?`).bind(t, race.round).run();
  }
  return stored;
}

// Race page opened: for a race that has not started yet and whose qualifying has begun, look at
// formula1.com right away, at most once a minute for everybody together (whoever opens the page
// first after that minute does the check, the others get the stored copy).
const LIVE_EVERY = 60 * 1000;
export async function liveQualifyingCheck(env, race) {
  const t = Date.now();
  if (!race.f1_meeting_id || race.race_ts <= t) return false;
  if ((race.quali_ts || race.race_ts - 86400000) > t) return false;
  const claim = await env.DB.prepare(`UPDATE races SET quali_checked_at=? WHERE round=? AND COALESCE(quali_checked_at, 0) < ?`)
    .bind(t, race.round, t - LIVE_EVERY).run();
  if (!claim.meta.changes) return false; // someone checked less than a minute ago
  try {
    return await refreshQualifying(env, race, new Budget(2), { jolpicaFallback: false });
  } catch (e) {
    console.error('Live qualifying', race.round, e.message);
    return false;
  }
}

async function storeQualifying(env, round, rows, source) {
  const { results: drivers } = await env.DB.prepare(`SELECT driver_id, code, number FROM drivers`).all();
  const byCode = new Map(drivers.filter((d) => d.code).map((d) => [d.code, d.driver_id]));
  const byNumber = new Map(drivers.filter((d) => d.number).map((d) => [String(d.number), d.driver_id]));
  const stmt = env.DB.prepare(
    `INSERT OR REPLACE INTO qualifying (round, position, pos_text, number, code, driver_id, name, team, q1, q2, q3, laps, grid, source, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM qualifying WHERE round=?`).bind(round),
    ...rows.map((r, i) =>
      stmt.bind(round, i + 1, r.pos_text, r.number, r.code,
        r.driver_id || byCode.get(r.code) || byNumber.get(String(r.number)) || null,
        r.name, r.team, r.q1, r.q2, r.q3, r.laps, r.grid || null, source, Date.now())
    ),
  ]);
}

// ----------------------------------------------------------- track history
//
// The Jolpica API answers the Cloudflare servers with "too many requests" (they share addresses with
// many other sites), so the history is collected in the browser of the first player who opens the
// race page (public/app.js, collectHistory) and sent here to be stored for everyone. Past races do
// not change, so this happens once per circuit. Only empty rows can be filled, and every value is
// checked, so a player cannot overwrite stored history.

const int = (v, max) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
};
const str = (v, max = 60) => (v === null || v === undefined ? null : String(v).slice(0, max));

async function raceCircuit(env, round) {
  const r = await env.DB.prepare(`SELECT circuit_id FROM races WHERE round=?`).bind(round).first();
  return r?.circuit_id || null;
}

// editions: [{ season, round, race_name, podium: [{ driver_id, code, name, team, grid } | null] x3 }]
export async function saveHistoryPodiums(env, round, editions) {
  const circuitId = await raceCircuit(env, round);
  if (!circuitId || !Array.isArray(editions)) return false;
  const meta = await env.DB.prepare(`SELECT podiums_at FROM track_meta WHERE circuit_id=?`).bind(circuitId).first();
  if (meta) return true; // already stored by someone else
  const year = season(env);
  const clean = editions
    .map((e) => ({
      season: int(e.season, year - 1), round: int(e.round, 40), race_name: str(e.race_name, 80),
      podium: Array.from({ length: 3 }, (_, i) => {
        const p = Array.isArray(e.podium) ? e.podium[i] : null;
        return p && p.name ? { driver_id: str(p.driver_id, 40), code: str(p.code, 3), name: str(p.name), team: str(p.team), grid: int(p.grid, 40) } : null;
      }),
    }))
    .filter((e) => e.season && e.season >= 1950 && e.round)
    .sort((x, y) => y.season - x.season)
    .slice(0, HISTORY_YEARS);
  const stmt = env.DB.prepare(
    `INSERT INTO track_history (circuit_id, season, round, race_name, podium) VALUES (?, ?, ?, ?, ?) ON CONFLICT(circuit_id, season) DO NOTHING`
  );
  await env.DB.batch([
    ...clean.map((e) => stmt.bind(circuitId, e.season, e.round, e.race_name, JSON.stringify(e.podium))),
    env.DB.prepare(`INSERT OR IGNORE INTO track_meta (circuit_id, podiums_at) VALUES (?, ?)`).bind(circuitId, Date.now()),
  ]);
  return true;
}

// stats: { laps, lead_changes, leaders, overtakes } (all null when the race has no lap data)
export async function saveEditionStats(env, round, edSeason, stats) {
  const circuitId = await raceCircuit(env, round);
  if (!circuitId) return false;
  const v = { laps: int(stats.laps, 120), lead_changes: int(stats.lead_changes, 150), leaders: int(stats.leaders, 25), overtakes: int(stats.overtakes, 600) };
  const allNull = ['laps', 'lead_changes', 'leaders', 'overtakes'].every((k) => stats[k] === null);
  if (!allNull && Object.values(v).some((x) => x === null)) return false; // all four numbers, or none (no lap data)
  await env.DB.prepare(
    `UPDATE track_history SET laps=?, lead_changes=?, leaders=?, overtakes=?, stats_done=1 WHERE circuit_id=? AND season=? AND stats_done=0`
  ).bind(v.laps, v.lead_changes, v.leaders, v.overtakes, circuitId, Number(edSeason)).run();
  return true;
}

// -------------------------------------------------------------- API answer

export async function getRaceInsights(env, round) {
  const race = await env.DB.prepare(
    `SELECT round, name, circuit_id, race_ts, quali_ts, f1_meeting_id, f1_slug FROM races WHERE round=?`
  ).bind(round).first();
  if (!race) return null;
  await liveQualifyingCheck(env, race);
  const t = Date.now();
  const checked = await env.DB.prepare(`SELECT quali_checked_at FROM races WHERE round=?`).bind(round).first();

  const { results: rows } = await env.DB.prepare(
    `SELECT position, pos_text, number, code, driver_id, name, team, q1, q2, q3, laps, grid, source, fetched_at FROM qualifying WHERE round=? ORDER BY position`
  ).bind(round).all();
  const qualiTs = race.quali_ts || null;
  let status = 'published';
  if (!rows.length) status = qualiTs && qualiTs < t ? 'waiting' : 'not_yet';
  const link = race.f1_meeting_id ? `${F1}/en/results/${season(env)}/races/${race.f1_meeting_id}/${race.f1_slug}/qualifying` : null;

  const { results: hist } = await env.DB.prepare(
    `SELECT season, round, race_name, podium, laps, lead_changes, leaders, overtakes, stats_done FROM track_history
     WHERE circuit_id=? ORDER BY season DESC LIMIT ?`
  ).bind(race.circuit_id, HISTORY_YEARS).all();
  const meta = await env.DB.prepare(`SELECT podiums_at FROM track_meta WHERE circuit_id=?`).bind(race.circuit_id).first();

  return {
    qualifying: { status, quali_ts: qualiTs, link, checked_at: checked?.quali_checked_at || null, live: race.race_ts > t && (qualiTs || race.race_ts - 86400000) <= t, source: rows[0]?.source || null, updated_at: rows[0]?.fetched_at || null, rows: rows.map(({ source, fetched_at, ...r }) => r) },
    history: {
      circuit_id: race.circuit_id,
      season: season(env),
      years: HISTORY_YEARS,
      status: !meta ? 'loading' : hist.length ? (hist.every((h) => h.stats_done) ? 'ready' : 'partial') : 'none',
      editions: hist.map((h) => ({ ...h, podium: JSON.parse(h.podium || '[]'), stats_done: !!h.stats_done })),
    },
  };
}
