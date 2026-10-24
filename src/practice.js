// Practice sessions: the best lap of every driver in FP1, FP2 and FP3, read from the formula1.com
// results pages, e.g.
//   https://www.formula1.com/en/results/2026/races/1297/united-states/practice/1
// (meeting id + slug as for qualifying, see src/insights.js). The page lists the fastest driver's lap
// time and everybody else's gap to it ("+0.198s"), so the lap times are worked out from those.
// Sprint weekends have only one practice session.
//
// When it is read:
//  - cron (every 30 min): sessions of the current race weekend that have finished and are not stored
//    yet, plus one past race of the season without practice times per run (history for the analysis);
//  - race page Analytics tab opened: the same check right away, at most once a minute for everybody.

import { Budget, F1, getPage, tableRows, splitDriver, f1Path, season, syncMeetingIds } from './insights.js';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const SESSION_LENGTH = HOUR; // practice sessions last 60 minutes
const LIVE_EVERY = 60 * 1000;

// "1:32.274" -> 92274, "92.274" -> 92274
export function lapMs(s) {
  const m = String(s || '').trim().match(/^(?:(\d+):)?(\d{1,2})\.(\d{1,3})$/);
  if (!m) return null;
  return (Number(m[1] || 0) * 60 + Number(m[2])) * 1000 + Number(m[3].padEnd(3, '0'));
}
export function fmtLap(ms) {
  if (!ms && ms !== 0) return null;
  const min = Math.floor(ms / 60000);
  const sec = ((ms % 60000) / 1000).toFixed(3).padStart(6, '0');
  return `${min}:${sec}`;
}
// "+0.198s" -> 198, "+1:02.345" -> 62345
function gapMs(s) {
  const m = String(s || '').trim().match(/^\+\s*(?:(\d+):)?(\d+)\.(\d{1,3})\s*s?$/);
  if (!m) return null;
  return (Number(m[1] || 0) * 60 + Number(m[2])) * 1000 + Number(m[3].padEnd(3, '0'));
}

// Practice results page -> [{ pos_text, number, code, name, team, ms, laps }]
export function parsePractice(html) {
  const rows = tableRows(html, 5);
  let leader = null;
  return rows.map((t) => {
    const cell = t[4] || '';
    let ms = lapMs(cell);
    if (ms !== null && leader === null) leader = ms;
    else if (ms === null && leader !== null) {
      const g = gapMs(cell);
      ms = g === null ? null : leader + g;
    }
    return { pos_text: t[0], number: t[1] || null, ...splitDriver(t[2]), team: t[3] || null, ms, laps: /^\d+$/.test(t[5] || '') ? Number(t[5]) : null };
  });
}

// The practice sessions of a race weekend: [{ n, ts }] (ts may be null for an old calendar row).
export function sessionsOf(race) {
  const list = race.sprint ? [1] : [1, 2, 3];
  return list.map((n) => ({ n, ts: race[`fp${n}_ts`] || null }));
}

// A session is worth reading when it has finished and either nothing is stored or what is stored was
// read before the session ended (a page read while the session was running).
function needsFetch(race, s, stored, t) {
  const start = s.ts || race.race_ts - 2.5 * DAY;
  if (start + SESSION_LENGTH > t) return false;
  const at = stored.get(s.n);
  return !at || (s.ts && at < s.ts + SESSION_LENGTH + 5 * 60000);
}

async function storedSessions(env, round) {
  const { results } = await env.DB.prepare(`SELECT session, MAX(fetched_at) AS at FROM practice WHERE round=? GROUP BY session`).bind(round).all();
  return new Map(results.map((r) => [r.session, r.at]));
}

async function store(env, round, n, rows) {
  const { results: drivers } = await env.DB.prepare(`SELECT driver_id, code, number FROM drivers`).all();
  const byCode = new Map(drivers.filter((d) => d.code).map((d) => [d.code, d.driver_id]));
  const byNumber = new Map(drivers.filter((d) => d.number).map((d) => [String(d.number), d.driver_id]));
  const stmt = env.DB.prepare(
    `INSERT OR REPLACE INTO practice (round, session, position, pos_text, number, code, driver_id, name, team, time, ms, laps, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const t = Date.now();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM practice WHERE round=? AND session=?`).bind(round, n),
    ...rows.map((r, i) => stmt.bind(round, n, i + 1, r.pos_text, r.number, r.code,
      byCode.get(r.code) || byNumber.get(String(r.number)) || null, r.name, r.team, fmtLap(r.ms), r.ms, r.laps, t)),
  ]);
}

