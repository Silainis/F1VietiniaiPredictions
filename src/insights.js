// Race page extras: the qualifying classification and the history of the race at this circuit.
//
// Qualifying comes from the formula1.com results pages, e.g.
//   https://www.formula1.com/en/results/2026/races/1296/singapore/qualifying
// The number in that address (the "meeting id") is not simply round + something: it skips
// numbers when the calendar changes. So the ids are read once from the season results page
// (https://www.formula1.com/en/results/2026/races) and stored with each race. If formula1.com
// cannot be read, the Jolpica F1 API (same data, published a little later) is used instead.
//
// Track history uses the Jolpica F1 API: the podium of the last 5 editions at the circuit, plus
// lead changes and overtakes worked out from the lap-by-lap positions. Overtakes are an estimate
// (see lapStats below); passes on the opening lap are not included. Past races do not
// change, so every edition is fetched once and kept in the database.

const F1 = 'https://www.formula1.com';
const UA = 'Mozilla/5.0 (compatible; f1-vietiniai-predictions/1.0; +https://f1vietiniaiprediction.f1vietiniai.workers.dev)';
const HISTORY_YEARS = 5;
// A full edition needs about 15 requests (lap pages + pit stops); only start one with room to finish it.
const EDITION_COST = 18;

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

async function getJolpica(env, path) {
  const gap = env.JOLPICA_DELAY_MS !== undefined ? Number(env.JOLPICA_DELAY_MS) : 350;
  for (let attempt = 0; attempt < 2; attempt++) {
    await sleep(gap);
    const res = await fetch(`${jolpica(env)}${path}`, { headers: { 'User-Agent': UA, accept: 'application/json' } });
    if (res.status === 429 && attempt === 0) { await sleep(2000); continue; }
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

// Qualifying page -> rows. An empty list means the results are not published yet
// (the page then shows "No results available").
export function parseQualifying(html) {
  const tbody = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
  if (!tbody) return [];
  const rows = [];
  for (const tr of tbody[1].split(/<tr[\s>]/).slice(1)) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length < 8) continue;
    const t = cells.map(cellText);
    const codeMatch = t[2].match(/([A-Z]{3})$/);
    const code = codeMatch ? codeMatch[1] : null;
    const name = code ? t[2].slice(0, -3).trim() : t[2];
    const time = (s) => (/^\d+:\d{2}\.\d{3}$/.test(s) ? s : null);
    rows.push({
      pos_text: t[0], number: t[1] || null, code, name, team: t[3] || null,
      q1: time(t[4]), q2: time(t[5]), q3: time(t[6]), laps: /^\d+$/.test(t[7]) ? Number(t[7]) : null,
    });
  }
  return rows;
}

async function qualifyingFromF1(env, race) {
  const html = await getPage(env, `/en/results/${season(env)}/races/${race.f1_meeting_id}/${race.f1_slug}/qualifying`);
  return parseQualifying(html);
}

async function qualifyingFromJolpica(env, race) {
  const data = await getJolpica(env, `/${season(env)}/${race.round}/qualifying.json?limit=100`);
  const list = data.MRData.RaceTable.Races?.[0]?.QualifyingResults || [];
  return list.map((q) => ({
    pos_text: String(q.position), number: q.number || null, code: q.Driver.code || null,
    name: `${q.Driver.givenName} ${q.Driver.familyName}`, team: q.Constructor?.name || null,
    q1: q.Q1 || null, q2: q.Q2 || null, q3: q.Q3 || null, laps: null, driver_id: q.Driver.driverId,
  }));
}

// Checks every race whose qualifying has taken place but is not stored yet (newest first).
// Runs every 30 minutes, so results show up on the race page shortly after they are published.
// Old races without results are retried for two weeks after the race, then left alone. Fresh results
// are read once more about two hours later, so late penalties or disqualifications are picked up.
export async function syncQualifying(env, budget, maxRaces = 3) {
  const t = Date.now();
  try { await syncMeetingIds(env, budget); } catch (e) { console.error('Meeting ids', e.message); }

  const { results: due } = await env.DB.prepare(
    `SELECT round, name, f1_meeting_id, f1_slug, race_ts, quali_ts FROM races r
     WHERE COALESCE(quali_ts, race_ts - 86400000) + 3600000 < ?
       AND (race_ts > ? OR quali_checked_at IS NULL)
       AND (NOT EXISTS (SELECT 1 FROM qualifying q WHERE q.round = r.round)
         -- one more look a couple of hours later, in case stewards changed the classification
         OR (race_ts > ? AND EXISTS (SELECT 1 FROM qualifying q WHERE q.round = r.round AND q.position = 1
               AND q.fetched_at < COALESCE(r.quali_ts, r.race_ts - 86400000) + 6 * 3600000 AND q.fetched_at < ?)))
     ORDER BY round DESC LIMIT ?`
  ).bind(t, t - 14 * 86400000, t, t - 2 * 3600000, maxRaces).all();

  let stored = 0;
  for (const race of due) {
    let rows = [];
    let source = null;
    if (race.f1_meeting_id && budget.take()) {
      try { rows = await qualifyingFromF1(env, race); source = 'formula1.com'; } catch (e) { console.error('F1 qualifying', race.round, e.message); }
    }
    if (!rows.length && budget.take()) {
      try { rows = await qualifyingFromJolpica(env, race); source = 'jolpica'; } catch (e) { console.error('Jolpica qualifying', race.round, e.message); }
    }
    await env.DB.prepare(`UPDATE races SET quali_checked_at=? WHERE round=?`).bind(t, race.round).run();
    if (!rows.length) continue;
    await storeQualifying(env, race.round, rows, source); // a refresh that finds nothing keeps the stored rows
    stored++;
  }
  return stored;
}

