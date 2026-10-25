// Race results.
//
// Main source: the formula1.com race-result page, e.g.
//   https://www.formula1.com/en/results/2026/races/1297/united-states/race-result
// (meeting id + slug as for qualifying, see src/insights.js). It is published minutes after the race,
// much sooner than the Jolpica F1 API, and Jolpica often turns the Worker away (HTTP 429), so Jolpica is
// only the fallback.
//
// When results are checked:
//  - cron (every 30 min): races that started 75+ minutes ago and have no results yet, and, for 3 days
//    after a race, a re-check every 2 hours to pick up penalties given after the race;
//  - "Check results" button on the race page: right away, at most once a minute for everybody together.
// When the stored classification changes, it is replaced and the players are told. Points are always
// worked out from the stored results (src/scoring.js), so every score follows automatically.

import { Budget, getPage, tableRows, f1Path, season, syncMeetingIds, RateLimited } from './insights.js';

const MIN = 60000;
const FIRST_CHECK = 75 * MIN; // races last about 1.5 h; checking earlier is harmless (nothing is published yet)
const WATCH_FOR = 3 * 24 * 60 * MIN; // keep re-checking for penalties this long after the race
const RECHECK_EVERY = 120 * MIN;
const BUTTON_EVERY = MIN;
const UA = 'f1-vietiniai-predictions/1.0 (https://f1vietiniaiprediction.f1vietiniai.workers.dev)';
const jolpicaBase = (env) => env.JOLPICA_BASE || 'https://api.jolpi.ca/ergast/f1';

// formula1.com: Pos | No | Driver | Team | Laps | Time/Retired | Pts
// Pos is a number, "NC" (not classified: Time/Retired says DNF, DNS or a gap) or "DQ".
// pos_text uses the Jolpica codes the scoring understands: number, R (retired), W (did not start),
// N (not classified but running), D (disqualified).
export function parseRaceResult(html) {
  return tableRows(html, 6).map((t, i) => {
    const pos = t[0].trim().toUpperCase();
    const info = (t[5] || '').trim();
    const code = (t[2].match(/([A-Z]{3})$/) || [])[1] || null;
    let posText, status;
    if (/^\d+$/.test(pos)) { posText = pos; status = info || 'Finished'; }
    else if (pos === 'DQ' || /^(DSQ|DQ)$/i.test(info)) { posText = 'D'; status = 'Disqualified'; }
    else if (/DNS/i.test(info)) { posText = 'W'; status = 'Did not start'; }
    else if (/DNF/i.test(info) || info === '') { posText = 'R'; status = 'Retired'; }
    else { posText = 'N'; status = `Not classified (${info})`; }
    return { position: i + 1, pos_text: posText, status, number: t[1] || null, code, team: t[3] || null, laps: /^\d+$/.test(t[4] || '') ? Number(t[4]) : null };
  }).filter((r) => r.code || r.number);
}

async function fromF1(env, race) {
  if (!race.f1_meeting_id) return null;
  const rows = parseRaceResult(await getPage(env, f1Path(env, race, 'race-result')));
  if (!rows.length) return null;
  const { results: drivers } = await env.DB.prepare(`SELECT driver_id, code, number FROM drivers`).all();
  const byCode = new Map(drivers.filter((d) => d.code).map((d) => [d.code, d.driver_id]));
  const byNumber = new Map(drivers.filter((d) => d.number).map((d) => [String(d.number), d.driver_id]));
  for (const r of rows) r.driver_id = byCode.get(r.code) || byNumber.get(String(r.number)) || null;
  // a driver we do not know yet (new stand-in): let Jolpica give the full set instead
  if (rows.some((r) => !r.driver_id)) {
    console.error('F1 result: unknown drivers', rows.filter((r) => !r.driver_id).map((r) => r.code).join(','));
    return null;
  }
  return rows;
}

async function fromJolpica(env, race) {
  const res = await fetch(`${jolpicaBase(env)}/${season(env)}/${race.round}/results.json?limit=100`, { headers: { 'User-Agent': UA, accept: 'application/json' } });
  if (res.status === 429) throw new RateLimited('Jolpica results -> HTTP 429');
  if (!res.ok) throw new Error(`Jolpica results -> HTTP ${res.status}`);
  const list = (await res.json()).MRData.RaceTable.Races?.[0]?.Results || [];
  return list.map((r) => ({
    driver_id: r.Driver.driverId, position: Number(r.position), pos_text: String(r.positionText), status: r.status,
    team: r.Constructor?.name || null, code: r.Driver.code || null, number: r.Driver.permanentNumber || r.number || null,
    name: `${r.Driver.givenName} ${r.Driver.familyName}`, url: r.Driver.url || null,
  }));
}