// Reads the sessions of one race that need it. Returns how many sessions were stored.
export async function refreshPractice(env, race, budget, { all = false } = {}) {
  if (!race.f1_meeting_id) return 0;
  const t = Date.now();
  const stored = await storedSessions(env, race.round);
  let done = 0;
  for (const s of sessionsOf(race)) {
    if (!(all ? !stored.get(s.n) && (s.ts || race.race_ts) < t : needsFetch(race, s, stored, t))) continue;
    if (!budget.take()) break;
    try {
      const rows = parsePractice(await getPage(env, f1Path(env, race, `practice/${s.n}`)));
      if (rows.length) { await store(env, race.round, s.n, rows); done++; }
    } catch (e) { console.error('F1 practice', race.round, s.n, e.message); }
  }
  return done;
}

const RACE_COLS = `round, name, race_ts, quali_ts, fp1_ts, fp2_ts, fp3_ts, sprint, f1_meeting_id, f1_slug, practice_checked_at`;

// Cron: the current race weekend, then one past race of the season that has no practice times yet.
export async function syncPractice(env, budget) {
  const t = Date.now();
  try { await syncMeetingIds(env, budget); } catch (e) { console.error('Meeting ids', e.message); }
  let stored = 0;
  const { results: current } = await env.DB.prepare(
    `SELECT ${RACE_COLS} FROM races WHERE race_ts > ? AND race_ts - ? < ? ORDER BY round`
  ).bind(t - 2 * DAY, 4 * DAY, t).all();
  for (const race of current) stored += await refreshPractice(env, race, budget);

  if (budget.left >= 3) {
    const past = await env.DB.prepare(
      `SELECT ${RACE_COLS} FROM races r WHERE race_ts < ? AND practice_checked_at IS NULL AND f1_meeting_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM practice p WHERE p.round = r.round) ORDER BY round DESC LIMIT 1`
    ).bind(t - 2 * DAY).first();
    if (past) {
      stored += await refreshPractice(env, past, budget, { all: true });
      await env.DB.prepare(`UPDATE races SET practice_checked_at=? WHERE round=?`).bind(t, past.round).run();
    }
  }
  return stored;
}

// Analytics tab opened: read what is due right away (at most once a minute for everybody together).
async function liveCheck(env, race) {
  const t = Date.now();
  const stored = await storedSessions(env, race.round);
  const isPast = race.race_ts < t - 2 * DAY;
  const due = isPast
    ? !race.practice_checked_at && stored.size < sessionsOf(race).length
    : sessionsOf(race).some((s) => needsFetch(race, s, stored, t));
  if (!due) return;
  const claim = await env.DB.prepare(`UPDATE races SET practice_checked_at=? WHERE round=? AND COALESCE(practice_checked_at, 0) < ?`)
    .bind(t, race.round, isPast ? 1 : t - LIVE_EVERY).run();
  if (!claim.meta.changes) return;
  try { await refreshPractice(env, race, new Budget(3), { all: isPast }); } catch (e) { console.error('Live practice', race.round, e.message); }
}

export async function getPractice(env, round) {
  const race = await env.DB.prepare(`SELECT ${RACE_COLS}, circuit_id, country, locality, circuit_name FROM races WHERE round=?`).bind(round).first();
  if (!race) return null;
  await liveCheck(env, race);
  const t = Date.now();
  const { results } = await env.DB.prepare(
    `SELECT session, position, pos_text, number, code, driver_id, name, team, time, ms, laps, fetched_at FROM practice WHERE round=? ORDER BY session, position`
  ).bind(round).all();
  const link = (n) => (race.f1_meeting_id ? `${F1}/en/results/${season(env)}/races/${race.f1_meeting_id}/${race.f1_slug}/practice/${n}` : null);
  return {
    race: { round: race.round, name: race.name, circuit_id: race.circuit_id, circuit_name: race.circuit_name, country: race.country, locality: race.locality, race_ts: race.race_ts, sprint: !!race.sprint, season: season(env) },
    sessions: sessionsOf(race).map((s) => {
      const rows = results.filter((r) => r.session === s.n).map(({ session, fetched_at, ...r }) => r);
      const start = s.ts || null;
      let status = 'published';
      if (!rows.length) status = start && start > t ? 'not_yet' : start && start + SESSION_LENGTH > t ? 'running' : 'waiting';
      return { n: s.n, ts: start, status, link: link(s.n), rows };
    }),
  };
}
