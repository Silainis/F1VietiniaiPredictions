// Race results.
//
// Only source (owner's rule): the official formula1.com race-result page, e.g.
//   https://www.formula1.com/en/results/2026/races/1297/united-states/race-result
// (meeting id + slug as for qualifying, see src/insights.js). Nothing is taken from Jolpica.
//
// When results are checked:
//  - cron (every 30 min): races that started 75+ minutes ago and have no results yet, and, for 3 days
//    after a race, a re-check every 2 hours to pick up penalties given after the race; also, until every
//    race has been confirmed by formula1.com, two older races per run (results stored before 2026-10-26
//    came from Jolpica);
//  - "Check results" button on the race page: right away, at most once a minute for everybody together.
// When the stored classification changes, it is replaced and the players are told. Points are always
// worked out from the stored results (src/scoring.js), so every score follows automatically.

import { Budget, getPage, tableRows, f1Path, syncMeetingIds } from './insights.js';

const MIN = 60000;
const FIRST_CHECK = 75 * MIN; // races last about 1.5 h; checking earlier is harmless (nothing is published yet)
const WATCH_FOR = 3 * 24 * 60 * MIN; // keep re-checking for penalties this long after the race
const RECHECK_EVERY = 120 * MIN;
const BUTTON_EVERY = MIN;

// formula1.com: Pos | No | Driver | Team | Laps | Time/Retired | Pts
// Pos is a number, "NC" (not classified: Time/Retired says DNF, DNS or a gap) or "DQ".
// pos_text uses the codes the scoring understands (src/scoring.js): number, R (retired), W (did not start),
// N (not classified but running), D (disqualified).
export function parseRaceResult(html) {
  return tableRows(html, 6).map((t, i) => {
    const pos = t[0].trim().toUpperCase();
    const info = (t[5] || '').trim();
    const code = (t[2].match(/([A-Z]{3})$/) || [])[1] || null;
    const name = code ? t[2].slice(0, -3).trim() : t[2].trim();
    let posText, status;
    if (/^\d+$/.test(pos)) { posText = pos; status = info || 'Finished'; }
    else if (pos === 'DQ' || /^(DSQ|DQ)$/i.test(info)) { posText = 'D'; status = 'Disqualified'; }
    else if (/DNS/i.test(info)) { posText = 'W'; status = 'Did not start'; }
    else if (/DNF/i.test(info) || info === '') { posText = 'R'; status = 'Retired'; }
    else { posText = 'N'; status = `Not classified (${info})`; }
    return { position: i + 1, pos_text: posText, status, number: t[1] || null, code, name, team: t[3] || null, laps: /^\d+$/.test(t[4] || '') ? Number(t[4]) : null };
  }).filter((r) => r.code || r.number);
}

async function fromF1(env, race) {
  if (!race.f1_meeting_id) return null;
  const rows = parseRaceResult(await getPage(env, f1Path(env, race, 'race-result')));
  if (!rows.length) return null;
  const { results: drivers } = await env.DB.prepare(`SELECT driver_id, code, number FROM drivers`).all();
  const byCode = new Map(drivers.filter((d) => d.code).map((d) => [d.code, d.driver_id]));
  const byNumber = new Map(drivers.filter((d) => d.number).map((d) => [String(d.number), d.driver_id]));
  const byName = new Map(drivers.map((d) => [plainName(d.name), d.driver_id]));
  for (const r of rows) {
    r.driver_id = byCode.get(r.code) || byNumber.get(String(r.number)) || byName.get(plainName(r.name)) || null;
    // a driver the app does not know yet (a stand-in): added to the drivers list under his surname
    if (!r.driver_id) { r.driver_id = newDriverId(r.name, drivers); r.isNew = true; drivers.push({ driver_id: r.driver_id }); }
  }
  return rows;
}

const plainName = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
function newDriverId(name, drivers) {
  const words = plainName(name).split(' ').filter(Boolean);
  const taken = new Set(drivers.map((d) => d.driver_id));
  const surname = words[words.length - 1] || 'driver';
  if (!taken.has(surname)) return surname;
  const full = words.join('_');
  return taken.has(full) ? `${full}_${Date.now() % 1000}` : full;
}

// Fetches and stores. Returns 'new' | 'updated' | 'same' | 'none' (nothing published yet).
export async function checkRaceResult(env, race, budget = new Budget(1)) {
  let rows = null;
  const source = 'formula1.com';
  if (budget.take()) {
    try { rows = await fromF1(env, race); } catch (e) { console.error('F1 result', race.round, e.message); }
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
    await env.DB.prepare(`UPDATE races SET results_source=? WHERE round=?`).bind(source, race.round).run();
    return 'same';
  }
  const stmts = [env.DB.prepare(`DELETE FROM results WHERE round=?`).bind(race.round)];
  for (const r of rows) {
    if (r.isNew) {
      stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO drivers (driver_id, code, number, name) VALUES (?, ?, ?, ?)`).bind(r.driver_id, r.code, r.number, r.name));
    }
    if (r.team) stmts.push(env.DB.prepare(`UPDATE drivers SET team=? WHERE driver_id=?`).bind(r.team, r.driver_id));
    stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO results (round, driver_id, position, pos_text, status) VALUES (?, ?, ?, ?, ?)`)
      .bind(race.round, r.driver_id, r.position, r.pos_text, r.status));
  }
  const t = Date.now();
  stmts.push(env.DB.prepare(`UPDATE races SET results_source=?, results_at=? WHERE round=?`).bind(source, t, race.round));
  // players are told about new results and about changes in the days after a race; an old race that
  // only gets its stored result confirmed against formula1.com is corrected without a message
  if (!old.length || race.race_ts > t - WATCH_FOR) {
    stmts.push(env.DB.prepare(`INSERT INTO notifications (user_id, text, link, created_at) SELECT DISTINCT user_id, ?, '/', ? FROM members`).bind(
      old.length
        ? `The ${race.name} result was changed after the race (penalties or a correction). Points have been recalculated.`
        : `Results are in for the ${race.name}. Check the standings!`, t));
  } else console.log('Result corrected from formula1.com', race.round);
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
  // results stored before 2026-10-26 came from Jolpica: confirm them against formula1.com, two per run
  if (due.length < 4) {
    const { results: older } = await env.DB.prepare(
      `SELECT ${COLS} FROM races r WHERE race_ts + ? < ? AND f1_meeting_id IS NOT NULL AND COALESCE(results_source, '') <> 'formula1.com'
         AND EXISTS (SELECT 1 FROM results x WHERE x.round = r.round) AND COALESCE(results_checked_at, 0) < ? ORDER BY round DESC LIMIT 2`
    ).bind(FIRST_CHECK, t, t - 6 * 60 * MIN).all();
    for (const r of older) if (!due.some((d) => d.round === r.round)) due.push(r);
  }
  let changed = 0;
  for (const race of due) {
    if (budget.left < 1) break;
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
  const status = await checkRaceResult(env, race, new Budget(1));
  return { status, checked_at: Date.now() };
}