// Fetches and stores. Returns 'new' | 'updated' | 'same' | 'none' (nothing published yet).
export async function checkRaceResult(env, race, budget = new Budget(2)) {
  let rows = null;
  let source = null;
  if (budget.take()) {
    try { rows = await fromF1(env, race); source = 'formula1.com'; } catch (e) { console.error('F1 result', race.round, e.message); }
  }
  if (!rows && budget.take()) {
    try { rows = await fromJolpica(env, race); source = 'jolpica'; } catch (e) { console.error('Jolpica result', race.round, e.message); }
  }
  await env.DB.prepare(`UPDATE races SET results_checked_at=? WHERE round=?`).bind(Date.now(), race.round).run();
  if (!rows || !rows.length) return 'none';
  return storeResult(env, race, rows, source);
}

const key = (rows) => rows.map((r) => `${r.driver_id}:${r.pos_text}`).sort().join('|');

async function storeResult(env, race, rows, source) {
  const { results: old } = await env.DB.prepare(`SELECT driver_id, pos_text FROM results WHERE round=?`).bind(race.round).all();
  // same classification already stored (from either source): nothing to do
  if (old.length && key(old) === key(rows)) {
    await env.DB.prepare(`UPDATE races SET results_source=COALESCE(results_source, ?) WHERE round=?`).bind(source, race.round).run();
    return 'same';
  }
  const stmts = [env.DB.prepare(`DELETE FROM results WHERE round=?`).bind(race.round)];
  for (const r of rows) {
    if (r.name) {
      // Jolpica rows carry the driver itself, so a new stand-in is added to the drivers list
      stmts.push(env.DB.prepare(
        `INSERT INTO drivers (driver_id, code, number, name, wiki_url) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(driver_id) DO UPDATE SET code=excluded.code, number=excluded.number, name=excluded.name, wiki_url=COALESCE(excluded.wiki_url, drivers.wiki_url)`
      ).bind(r.driver_id, r.code, r.number, r.name, r.url));
    }
    if (r.team) stmts.push(env.DB.prepare(`UPDATE drivers SET team=? WHERE driver_id=?`).bind(r.team, r.driver_id));
    stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO results (round, driver_id, position, pos_text, status) VALUES (?, ?, ?, ?, ?)`)
      .bind(race.round, r.driver_id, r.position, r.pos_text, r.status));
  }
  const t = Date.now();
  stmts.push(env.DB.prepare(`UPDATE races SET results_source=?, results_at=? WHERE round=?`).bind(source, t, race.round));
  stmts.push(env.DB.prepare(`INSERT INTO notifications (user_id, text, link, created_at) SELECT DISTINCT user_id, ?, '/', ? FROM members`).bind(
    old.length
      ? `The ${race.name} result was changed after the race (penalties or a correction). Points have been recalculated.`
      : `Results are in for the ${race.name}. Check the standings!`, t));
  await env.DB.batch(stmts);
  return old.length ? 'updated' : 'new';
}

const COLS = `round, name, race_ts, f1_meeting_id, f1_slug, results_checked_at`;

// Cron. Returns how many races got new or changed results.
export async function syncResults(env, budget) {
  const t = Date.now();
  try { await syncMeetingIds(env, budget); } catch (e) { console.error('Meeting ids', e.message); }
  const { results: due } = await env.DB.prepare(
    `SELECT ${COLS} FROM races r WHERE race_ts + ? < ? AND (
       NOT EXISTS (SELECT 1 FROM results x WHERE x.round = r.round)
       OR (race_ts > ? AND COALESCE(results_checked_at, 0) < ?))
     ORDER BY round DESC LIMIT 4`
  ).bind(FIRST_CHECK, t, t - WATCH_FOR, t - RECHECK_EVERY).all();
  let changed = 0;
  for (const race of due) {
    if (budget.left < 2) break;
    const r = await checkRaceResult(env, race, budget);
    if (r === 'new' || r === 'updated') changed++;
  }
  return changed;
}

// "Check results" button. Anyone logged in may press it; formula1.com is asked at most once a minute
// per race for everybody together, otherwise the stored state is returned.
export async function checkResultsNow(env, round) {
  const race = await env.DB.prepare(`SELECT ${COLS} FROM races WHERE round=?`).bind(round).first();
  if (!race) return null;
  const t = Date.now();
  if (race.race_ts > t) return { status: 'not_started' };
  const claim = await env.DB.prepare(`UPDATE races SET results_checked_at=? WHERE round=? AND COALESCE(results_checked_at, 0) < ?`)
    .bind(t, round, t - BUTTON_EVERY).run();
  if (!claim.meta.changes) return { status: 'too_soon', checked_at: race.results_checked_at };
  const status = await checkRaceResult(env, race, new Budget(2));
  return { status, checked_at: Date.now() };
}
