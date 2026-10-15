// Championship standings for sorting the driver picker: last season (drivers + teams) and the
// current season (drivers + teams). Read from the formula1.com results pages, e.g.
//   https://www.formula1.com/en/results/2025/drivers   and   .../2025/team
// (the Jolpica API turns the Cloudflare servers away). Last season is read once; the current
// season is re-read every 3 hours by the scheduled sync.

const F1 = 'https://www.formula1.com';
const UA = 'Mozilla/5.0 (compatible; f1-vietiniai-predictions/1.0; +https://f1vietiniaiprediction.f1vietiniai.workers.dev)';
const CURRENT_EVERY = 3 * 3600 * 1000;
const season = (env) => Number(env.SEASON || new Date().getUTCFullYear());

const cellText = (html) =>
  html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ').trim();

function tableRows(html, minCells) {
  const start = html.indexOf('<tbody');
  if (start < 0) return [];
  const body = html.slice(start, html.indexOf('</tbody>', start));
  return body.split(/<tr[\s>]/).slice(1)
    .map((tr) => [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => cellText(m[1])))
    .filter((c) => c.length >= minCells);
}

// Drivers page columns: Pos, Driver ("Lando Norris" + "NOR"), Nationality, Team, Pts.
export function parseDriverStandings(html) {
  return tableRows(html, 5).map((t) => {
    const m = t[1].match(/([A-Z]{3})$/);
    return { position: Number(t[0]) || null, code: m ? m[1] : null, name: m ? t[1].slice(0, -3).trim() : t[1], team: t[3] || null, points: Number(t[4]) || 0 };
  });
}
// Teams page columns: Pos, Team, Pts.
export function parseTeamStandings(html) {
  return tableRows(html, 3).map((t) => ({ position: Number(t[0]) || null, code: null, name: t[1], team: t[1], points: Number(t[2]) || 0 }));
}

async function fetchKind(env, year, kind) {
  const res = await fetch(`${env.F1_BASE || F1}/en/results/${year}/${kind === 'drivers' ? 'drivers' : 'team'}`, { headers: { 'User-Agent': UA, accept: 'text/html' } });
  if (!res.ok) throw new Error(`standings ${year} ${kind} -> HTTP ${res.status}`);
  const html = await res.text();
  return kind === 'drivers' ? parseDriverStandings(html) : parseTeamStandings(html);
}

async function store(env, year, kind, rows) {
  const t = Date.now();
  const stmt = env.DB.prepare(
    `INSERT INTO standings (season, kind, position, code, name, team, points, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM standings WHERE season=? AND kind=?`).bind(year, kind),
    ...rows.map((r, i) => stmt.bind(year, kind, r.position || i + 1, r.code, r.name, r.team, r.points, t)),
  ]);
}

// budget: object with take() (see Budget in insights.js). Returns how many tables were refreshed.
export async function syncStandings(env, budget, { force = false } = {}) {
  const now = season(env);
  const { results } = await env.DB.prepare(
    `SELECT season, kind, MAX(fetched_at) AS at FROM standings WHERE season IN (?, ?) GROUP BY season, kind`
  ).bind(now - 1, now).all();
  const at = (y, k) => results.find((r) => r.season === y && r.kind === k)?.at || 0;
  let done = 0;
  for (const [year, kind] of [[now - 1, 'drivers'], [now - 1, 'teams'], [now, 'drivers'], [now, 'teams']]) {
    const stale = year < now ? !at(year, kind) : force || Date.now() - at(year, kind) > CURRENT_EVERY;
    if (!stale || !budget.take()) continue;
    try {
      const rows = await fetchKind(env, year, kind);
      if (rows.length) { await store(env, year, kind, rows); done++; }
    } catch (e) { console.error(e.message); }
  }
  return done;
}

export async function getStandings(env) {
  const now = season(env);
  const { results } = await env.DB.prepare(
    `SELECT season, kind, position, code, name, team, points FROM standings WHERE season IN (?, ?) ORDER BY season, kind, position`
  ).bind(now - 1, now).all();
  const pick = (y, k) => results.filter((r) => r.season === y && r.kind === k).map(({ season: _s, kind: _k, ...r }) => r);
  return {
    last: { season: now - 1, drivers: pick(now - 1, 'drivers'), teams: pick(now - 1, 'teams') },
    current: { season: now, drivers: pick(now, 'drivers'), teams: pick(now, 'teams') },
  };
}