async function storeQualifying(env, round, rows, source) {
  const { results: drivers } = await env.DB.prepare(`SELECT driver_id, code, number FROM drivers`).all();
  const byCode = new Map(drivers.filter((d) => d.code).map((d) => [d.code, d.driver_id]));
  const byNumber = new Map(drivers.filter((d) => d.number).map((d) => [String(d.number), d.driver_id]));
  const stmt = env.DB.prepare(
    `INSERT OR REPLACE INTO qualifying (round, position, pos_text, number, code, driver_id, name, team, q1, q2, q3, laps, source, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM qualifying WHERE round=?`).bind(round),
    ...rows.map((r, i) =>
      stmt.bind(round, i + 1, r.pos_text, r.number, r.code,
        r.driver_id || byCode.get(r.code) || byNumber.get(String(r.number)) || null,
        r.name, r.team, r.q1, r.q2, r.q3, r.laps, source, Date.now())
    ),
  ]);
}

// ----------------------------------------------------------- track history

// Lap-by-lap positions -> lead changes, number of different leaders and estimated overtakes.
// laps: [{ number, Timings: [{ driverId, position, time }] }], pitLaps: Set of "driverId:lap".
// A position swap between two laps counts as an overtake unless the passed or passing driver was in
// the pits on that lap or the lap after (in-lap / out-lap), or the passed driver was more than 15%
// slower than the field that lap (damage, a spin or retiring). Checked against real races: Monaco
// 2024 gives 7 and Singapore 2025 gives 28, without the pit filter Singapore would show over 100.
const SLOW = 1.15;
const lapSeconds = (s) => {
  const m = String(s || '').match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  return m ? Number(m[1] || 0) * 60 + Number(m[2]) : null;
};
export function lapStats(laps, pitLaps) {
  const sorted = [...laps].sort((a, b) => Number(a.number) - Number(b.number));
  let leadChanges = 0;
  let overtakes = 0;
  const leaders = new Set();
  let prev = null;
  for (const lap of sorted) {
    const n = Number(lap.number);
    const pos = new Map(lap.Timings.map((t) => [t.driverId, Number(t.position)]));
    const secs = new Map(lap.Timings.map((t) => [t.driverId, lapSeconds(t.time)]));
    const times = [...secs.values()].filter(Boolean).sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    const slow = (id) => median && secs.get(id) > median * SLOW;
    const inPits = (id) => pitLaps.has(`${id}:${n}`) || pitLaps.has(`${id}:${n - 1}`);
    const leader = lap.Timings.find((t) => Number(t.position) === 1)?.driverId;
    if (leader) leaders.add(leader);
    if (prev) {
      if (leader && prev.leader && leader !== prev.leader) leadChanges++;
      const ids = [...pos.keys()].filter((id) => prev.pos.has(id) && !inPits(id));
      for (const a of ids) {
        for (const b of ids) {
          if (a !== b && prev.pos.get(a) > prev.pos.get(b) && pos.get(a) < pos.get(b) && !slow(b)) overtakes++;
        }
      }
    }
    prev = { leader, pos };
  }
  return { laps: sorted.length, lead_changes: leadChanges, leaders: leaders.size, overtakes };
}

// Podium of the last editions at a circuit (3 requests: winners, P2s, P3s across all years).
async function syncPodiums(env, budget, circuitId) {
  if (!budget.take(3)) return false;
  const byPos = [];
  for (const p of [1, 2, 3]) {
    const data = await getJolpica(env, `/circuits/${circuitId}/results/${p}.json?limit=100`);
    byPos.push(data.MRData.RaceTable.Races || []);
  }
  const editions = byPos[0].filter((r) => Number(r.season) < season(env)).slice(-HISTORY_YEARS);
  const stmt = env.DB.prepare(
    `INSERT INTO track_history (circuit_id, season, round, race_name, podium) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(circuit_id, season) DO UPDATE SET round=excluded.round, race_name=excluded.race_name, podium=excluded.podium`
  );
  const stmts = editions.map((r) => {
    const podium = byPos.map((list) => {
      const x = list.find((y) => y.season === r.season)?.Results?.[0];
      return x ? { driver_id: x.Driver.driverId, code: x.Driver.code || null, name: `${x.Driver.givenName} ${x.Driver.familyName}`, team: x.Constructor?.name || null, grid: Number(x.grid) || null } : null;
    });
    return stmt.bind(circuitId, Number(r.season), Number(r.round), r.raceName, JSON.stringify(podium));
  });
  stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO track_meta (circuit_id, podiums_at) VALUES (?, ?)`).bind(circuitId, Date.now()));
  await env.DB.batch(stmts);
  return true;
}

async function syncEditionStats(env, budget, ed) {
  const laps = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    if (!budget.take()) return false; // out of requests: try this edition again next run
    const data = await getJolpica(env, `/${ed.season}/${ed.round}/laps.json?limit=100&offset=${offset}`);
    total = Number(data.MRData.total) || 0;
    const page = data.MRData.RaceTable.Races?.[0]?.Laps || [];
    for (const lap of page) {
      const same = laps.find((l) => l.number === lap.number);
      if (same) same.Timings.push(...lap.Timings); // a lap can be split over two pages
      else laps.push({ number: lap.number, Timings: [...lap.Timings] });
    }
    offset += 100;
    if (!page.length) break;
  }
  const pitLaps = new Set();
  if (laps.length && budget.take()) {
    try {
      const data = await getJolpica(env, `/${ed.season}/${ed.round}/pitstops.json?limit=100`);
      for (const p of data.MRData.RaceTable.Races?.[0]?.PitStops || []) pitLaps.add(`${p.driverId}:${p.lap}`);
    } catch (e) { console.error('Pit stops', ed.season, ed.round, e.message); }
  }
  const s = laps.length ? lapStats(laps, pitLaps) : { laps: null, lead_changes: null, leaders: null, overtakes: null };
  await env.DB.prepare(
    `UPDATE track_history SET laps=?, lead_changes=?, leaders=?, overtakes=?, stats_done=1 WHERE circuit_id=? AND season=?`
  ).bind(s.laps, s.lead_changes, s.leaders, s.overtakes, ed.circuit_id, ed.season).run();
  return true;
}

// Fills the history circuit by circuit: upcoming races first (next race first), then the rest.
export async function syncTrackHistory(env, budget) {
  const { results: circuits } = await env.DB.prepare(
    `SELECT circuit_id, MIN(race_ts) AS ts, MAX(race_ts) > ? AS upcoming FROM races WHERE circuit_id IS NOT NULL
     GROUP BY circuit_id ORDER BY upcoming DESC, ts`
  ).bind(Date.now() - 86400000).all();
  let editions = 0;
  for (const c of circuits) {
    const meta = await env.DB.prepare(`SELECT podiums_at FROM track_meta WHERE circuit_id=?`).bind(c.circuit_id).first();
    if (!meta) {
      try {
        if (!(await syncPodiums(env, budget, c.circuit_id))) break;
      } catch (e) { console.error('Podiums', c.circuit_id, e.message); continue; }
    }
    const { results: todo } = await env.DB.prepare(
      `SELECT circuit_id, season, round FROM track_history WHERE circuit_id=? AND stats_done=0 ORDER BY season DESC`
    ).bind(c.circuit_id).all();
    for (const ed of todo) {
      if (budget.left < EDITION_COST) return editions;
      try {
        if (await syncEditionStats(env, budget, ed)) editions++;
      } catch (e) { console.error('Lap stats', ed.season, ed.round, e.message); }
    }
  }
  return editions;
}

// -------------------------------------------------------------- API answer

export async function getRaceInsights(env, round) {
  const race = await env.DB.prepare(
    `SELECT round, name, circuit_id, race_ts, quali_ts, f1_meeting_id, f1_slug FROM races WHERE round=?`
  ).bind(round).first();
  if (!race) return null;
  const t = Date.now();

  const { results: rows } = await env.DB.prepare(
    `SELECT position, pos_text, number, code, driver_id, name, team, q1, q2, q3, laps, source, fetched_at FROM qualifying WHERE round=? ORDER BY position`
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
    qualifying: { status, quali_ts: qualiTs, link, source: rows[0]?.source || null, updated_at: rows[0]?.fetched_at || null, rows: rows.map(({ source, fetched_at, ...r }) => r) },
    history: {
      status: !meta ? 'loading' : hist.length ? (hist.every((h) => h.stats_done) ? 'ready' : 'partial') : 'none',
      editions: hist.map((h) => ({ ...h, podium: JSON.parse(h.podium || '[]'), stats_done: !!h.stats_done })),
    },
  };
}
