/* F1 Vietiniai Predictions - practice analytics (race page tab) and the driver analysis page.
   Loaded after app.js and uses its helpers (api, esc, avatar, state, raceCode, jolpica, ...).

   Data:
   - best practice laps per session: our server (/api/races/:round/practice, read from formula1.com)
   - season results, qualifying and practice ranks: our server (/api/season)
   - lap by lap times, sectors, tyres and car telemetry: OpenF1 (api.openf1.org, the same timing feed
     FastF1 uses). The browser asks OpenF1 directly; if that fails it goes through /api/openf1/*.
     OpenF1 publishes a session's data shortly after the session ends.
   - the driver's past races at this circuit: Jolpica F1 (asked by the browser, kept for a day). */
'use strict';

const TYRE_COLORS = { SOFT: '#ff3b30', MEDIUM: '#ffd60a', HARD: '#e9ebef', INTERMEDIATE: '#30d158', WET: '#0a84ff' };
const MAIN_COLOR = '#e10600';
const VS_COLOR = '#3b9eff';
const fmtLapMs = (ms) => (ms === null || ms === undefined || !isFinite(ms) ? '–' : `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`);
const fmtS = (s) => (s === null || s === undefined || !isFinite(s) ? '–' : s >= 60 ? fmtLapMs(Math.round(s * 1000)) : s.toFixed(3));
const fmtGapMs = (ms) => (ms === null || ms === undefined || !isFinite(ms) ? '' : `+${(ms / 1000).toFixed(3)}`);
const avgOf = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const medianOf = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fix1 = (v) => (v === null || v === undefined ? '–' : (Math.round(v * 10) / 10).toFixed(1));
const sessLabel = (n) => `FP${n}`;
// least squares slope of y over x
function slope(pts) {
  if (pts.length < 3) return null;
  const mx = avgOf(pts.map((p) => p.x)), my = avgOf(pts.map((p) => p.y));
  let num = 0, den = 0;
  for (const p of pts) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; }
  return den ? num / den : null;
}

// Team colour for any team name, also old names (Toro Rosso, Racing Point, Renault, Alfa Romeo...).
function teamColor(name) {
  const n = plain(name).replace(/[^a-z]/g, '');
  const extra = [['torosso', 'racing-bulls'], ['racingpoint', 'aston-martin'], ['forceindia', 'aston-martin'], ['renault', 'alpine'], ['lotus', 'alpine']];
  const hit = extra.find(([k]) => n.includes(k));
  const slugs = { redbull: 'red-bull-racing', rb: 'racing-bulls', audi: 'audi', haas: 'haas', alpine: 'alpine', aston: 'aston-martin', williams: 'williams', mercedes: 'mercedes', ferrari: 'ferrari', mclaren: 'mclaren', cadillac: 'cadillac' };
  const slug = hit ? hit[1] : slugs[teamKey(name)];
  return (teamBySlug(slug) || {}).color || '#8d95a5';
}
const teamChip = (name) => (name ? `<span class="tchip" style="--tc:${esc(teamColor(name))}">${esc(name)}</span>` : '');

// --------------------------------------------------------------- SVG chart
// series: [{ color, width, dash, line, points: [{ x, y, fill, r, hollow, title, gap, shape }] }]
function svgChart(o) {
  const W = o.W || 760, H = o.H || 260, L = o.L ?? 52, R = o.R ?? 14, T = o.T ?? 12, B = o.B ?? 26;
  const { xMin, xMax, yMin, yMax } = o;
  const x = (v) => L + ((v - xMin) / (xMax - xMin || 1)) * (W - L - R);
  const y = (v) => {
    const f = (v - yMin) / (yMax - yMin || 1);
    return o.invert ? T + f * (H - T - B) : T + (1 - f) * (H - T - B);
  };
  const clampY = (v) => Math.min(yMax, Math.max(yMin, v));
  let out = '';
  for (const b of o.bands || []) {
    out += `<rect x="${x(b.x1).toFixed(1)}" y="${T}" width="${Math.max(0, x(b.x2) - x(b.x1)).toFixed(1)}" height="${H - T - B}" fill="${b.fill || 'rgba(255,255,255,.03)'}"/>`;
    if (b.label) out += `<text x="${((x(b.x1) + x(b.x2)) / 2).toFixed(1)}" y="${T + 12}" text-anchor="middle" class="band">${esc(b.label)}</text>`;
  }
  for (const t of o.yTicks || []) out += `<line x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="#2a2e37"/><text x="${L - 6}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${esc(o.yFmt ? o.yFmt(t) : t)}</text>`;
  for (const t of o.xTicks || []) out += `<text x="${x(t.x).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="rc">${esc(t.label)}${t.title ? `<title>${esc(t.title)}</title>` : ''}</text>`;
  for (const h of o.hlines || []) out += `<line x1="${L}" x2="${W - R}" y1="${y(h.y).toFixed(1)}" y2="${y(h.y).toFixed(1)}" stroke="${h.color || '#4a505c'}" stroke-dasharray="${h.dash || '4 4'}"/>${h.label ? `<text x="${W - R - 4}" y="${(y(h.y) - 4).toFixed(1)}" text-anchor="end">${esc(h.label)}</text>` : ''}`;
  for (const s of o.series) {
    if (s.line !== false) {
      let d = '';
      let started = false;
      for (const p of s.points) {
        if (p.y === null || p.y === undefined || p.skipLine) { started = false; continue; }
        d += `${started && !p.gap ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(clampY(p.y)).toFixed(1)} `;
        started = true;
      }
      out += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} stroke-linejoin="round" opacity="${s.opacity || 1}"/>`;
    }
    for (const p of s.points) {
      if (p.y === null || p.y === undefined || p.noDot) continue;
      const cx = x(p.x).toFixed(1), cy = y(clampY(p.y)).toFixed(1), r = p.r || 3.2;
      const tip = p.title ? `<title>${esc(p.title)}</title>` : '';
      if (p.shape === 'x') out += `<g stroke="${p.stroke || '#ff7b72'}" stroke-width="2.2"><line x1="${cx - 4}" y1="${cy - 4}" x2="${+cx + 4}" y2="${+cy + 4}"/><line x1="${cx - 4}" y1="${+cy + 4}" x2="${+cx + 4}" y2="${cy - 4}"/>${tip}</g>`;
      else if (p.shape === 'star') out += `<text x="${cx}" y="${+cy + 5}" text-anchor="middle" class="star">★${tip}</text>`;
      else out += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${p.hollow ? 'none' : p.fill || s.color}" stroke="${p.stroke || s.color}" stroke-width="${p.hollow ? 1.4 : 1}">${tip}</circle>`;
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || 'chart')}">${out}</svg>`;
}
const niceTicks = (min, max, n = 5) => {
  const raw = (max - min) / n;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
};

// ===================================================== race page: Analytics
function practiceDrivers(p) {
  const map = new Map();
  for (const s of p.sessions) {
    const fastest = Math.min(...s.rows.map((r) => r.ms).filter(Boolean));
    for (const r of s.rows) {
      const k = r.code || r.name;
      if (!map.has(k)) map.set(k, { code: r.code, driver_id: r.driver_id, name: r.name, team: r.team, number: r.number, s: {} });
      const d = map.get(k);
      d.s[s.n] = { ...r, gap: r.ms && isFinite(fastest) ? r.ms - fastest : null, fastest: r.ms && r.ms === fastest };
      d.team = r.team || d.team; d.driver_id = d.driver_id || r.driver_id; d.number = r.number || d.number;
    }
  }
  const list = [...map.values()];
  for (const d of list) {
    const best = Object.values(d.s).filter((x) => x.ms).sort((a, b) => a.ms - b.ms)[0];
    d.best = best ? best.ms : null;
    d.bestIn = best ? Object.keys(d.s).find((n) => d.s[n] === best) : null;
  }
  list.sort((a, b) => (a.best ?? Infinity) - (b.best ?? Infinity));
  const top = list[0]?.best;
  list.forEach((d, i) => { d.rank = d.best ? i + 1 : null; d.gap = d.best && top ? d.best - top : null; });
  return list;
}

function analyticsPanel(p, lid) {
  const head = `<div class="row between"><h2>Practice analytics</h2><a class="btn primary small" href="/league/${lid}/race/${p.race.round}/analysis" data-link>Driver analysis →</a></div>`;
  const status = p.sessions.map((s) => {
    if (s.rows.length) return `<a class="chip green" href="${esc(s.link || '#')}" target="_blank" rel="noopener">${sessLabel(s.n)} ✓</a>`;
    if (s.status === 'not_yet') return `<span class="chip">${sessLabel(s.n)}${s.ts ? ` · ${fmtDate(s.ts)}` : ''}</span>`;
    if (s.status === 'running') return `<span class="chip amber">${sessLabel(s.n)} · on track now</span>`;
    return `<span class="chip amber">${sessLabel(s.n)} · waiting for results</span>`;
  }).join(' ');
  const sprintNote = p.race.sprint ? '<p class="muted small">Sprint weekend: there is only one practice session.</p>' : '';
  const drivers = practiceDrivers(p);
  if (!drivers.length) {
    return `<div class="panel">${head}<div class="facts">${status}</div>${sprintNote}<p class="muted">No practice times yet. Best laps from each session appear here as soon as formula1.com publishes them.</p></div>`;
  }
  const sess = p.sessions.filter((s) => s.rows.length).map((s) => s.n);
  const last = sess[sess.length - 1];
  const maxGap = Math.max(1, ...drivers.map((d) => d.gap || 0).filter((g) => g < 5000));
  const cell = (d, n) => {
    const x = d.s[n];
    if (!x) return `<td class="r"><span class="muted">–</span></td>`;
    if (!x.ms) return `<td class="r"><span class="muted">no time</span><div class="muted small">${x.laps ?? 0} laps</div></td>`;
    const cls = x.fastest ? ' fastest' : String(n) === d.bestIn ? ' pb' : '';
    return `<td class="r${cls}">${fmtLapMs(x.ms)}<div class="muted small">P${esc(x.pos_text)}${x.gap ? ` · ${fmtGapMs(x.gap)}` : ''}</div></td>`;
  };
  const trend = (d) => {
    const ps = sess.map((n) => d.s[n] && /^\d+$/.test(d.s[n].pos_text) && d.s[n].ms ? Number(d.s[n].pos_text) : null).filter((v) => v !== null);
    if (ps.length < 2) return '<span class="muted">–</span>';
    const diff = ps[0] - ps[ps.length - 1];
    const arrow = diff > 0 ? `<span class="up">▲${diff}</span>` : diff < 0 ? `<span class="down">▼${-diff}</span>` : '<span class="muted">＝</span>';
    return `<span class="muted small">P${ps[0]} → P${ps[ps.length - 1]}</span> ${arrow}`;
  };
  const rows = drivers.map((d) => `<tr><td class="num"><b>${d.rank ?? '–'}</b></td><td>${driverCell(d, 28)}</td>
    ${sess.map((n) => cell(d, n)).join('')}
    <td class="r"><b>${fmtLapMs(d.best)}</b>${d.gap ? `<div class="gapbar"><i style="width:${Math.min(100, Math.round((d.gap / maxGap) * 100))}%"></i></div>` : d.best ? '<div class="muted small">fastest</div>' : ''}</td>
    <td class="r">${trend(d)}</td>
    <td class="r num">${sess.reduce((a, n) => a + (d.s[n]?.laps || 0), 0)}</td></tr>`).join('');

  // quick facts
  const facts = [];
  const f = drivers[0];
  if (f?.best) facts.push(`Fastest of the weekend: <b>${esc(f.name)}</b> ${fmtLapMs(f.best)} in ${sessLabel(f.bestIn)}`);
  if (drivers[9]?.gap) facts.push(`Top 10 within <b>${(drivers[9].gap / 1000).toFixed(3)} s</b>`);
  const busiest = [...drivers].map((d) => ({ d, laps: sess.reduce((a, n) => a + (d.s[n]?.laps || 0), 0) })).sort((a, b) => b.laps - a.laps)[0];
  if (busiest?.laps) facts.push(`Most laps: <b>${esc(busiest.d.name)}</b> (${busiest.laps})`);
  if (sess.length > 1) {
    const imp = drivers.map((d) => {
      const a = d.s[sess[0]], b = d.s[last];
      return a && b && a.ms && b.ms && /^\d+$/.test(a.pos_text) && /^\d+$/.test(b.pos_text) ? { d, diff: Number(a.pos_text) - Number(b.pos_text) } : null;
    }).filter(Boolean).sort((a, b) => b.diff - a.diff)[0];
    if (imp && imp.diff > 0) facts.push(`Biggest climber: <b>${esc(imp.d.name)}</b> (${imp.diff} places, ${sessLabel(sess[0])} → ${sessLabel(last)})`);
  }
  return `<div class="panel">${head}<div class="facts">${status}</div>${sprintNote}
    ${facts.length ? `<div class="facts">${facts.map((x) => `<span>${x}</span>`).join('')}</div>` : ''}
    <div class="scroll"><table class="quali prac"><thead><tr><th>#</th><th>Driver</th>${sess.map((n) => `<th class="r">${sessLabel(n)}</th>`).join('')}<th class="r">Best</th><th class="r">Trend</th><th class="r">Laps</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted small" style="margin-top:8px">Best lap of each driver per practice session (purple: fastest in that session, bold: the driver's best of the weekend). # orders drivers by their best lap of the weekend. Practice times depend a lot on fuel load and tyres, so treat them as a hint. Source: formula1.com.</p></div>`;
}

// Race page: Qualifying / Analytics tabs (called from loadInsights in app.js).
let pracTimer = null;
async function loadAnalyticsTab(lid, round) {
  const box = document.getElementById('analytics-box');
  if (!box) return;
  if (!box.dataset.loaded) box.innerHTML = '<div class="panel muted small">Loading practice times…</div>';
  let p;
  try { p = await api(`/races/${round}/practice`); } catch { p = null; }
  if (!document.getElementById('analytics-box') || !raceCtx || raceCtx.round !== round) return;
  if (!p) { box.innerHTML = '<div class="panel muted small">Practice times could not be loaded right now.</div>'; return; }
  box.dataset.loaded = '1';
  box.innerHTML = analyticsPanel(p, lid);
  // keep asking while a session of this weekend is running or its results are awaited
  clearInterval(pracTimer);
  const pending = p.sessions.some((s) => !s.rows.length && s.status !== 'not_yet') && p.race.race_ts > nowTs();
  if (pending) {
    pracTimer = setInterval(() => {
      if (!document.getElementById('analytics-box') || !raceCtx || raceCtx.round !== round) { clearInterval(pracTimer); return; }
      if (!document.hidden && !document.getElementById('analytics-box').hidden) loadAnalyticsTab(lid, round);
    }, 120000);
  }
}

// ================================================================== OpenF1
const OPENF1 = 'https://api.openf1.org/v1/';
const of1Cache = new Map();
let of1Queue = Promise.resolve();
let of1Direct = true;
async function of1Fetch(path) {
  if (of1Direct) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(OPENF1 + path);
        if (res.status === 429) { await pause(1500 * (attempt + 1)); continue; }
        if (res.ok) return await res.json();
        if (res.status === 404) return [];
        break;
      } catch { of1Direct = false; break; } // blocked by the browser: use our server from now on
    }
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await api('/openf1/' + path); } catch (e) {
      if (e.status === 429) { await pause(2000 * (attempt + 1)); continue; }
      if (e.status === 404) return [];
      throw e;
    }
  }
  throw new Error('busy');
}
// requests go one after another with a short pause (OpenF1 allows a few per second)
function of1(path) {
  if (!of1Cache.has(path)) {
    const run = of1Queue.then(() => of1Fetch(path));
    of1Queue = run.catch(() => {}).then(() => pause(300));
    of1Cache.set(path, run);
    run.catch(() => of1Cache.delete(path));
  }
  return of1Cache.get(path);
}
const isoQ = (ms) => encodeURIComponent(new Date(ms).toISOString());

// session keys of this weekend's practice sessions: { 1: key, 2: key, 3: key }
async function of1Sessions(year, raceTs) {
  const list = await of1(`sessions?year=${year}&session_type=Practice`);
  const out = {};
  for (const s of list || []) {
    const t = Date.parse(s.date_start);
    if (t > raceTs - 5 * 86400000 && t < raceTs) {
      const m = String(s.session_name || '').match(/(\d)/);
      if (m) out[Number(m[1])] = s.session_key;
    }
  }
  return out;
}
async function of1Number(sessionKey, code) {
  const list = await of1(`drivers?session_key=${sessionKey}`);
  const d = (list || []).find((x) => x.name_acronym === code);
  return d ? d.driver_number : null;
}
// all laps of one driver in one session, with the tyre of each lap
async function of1Laps(sessionKey, code) {
  const num = await of1Number(sessionKey, code);
  if (!num) return null;
  const [laps, stints] = await Promise.all([of1(`laps?session_key=${sessionKey}&driver_number=${num}`), of1(`stints?session_key=${sessionKey}&driver_number=${num}`)]);
  const stintOf = (n) => (stints || []).find((s) => n >= s.lap_start && n <= (s.lap_end ?? 999));
  return { num, laps: (laps || []).sort((a, b) => a.lap_number - b.lap_number).map((l) => {
    const st = stintOf(l.lap_number);
    return { n: l.lap_number, t: l.lap_duration, s1: l.duration_sector_1, s2: l.duration_sector_2, s3: l.duration_sector_3, trap: l.st_speed,
      pitOut: !!l.is_pit_out_lap, start: l.date_start ? Date.parse(l.date_start) : null, tyre: st?.compound || null, stint: st?.stint_number || null,
      age: st ? (st.tyre_age_at_start || 0) + (l.lap_number - st.lap_start) : null };
  }) };
}
// telemetry of one lap: samples with distance (m), time from lap start (s), speed, throttle, brake, gear
async function of1Telemetry(sessionKey, num, lap) {
  if (!lap || !lap.start || !lap.t) return null;
  const from = lap.start, to = lap.start + lap.t * 1000;
  const raw = await of1(`car_data?session_key=${sessionKey}&driver_number=${num}&date>=${isoQ(from - 300)}&date<=${isoQ(to + 300)}`);
  const pts = (raw || []).map((c) => ({ ts: Date.parse(c.date), speed: c.speed, thr: c.throttle, brake: c.brake > 0 ? 1 : 0, gear: c.n_gear, drs: c.drs }))
    .filter((c) => c.ts >= from && c.ts <= to).sort((a, b) => a.ts - b.ts);
  if (pts.length < 20) return null;
  let dist = 0;
  pts.forEach((p, i) => {
    if (i) dist += ((pts[i - 1].speed + p.speed) / 2 / 3.6) * ((p.ts - pts[i - 1].ts) / 1000);
    p.d = dist; p.time = (p.ts - from) / 1000;
  });
  return pts;
}

// valid laps: timed, not out of the pits, within 107% of the driver's best in that session
function lapSets(laps) {
  const timed = laps.filter((l) => l.t && !l.pitOut);
  const best = Math.min(...timed.map((l) => l.t));
  for (const l of laps) l.valid = !!(l.t && !l.pitOut && l.t <= best * 1.07);
  return { best: isFinite(best) ? best : null, valid: laps.filter((l) => l.valid) };
}
// long runs: a stint with 5+ valid laps in a row (first lap of the stint left out)
function longRuns(laps) {
  const byStint = {};
  for (const l of laps) if (l.stint) (byStint[l.stint] ||= []).push(l);
  const out = [];
  for (const [stint, list] of Object.entries(byStint)) {
    const v = list.slice(1).filter((l) => l.valid);
    if (v.length >= 5) {
      // keep laps within 103% of the stint's median (drops cool-down laps in the middle of a run)
      const med = medianOf(v.map((l) => l.t));
      const run = v.filter((l) => l.t <= med * 1.03);
      if (run.length >= 5) out.push({ stint: Number(stint), session: list[0].session || null, tyre: list[0].tyre, laps: run.length, avg: avgOf(run.map((l) => l.t)), deg: slope(run.map((l) => ({ x: l.n, y: l.t }))), from: run[0].n, to: run[run.length - 1].n });
    }
  }
  return out;
}

// =========================================================== analysis page
let an = null;
async function analysisView(lid, round) {
  const [prac, season] = await Promise.all([api(`/races/${round}/practice`), api('/season'), state.drivers ? null : loadDrivers()]);
  state.offset = season.server_time - Date.now();
  const params = new URLSearchParams(location.search);
  // the drivers to choose from: everyone in this weekend's practice plus this season's drivers
  const pd = practiceDrivers(prac);
  const list = [];
  const seen = new Set();
  for (const d of pd) { if (d.code && !seen.has(d.code)) { seen.add(d.code); list.push({ ...(state.drivers.find((x) => x.code === d.code) || {}), ...d, team: d.team || state.drivers.find((x) => x.code === d.code)?.team }); } }
  for (const d of state.drivers) if (d.code && !seen.has(d.code)) { seen.add(d.code); list.push(d); }
  const fav = teamBySlug(state.me?.favorite_team);
  const favDriver = fav && list.find((d) => fav.drivers.some((ln) => plain(d.name).includes(ln)));
  const pickCode = (c) => (list.some((d) => d.code === c) ? c : null);
  an = {
    lid, round, prac, season, list, pd,
    code: pickCode(params.get('d')) || favDriver?.code || pd[0]?.code || list[0]?.code,
    vs: pickCode(params.get('vs')),
    tab: ['1', '2', '3', 'all'].includes(params.get('s')) ? params.get('s') : null,
    trackCache: {},
  };
  const sessWithData = prac.sessions.filter((s) => s.rows.length).map((s) => String(s.n));
  if (!an.tab) an.tab = sessWithData.length > 1 ? 'all' : sessWithData[0] || '1';
  if (an.vs === an.code) an.vs = null;

  const opts = (cur, none) => {
    const teams = {};
    for (const d of list) (teams[d.team || 'Other'] ||= []).push(d);
    return (none ? `<option value="">${none}</option>` : '') + Object.entries(teams).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([t, ds]) => `<optgroup label="${esc(t)}">${ds.map((d) => `<option value="${esc(d.code)}" ${d.code === cur ? 'selected' : ''}>${esc(d.name)} (${esc(d.code)})</option>`).join('')}</optgroup>`).join('');
  };
  app.innerHTML = shell(`
    <a class="small muted" href="/league/${lid}/race/${round}" data-link>← Back to ${esc(prac.race.name)}</a>
    <div style="margin:10px 0 14px"><div class="muted small">Round ${prac.race.round} · ${esc(prac.race.circuit_name || '')}</div><h1>Driver analysis</h1></div>
    <div class="panel an-pick">
      <label>Driver<select id="an-driver">${opts(an.code)}</select></label>
      <label>Compare with<select id="an-vs">${opts(an.vs, '— nobody —')}</select></label>
    </div>
    <div id="an-head"></div>
    <div id="an-weekend"></div>
    <div id="an-vsbox"></div>
    <div id="an-season"></div>
    <div id="an-dnf"></div>
    <div id="an-track"></div>`);
  paintAnalysis();
}

function anDriver(code) {
  const d = an.list.find((x) => x.code === code);
  if (!d) return null;
  const sd = state.drivers.find((x) => x.code === code) || {};
  return { ...sd, ...d, driver_id: d.driver_id || sd.driver_id, photo_url: sd.photo_url || d.photo_url };
}
function anUrl() {
  const q = new URLSearchParams({ d: an.code, s: an.tab });
  if (an.vs) q.set('vs', an.vs);
  history.replaceState({}, '', `${location.pathname}?${q}`);
}
function paintAnalysis() {
  anUrl();
  const d = anDriver(an.code), v = an.vs ? anDriver(an.vs) : null;
  const ss = seasonStats(d), vs = v ? seasonStats(v) : null;
  document.getElementById('an-head').innerHTML = headPanel(d, ss, v, vs);
  paintWeekend();
  document.getElementById('an-vsbox').innerHTML = v ? vsPanel(d, ss, v, vs) : '';
  document.getElementById('an-season').innerHTML = seasonPanel(d, ss, v, vs);
  document.getElementById('an-dnf').innerHTML = dnfPanel(d, ss);
  paintTrack(d, v);
}

// --------------------------------------------------------- season numbers
const isDnf = (r) => r && (r.pos_text === 'R' || r.pos_text === 'N');
const isDns = (r) => r && r.pos_text === 'W';
function seasonStats(d) {
  const S = an.season;
  const done = S.races.filter((r) => S.results.some((x) => x.round === r.round));
  const id = d.driver_id;
  const quali = (round) => S.qualifying.find((q) => q.round === round && (q.driver_id === id || (d.code && q.code === d.code)));
  const pracRank = (round) => {
    const best = {};
    for (const p of S.practice.filter((x) => x.round === round && x.ms)) { const k = p.driver_id || p.code; if (!best[k] || p.ms < best[k]) best[k] = p.ms; }
    const order = Object.entries(best).sort((a, b) => a[1] - b[1]).map(([k]) => k);
    const i = order.findIndex((k) => k === id || k === d.code);
    return i >= 0 ? i + 1 : null;
  };
  const rows = done.map((race, i) => {
    const r = S.results.find((x) => x.round === race.round && x.driver_id === id);
    const fin = r && /^\d+$/.test(r.pos_text) ? Number(r.pos_text) : null;
    const q = quali(race.round);
    return { i, race, r, fin, kind: !r ? 'none' : fin ? 'fin' : isDnf(r) ? 'dnf' : isDns(r) ? 'dns' : r.pos_text === 'D' || r.pos_text === 'E' ? 'dsq' : 'dnf',
      quali: q ? q.position : null, prac: pracRank(race.round) };
  });
  const entered = rows.filter((x) => x.kind !== 'none');
  const fins = entered.filter((x) => x.fin).map((x) => x.fin);
  const dnfs = entered.filter((x) => x.kind === 'dnf' || x.kind === 'dns');
  const tr = slope(entered.filter((x) => x.fin).map((x) => ({ x: x.i, y: x.fin })));
  const last5 = entered.slice(-5);
  const half = Math.floor(entered.length / 2);
  const gained = entered.filter((x) => x.fin && x.quali).map((x) => x.quali - x.fin);
  const pracVs = entered.filter((x) => x.fin && x.prac).map((x) => x.prac - x.fin);
  return {
    rows, entered, done,
    starts: entered.filter((x) => x.kind !== 'dns').length,
    avg: avgOf(fins), median: medianOf(fins), best: fins.length ? Math.min(...fins) : null,
    wins: fins.filter((f) => f === 1).length, podiums: fins.filter((f) => f <= 3).length, top5: fins.filter((f) => f <= 5).length,
    top10: fins.filter((f) => f <= 10).length, p10: fins.filter((f) => f === 10).length,
    avgQuali: avgOf(entered.filter((x) => x.quali).map((x) => x.quali)),
    gained: avgOf(gained), pracVs: avgOf(pracVs),
    slope: tr,
    last5avg: avgOf(last5.filter((x) => x.fin).map((x) => x.fin)),
    firstHalf: avgOf(entered.slice(0, half).filter((x) => x.fin).map((x) => x.fin)),
    secondHalf: avgOf(entered.slice(half).filter((x) => x.fin).map((x) => x.fin)),
    dnfs, dnfLast5: last5.filter((x) => x.kind === 'dnf' || x.kind === 'dns').length,
  };
}
function trendWord(s) {
  if (s.slope === null || s.entered.filter((x) => x.fin).length < 4) return { cls: '', text: 'Not enough races yet' };
  if (s.slope <= -0.15) return { cls: 'up', text: `Improving (about ${fix1(-s.slope)} places better each race)` };
  if (s.slope >= 0.15) return { cls: 'down', text: `Declining (about ${fix1(s.slope)} places worse each race)` };
  return { cls: '', text: 'Steady through the season' };
}

// ---------------------------------------------------------------- header
function headPanel(d, ss, v, vs) {
  const card = (x, s, color) => {
    const pdx = an.pd.find((p) => p.code === x.code);
    const tw = trendWord(s);
    return `<div class="an-card" style="--tc:${esc(teamColor(x.team))};--lc:${color}">
      <div class="row">${avatar(x, 64)}<div><div class="an-name"><i class="dot" style="background:${color}"></i>${esc(x.name)} <span class="muted">#${esc(pdx?.number || x.number || '')}</span></div>${teamChip(x.team)}</div></div>
      <div class="an-kpis">
        <div><b>${pdx?.rank ? 'P' + pdx.rank : '–'}</b><span>Practice (best lap)</span></div>
        <div><b>${fix1(s.avg)}</b><span>Avg finish ${an.season.season}</span></div>
        <div><b>${s.best ? 'P' + s.best : '–'}</b><span>Best finish</span></div>
        <div><b>${s.dnfs.length}</b><span>DNF${s.dnfs.length === 1 ? '' : 's'}</span></div>
      </div>
      <div class="small ${tw.cls}">${esc(tw.text)}</div></div>`;
  };
  return `<div class="an-cards">${card(d, ss, MAIN_COLOR)}${v ? card(v, vs, VS_COLOR) : ''}</div>`;
}

// ------------------------------------------------------------- this weekend
function paintWeekend() {
  const box = document.getElementById('an-weekend');
  const tabs = [...an.prac.sessions.map((s) => [String(s.n), sessLabel(s.n), s.rows.length > 0]), ['all', 'Combined', an.prac.sessions.some((s) => s.rows.length)]];
  box.innerHTML = `<div class="panel"><div class="row between"><h2>This weekend's practice</h2></div>
    <div class="seg an-tabs">${tabs.map(([k, label, has]) => `<button data-act="an-tab" data-tab="${k}" class="${k === an.tab ? 'on' : ''}${has ? '' : ' dim'}">${label}</button>`).join('')}</div>
    <div id="an-wk-body"><p class="muted small">Loading…</p></div></div>`;
  const token = (an.paintToken = (an.paintToken || 0) + 1);
  (an.tab === 'all' ? combinedBody() : sessionBody(Number(an.tab))).then((html) => {
    const b = document.getElementById('an-wk-body');
    if (b && an.paintToken === token) b.innerHTML = html;
  }).catch(() => {
    const b = document.getElementById('an-wk-body');
    if (b && an.paintToken === token) b.innerHTML = '<p class="muted">Could not load the data right now. Try again in a minute.</p>';
  });
  // lap data takes a few seconds: show the formula1.com summary while OpenF1 answers
  const b = document.getElementById('an-wk-body');
  if (an.tab !== 'all') b.innerHTML = sessionSummary(Number(an.tab)) + '<p class="muted small">Loading lap by lap data…</p>';
}

function sessionSummary(n) {
  const s = an.prac.sessions.find((x) => x.n === n);
  if (!s) return '<p class="muted">There is no such session this weekend.</p>';
  if (!s.rows.length) {
    if (s.status === 'not_yet') return `<p class="muted">${sessLabel(n)} has not started yet${s.ts ? ` (${fmtDate(s.ts)})` : ''}.</p>`;
    return `<p class="muted">${sessLabel(n)} results are not published yet.</p>`;
  }
  const line = (code, color) => {
    const pdx = an.pd.find((p) => p.code === code);
    const x = pdx && pdx.s[n];
    if (!x) return `<span><i class="dot" style="background:${color}"></i>${esc(code)}: did not take part</span>`;
    return `<span><i class="dot" style="background:${color}"></i><b>${esc(pdx.name)}</b> P${esc(x.pos_text)} · ${fmtLapMs(x.ms)}${x.gap ? ` (${fmtGapMs(x.gap)})` : ' (fastest)'} · ${x.laps ?? '?'} laps</span>`;
  };
  return `<div class="facts">${line(an.code, MAIN_COLOR)}${an.vs ? line(an.vs, VS_COLOR) : ''}</div>`;
}

async function lapsFor(code, n) {
  const keys = await of1Sessions(an.season.season, an.prac.race.race_ts);
  if (!keys[n]) return null;
  const data = await of1Laps(keys[n], code);
  if (!data || !data.laps.length) return null;
  return { ...data, key: keys[n], ...lapSets(data.laps) };
}
const noLapData = (n) => `<p class="muted small">Lap by lap data for ${sessLabel(n)} is not available from OpenF1 yet (it is published shortly after the session ends).</p>`;

async function sessionBody(n) {
  const summary = sessionSummary(n);
  const s = an.prac.sessions.find((x) => x.n === n);
  if (!s || (s.status === 'not_yet')) return summary;
  const [a, b] = await Promise.all([lapsFor(an.code, n).catch(() => null), an.vs ? lapsFor(an.vs, n).catch(() => null) : null]);
  if (!a) return summary + noLapData(n);
  let html = summary + improvementFacts(a) + lapChart([{ code: an.code, color: MAIN_COLOR, d: a }, b && { code: an.vs, color: VS_COLOR, d: b }].filter(Boolean));
  html += runsTable([{ code: an.code, color: MAIN_COLOR, d: a }, b && { code: an.vs, color: VS_COLOR, d: b }].filter(Boolean));
  html += `<div id="an-tel" class="an-sub"><p class="muted small">Loading telemetry of the fastest lap…</p></div>`;
  html += lapTable(a, an.code);
  if (b) html += lapTable(b, an.vs);
  setTimeout(() => paintTelemetry(a, b), 0);
  return html;
}

function improvementFacts(a) {
  const facts = [];
  const bestLap = a.valid.find((l) => l.t === a.best);
  if (bestLap) facts.push(`Best lap <b>${fmtS(a.best)}</b> on lap ${bestLap.n} of ${a.laps.length}${bestLap.tyre ? ` (${bestLap.tyre.toLowerCase()}${bestLap.age !== null ? `, ${bestLap.age} laps old` : ''})` : ''}`);
  const s1 = Math.min(...a.valid.map((l) => l.s1).filter(Boolean)), s2 = Math.min(...a.valid.map((l) => l.s2).filter(Boolean)), s3 = Math.min(...a.valid.map((l) => l.s3).filter(Boolean));
  if (isFinite(s1 + s2 + s3) && a.best) {
    const ideal = s1 + s2 + s3;
    facts.push(`Ideal lap (best sectors) <b>${fmtS(ideal)}</b>${a.best - ideal > 0.001 ? `, ${(a.best - ideal).toFixed(3)} s left on the table` : ''}`);
  }
  // improving? best lap of each stint, first vs last
  const stints = {};
  for (const l of a.valid) if (l.stint) stints[l.stint] = Math.min(stints[l.stint] ?? Infinity, l.t);
  const bests = Object.entries(stints).sort((x, y) => x[0] - y[0]).map(([, t]) => t);
  if (bests.length >= 2) {
    const d = bests[0] - bests[bests.length - 1];
    facts.push(d > 0.05 ? `<span class="up">Got faster</span>: last run ${d.toFixed(3)} s quicker than the first` : d < -0.05 ? `<span class="down">Slower later</span>: last run ${(-d).toFixed(3)} s off the first` : 'Similar pace on every run');
  }
  const trap = Math.max(...a.laps.map((l) => l.trap || 0));
  if (trap) facts.push(`Top speed trap <b>${trap} km/h</b>`);
  return facts.length ? `<div class="facts">${facts.map((f) => `<span>${f}</span>`).join('')}</div>` : '';
}

// lap times over the session (or several sessions when `offsets` are given)
function lapChart(items, sessionsBands) {
  const all = items.flatMap((it) => it.d.valid.map((l) => l.t));
  if (!all.length) return '';
  const best = Math.min(...all);
  const yMin = Math.floor(best * 10) / 10 - 0.2, yMax = Math.ceil(best * 1.07 * 10) / 10;
  const xMax = Math.max(...items.flatMap((it) => it.d.laps.map((l) => l.x ?? l.n)), 2);
  const series = items.map((it) => ({
    color: it.color, width: 1.6,
    points: it.d.laps.map((l, i, arr) => {
      const prev = arr[i - 1];
      const gap = !prev || prev.stint !== l.stint || prev.session !== l.session || !prev.valid;
      if (!l.t) return { x: l.x ?? l.n, y: null };
      return {
        x: l.x ?? l.n, y: l.valid ? l.t : yMax, skipLine: !l.valid, gap, hollow: !l.valid, r: l.valid ? 3.4 : 2.4,
        fill: TYRE_COLORS[l.tyre] || it.color, stroke: it.color,
        shape: l.valid && l.t === it.d.best ? 'star' : null,
        title: `${it.code}${l.session ? ` ${sessLabel(l.session)}` : ''} lap ${l.n}: ${fmtS(l.t)}${l.tyre ? ` · ${l.tyre.toLowerCase()}` : ''}${l.pitOut ? ' · out of the pits' : !l.valid ? ' · slow lap (cooling, traffic or in-lap)' : ''}`,
      };
    }),
  }));
  const ticks = niceTicks(yMin, yMax, 5);
  const xt = sessionsBands ? [] : niceTicks(1, xMax, 8).filter((v) => Number.isInteger(v)).map((v) => ({ x: v, label: String(v) }));
  const legend = items.map((it) => `<span class="small"><i class="dot" style="background:${it.color}"></i>${esc(anDriver(it.code)?.name || it.code)}</span>`).join('')
    + Object.entries(TYRE_COLORS).map(([k, c]) => `<span class="small muted"><i class="dot" style="background:${c}"></i>${k.toLowerCase()}</span>`).join('');
  return `<div class="chart an-sub"><h3>Lap times</h3>${svgChart({ xMin: 0.5, xMax: xMax + 0.5, yMin, yMax, yTicks: ticks, yFmt: (v) => fmtS(v), xTicks: xt, bands: sessionsBands, series, aria: 'Lap times through the session' })}
    <div class="legend">${legend}</div><p class="muted small">Dots are coloured by tyre, ★ marks the best lap. Hollow dots at the top are slow laps (out-laps, cool-down laps, traffic): they are left out of the scale and of the averages.</p></div>`;
}

function runsTable(items) {
  const rows = items.flatMap((it) => longRuns(it.d.laps).map((r) => ({ ...r, it })));
  if (!rows.length) return '<p class="muted small an-sub">No long runs (5+ consistent laps on one set of tyres) in this session.</p>';
  return `<div class="an-sub"><h3>Long runs <span class="muted small">(race pace)</span></h3><div class="scroll"><table class="quali"><thead><tr><th>Driver</th><th>Tyre</th><th class="r">Laps</th><th class="r">Average</th><th class="r">Tyre wear</th></tr></thead><tbody>
    ${rows.sort((a, b) => a.avg - b.avg).map((r) => `<tr><td><i class="dot" style="background:${r.it.color}"></i>${esc(anDriver(r.it.code)?.name || r.it.code)}${r.session ? ` <span class="muted small">${sessLabel(r.session)}</span>` : ''}</td>
      <td><i class="dot" style="background:${TYRE_COLORS[r.tyre] || '#666'}"></i>${esc((r.tyre || '?').toLowerCase())}</td><td class="r">${r.laps} <span class="muted small">(${r.from}-${r.to})</span></td>
      <td class="r"><b>${fmtS(r.avg)}</b></td><td class="r">${r.deg === null ? '–' : `${r.deg > 0 ? '+' : ''}${r.deg.toFixed(3)} s/lap`}</td></tr>`).join('')}
    </tbody></table></div><p class="muted small">Long runs show race pace: lower average is faster, a high "tyre wear" number means the lap times kept dropping off. Fuel loads are unknown, so compare with care.</p></div>`;
}

function lapTable(a, code) {
  const valid = a.valid;
  const bs = (k) => Math.min(...valid.map((l) => l[k]).filter(Boolean));
  const b1 = bs('s1'), b2 = bs('s2'), b3 = bs('s3');
  const sec = (v, b) => `<td class="r${v && v === b ? ' fastest' : ''}">${v ? v.toFixed(3) : '–'}</td>`;
  const rows = a.laps.map((l) => `<tr class="${l.valid ? '' : 'slow'}"><td class="num">${l.session ? `${sessLabel(l.session)} · ` : ''}${l.n}</td><td class="r${l.t === a.best ? ' fastest' : ''}"><b>${fmtS(l.t)}</b></td>
    <td class="r muted">${l.t && a.best && l.t !== a.best ? '+' + (l.t - a.best).toFixed(3) : ''}</td>${sec(l.s1, b1)}${sec(l.s2, b2)}${sec(l.s3, b3)}
    <td class="r">${l.trap || '–'}</td><td>${l.tyre ? `<i class="dot" style="background:${TYRE_COLORS[l.tyre] || '#666'}"></i>${esc(l.tyre.toLowerCase())}${l.age !== null ? ` <span class="muted small">${l.age}</span>` : ''}` : '–'}</td>
    <td class="muted small">${l.pitOut ? 'out lap' : !l.t ? 'no time' : !l.valid ? 'slow' : l.t === a.best ? 'best' : ''}</td></tr>`).join('');
  return `<details class="an-sub"><summary>All laps of ${esc(anDriver(code)?.name || code)} (${a.laps.length})</summary><div class="scroll"><table class="quali laps"><thead><tr><th>Lap</th><th class="r">Time</th><th class="r">Δ best</th><th class="r">S1</th><th class="r">S2</th><th class="r">S3</th><th class="r">Trap</th><th>Tyre (age)</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted small">Purple: best time or sector. Trap: speed at the speed trap (km/h).</p></details>`;
}

// telemetry of the fastest lap: speed, throttle, brake and (when comparing) the time gap along the lap
async function paintTelemetry(a, b) {
  const box = document.getElementById('an-tel');
  if (!box) return;
  const fast = (x) => x && x.valid.find((l) => l.t === x.best);
  try {
    const [ta, tb] = await Promise.all([of1Telemetry(a.lapsKey || a.key, a.num, fast(a)), b ? of1Telemetry(b.lapsKey || b.key, b.num, fast(b)) : null]);
    const el = document.getElementById('an-tel');
    if (!el) return;
    if (!ta) { el.innerHTML = '<p class="muted small">Car telemetry for this lap is not available.</p>'; return; }
    el.innerHTML = telemetryHtml(ta, tb, fast(a), b ? fast(b) : null);
  } catch {
    const el = document.getElementById('an-tel');
    if (el) el.innerHTML = '<p class="muted small">Car telemetry could not be loaded right now.</p>';
  }
}
function telemetryHtml(ta, tb, la, lb) {
  const len = Math.max(ta[ta.length - 1].d, tb ? tb[tb.length - 1].d : 0);
  const mk = (t, key, color, scale = 1) => ({ color, width: 1.6, points: t.map((p) => ({ x: p.d, y: p[key] * scale, noDot: true })) });
  const series = (key, scale) => [mk(ta, key, MAIN_COLOR, scale), ...(tb ? [mk(tb, key, VS_COLOR, scale)] : [])];
  const maxSpeed = Math.max(...ta.map((p) => p.speed), ...(tb || []).map((p) => p.speed));
  const xt = niceTicks(0, len, 6).map((v) => ({ x: v, label: v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${v} m` }));
  const base = { xMin: 0, xMax: len, L: 52 };
  let html = `<div class="chart"><h3>Telemetry · fastest lap</h3>
    ${svgChart({ ...base, H: 230, yMin: 50, yMax: Math.ceil(maxSpeed / 20) * 20 + 10, yTicks: niceTicks(60, maxSpeed, 4), yFmt: (v) => `${v}`, xTicks: [], series: series('speed'), aria: 'Speed along the lap (km/h)' })}
    <div class="tel-label">Speed (km/h)</div>
    ${svgChart({ ...base, H: 90, T: 6, B: 6, yMin: 0, yMax: 100, yTicks: [0, 100], yFmt: (v) => `${v}%`, xTicks: [], series: series('thr'), aria: 'Throttle' })}
    <div class="tel-label">Throttle</div>
    ${svgChart({ ...base, H: 60, T: 6, B: tb ? 6 : 26, yMin: 0, yMax: 1, yTicks: [], xTicks: tb ? [] : xt, series: series('brake'), aria: 'Brake on/off' })}
    <div class="tel-label">Brake</div>`;
  if (tb) {
    // time at each distance, then the gap of the second driver to the first along the lap
    const timeAt = (t, dist) => {
      let i = t.findIndex((p) => p.d >= dist);
      if (i <= 0) return i === 0 ? t[0].time : t[t.length - 1].time;
      const p0 = t[i - 1], p1 = t[i];
      return p0.time + ((dist - p0.d) / (p1.d - p0.d || 1)) * (p1.time - p0.time);
    };
    const pts = [];
    for (let dist = 0; dist <= len; dist += len / 300) pts.push({ x: dist, y: timeAt(tb, dist) - timeAt(ta, dist), noDot: true });
    const ext = Math.max(0.2, ...pts.map((p) => Math.abs(p.y)));
    html += svgChart({ ...base, H: 120, yMin: -ext, yMax: ext, yTicks: [-ext, 0, ext].map((v) => Math.round(v * 100) / 100), yFmt: (v) => (v > 0 ? '+' : '') + v.toFixed(2), xTicks: xt, hlines: [{ y: 0 }], series: [{ color: VS_COLOR, width: 1.8, points: pts }], aria: 'Time gap along the lap' })
      + `<div class="tel-label">Gap of ${esc(anDriver(an.vs)?.name || an.vs)} (s, above 0 = behind)</div>`;
  }
  const stats = (t, l, code, color) => {
    let full = 0, brake = 0, total = 0;
    for (let i = 1; i < t.length; i++) { const dt = t[i].time - t[i - 1].time; total += dt; if (t[i].thr >= 98) full += dt; if (t[i].brake) brake += dt; }
    return `<span><i class="dot" style="background:${color}"></i><b>${esc(code)}</b> ${fmtS(l.t)} · top ${Math.max(...t.map((p) => p.speed))} km/h · slowest corner ${Math.min(...t.map((p) => p.speed))} km/h · full throttle ${Math.round((full / total) * 100)}% · braking ${Math.round((brake / total) * 100)}%</span>`;
  };
  html += `<div class="facts" style="margin-top:10px">${stats(ta, la, an.code, MAIN_COLOR)}${tb ? stats(tb, lb, an.vs, VS_COLOR) : ''}</div>
    <p class="muted small">Car data from OpenF1 (about 4 samples a second, so short braking moments can be missed). Distance is worked out from the speed.</p></div>`;
  return html;
}

async function combinedBody() {
  const sessions = an.prac.sessions.filter((s) => s.rows.length);
  if (!sessions.length) return '<p class="muted">No practice session has results yet.</p>';
  // 1) best lap per session from formula1.com: position and gap to the fastest
  const items = [[an.code, MAIN_COLOR], ...(an.vs ? [[an.vs, VS_COLOR]] : [])];
  const prog = items.map(([code, color]) => {
    const pdx = an.pd.find((p) => p.code === code);
    return { code, color, pts: sessions.map((s, i) => ({ i, s: s.n, x: pdx?.s[s.n] })) };
  });
  const gaps = prog.flatMap((p) => p.pts.map((q) => (q.x && q.x.ms ? q.x.gap / 1000 : null)).filter((v) => v !== null));
  const gMax = Math.max(0.5, ...gaps) * 1.15;
  let html = `<div class="chart an-sub"><h3>Gap to the fastest car, session by session</h3>${svgChart({
    H: 200, xMin: -0.4, xMax: sessions.length - 0.6, yMin: 0, yMax: gMax, invert: true, yTicks: niceTicks(0, gMax, 4), yFmt: (v) => `+${v.toFixed(1)}`,
    xTicks: sessions.map((s, i) => ({ x: i, label: sessLabel(s.n) })),
    series: prog.map((p) => ({ color: p.color, width: 2.4, points: p.pts.map((q) => ({ x: q.i, y: q.x && q.x.ms ? q.x.gap / 1000 : null, r: 5, title: q.x ? `${p.code} ${sessLabel(q.s)}: P${q.x.pos_text}, ${fmtLapMs(q.x.ms)}${q.x.gap ? ` (${fmtGapMs(q.x.gap)})` : ''}` : '' })) })),
    aria: 'Gap to the fastest driver in each practice session',
  })}</div>`;
  html += `<div class="scroll an-sub"><table class="quali"><thead><tr><th>Driver</th>${sessions.map((s) => `<th class="r">${sessLabel(s.n)}</th>`).join('')}<th class="r">Verdict</th></tr></thead><tbody>
    ${prog.map((p) => {
      const ps = p.pts.filter((q) => q.x && q.x.ms && /^\d+$/.test(q.x.pos_text));
      const first = ps[0], lastP = ps[ps.length - 1];
      let verdict = '<span class="muted">–</span>';
      if (ps.length >= 2) {
        const dPos = Number(first.x.pos_text) - Number(lastP.x.pos_text), dGap = (first.x.gap - lastP.x.gap) / 1000;
        verdict = dPos > 0 || dGap > 0.1 ? `<span class="up">Improving</span> <span class="muted small">${dPos > 0 ? `+${dPos} places` : ''}${dGap > 0.05 ? ` · ${dGap.toFixed(2)} s closer` : ''}</span>`
          : dPos < 0 || dGap < -0.1 ? `<span class="down">Fading</span> <span class="muted small">${dPos < 0 ? `${dPos} places` : ''}${dGap < -0.05 ? ` · ${(-dGap).toFixed(2)} s further` : ''}</span>` : 'Steady';
      }
      return `<tr><td><i class="dot" style="background:${p.color}"></i>${esc(anDriver(p.code)?.name || p.code)}</td>${p.pts.map((q) => `<td class="r">${q.x && q.x.ms ? `P${esc(q.x.pos_text)} <span class="muted small">${q.x.gap ? fmtGapMs(q.x.gap) : 'fastest'}</span>` : '<span class="muted">–</span>'}</td>`).join('')}<td class="r">${verdict}</td></tr>`;
    }).join('')}</tbody></table></div>`;

  // 2) every lap of the weekend, sessions one after another (OpenF1)
  const loads = await Promise.all(items.map(async ([code, color]) => {
    let offset = 0;
    const laps = [];
    const bands = [];
    let fastest = null;
    for (const s of sessions) {
      const d = await lapsFor(code, s.n).catch(() => null);
      if (!d) continue;
      d.laps.forEach((l) => { l.session = s.n; l.x = offset + l.n; });
      bands.push({ x1: offset + 0.5, x2: offset + d.laps.length + 0.5, label: sessLabel(s.n), fill: bands.length % 2 ? 'rgba(255,255,255,.035)' : 'rgba(255,255,255,0)' });
      laps.push(...d.laps);
      if (d.best && (!fastest || d.best < fastest.d.best)) fastest = { d, s: s.n };
      offset += d.laps.length + 2;
    }
    return { code, color, laps, bands, fastest };
  }));
  const main = loads[0];
  if (!main.laps.length) return html + '<p class="muted small">Lap by lap data is not available from OpenF1 yet (it is published shortly after each session ends).</p>';
  // keep "valid" as worked out per session; best over the weekend for the star
  const wrap = loads.filter((l) => l.laps.length).map((l) => ({ code: l.code, color: l.color, d: { laps: l.laps, valid: l.laps.filter((x) => x.valid), best: Math.min(...l.laps.filter((x) => x.valid).map((x) => x.t)) } }));
  html += lapChart(wrap, main.bands);
  // stints are numbered per session, so they get the session in front to keep them apart
  html += runsTable(wrap.map((w) => ({ ...w, d: { laps: w.d.laps.map((l) => ({ ...l, stint: l.stint ? l.session * 100 + l.stint : null })) } })));
  html += `<div id="an-tel" class="an-sub"><p class="muted small">Loading telemetry of the fastest lap of the weekend…</p></div>`;
  const fa = main.fastest, fb = loads[1]?.fastest;
  setTimeout(() => paintTelemetry(fa && fa.d, fb && fb.d), 0);
  return html;
}

// --------------------------------------------------------- head to head
function vsPanel(d, ss, v, vs) {
  const S = an.season;
  let raceA = 0, raceB = 0, qA = 0, qB = 0;
  for (const race of ss.done) {
    const ra = ss.rows.find((x) => x.race.round === race.round), rb = vs.rows.find((x) => x.race.round === race.round);
    if (ra && rb && ra.kind !== 'none' && rb.kind !== 'none') {
      const pa = ra.fin ?? 99 + (ra.r?.position || 0), pb = rb.fin ?? 99 + (rb.r?.position || 0);
      if (pa < pb) raceA++; else if (pb < pa) raceB++;
    }
    if (ra?.quali && rb?.quali) { if (ra.quali < rb.quali) qA++; else qB++; }
  }
  const wk = (code) => an.pd.find((p) => p.code === code);
  const pa = wk(d.code), pb = wk(v.code);
  const pracLine = an.prac.sessions.filter((s) => s.rows.length).map((s) => {
    const a = pa?.s[s.n], b = pb?.s[s.n];
    if (!a?.ms || !b?.ms) return null;
    const diff = (a.ms - b.ms) / 1000;
    return `<tr><td>${sessLabel(s.n)}</td><td class="r ${diff < 0 ? 'up' : ''}">${fmtLapMs(a.ms)}</td><td class="r ${diff > 0 ? 'up' : ''}">${fmtLapMs(b.ms)}</td><td class="r">${diff === 0 ? 'equal' : `${esc(diff < 0 ? d.code : v.code)} by ${Math.abs(diff).toFixed(3)} s`}</td></tr>`;
  }).filter(Boolean).join('');
  const bar = (a, b) => {
    const t = a + b || 1;
    return `<div class="h2hbar"><i style="width:${(a / t) * 100}%;background:${MAIN_COLOR}"></i><i style="width:${(b / t) * 100}%;background:${VS_COLOR}"></i></div>`;
  };
  const row = (label, a, b, lowerBetter = true, fmt = (x) => x) => {
    const better = a === null || b === null || a === b ? 0 : (a < b) === lowerBetter ? 1 : 2;
    return `<tr><td>${label}</td><td class="r ${better === 1 ? 'up' : ''}">${a === null ? '–' : fmt(a)}</td><td class="r ${better === 2 ? 'up' : ''}">${b === null ? '–' : fmt(b)}</td></tr>`;
  };
  return `<div class="panel"><h2>${esc(d.name)} vs ${esc(v.name)}</h2>
    <div class="h2h"><div><b>${raceA} : ${raceB}</b><span>Ahead at the finish ${S.season}</span>${bar(raceA, raceB)}</div><div><b>${qA} : ${qB}</b><span>Ahead in qualifying ${S.season}</span>${bar(qA, qB)}</div></div>
    ${pracLine ? `<h3>This weekend</h3><div class="scroll"><table class="quali"><thead><tr><th>Session</th><th class="r">${esc(d.code)}</th><th class="r">${esc(v.code)}</th><th class="r">Faster</th></tr></thead><tbody>${pracLine}</tbody></table></div>` : ''}
    <h3 style="margin-top:12px">Season ${S.season}</h3>
    <div class="scroll"><table class="quali"><thead><tr><th></th><th class="r">${esc(d.code)}</th><th class="r">${esc(v.code)}</th></tr></thead><tbody>
      ${row('Average finish', ss.avg, vs.avg, true, fix1)}
      ${row('Average qualifying', ss.avgQuali, vs.avgQuali, true, fix1)}
      ${row('Last 5 races (avg finish)', ss.last5avg, vs.last5avg, true, fix1)}
      ${row('Podiums', ss.podiums, vs.podiums, false)}
      ${row('Top 5 finishes', ss.top5, vs.top5, false)}
      ${row('Points finishes (top 10)', ss.top10, vs.top10, false)}
      ${row('DNFs', ss.dnfs.length, vs.dnfs.length, true)}
    </tbody></table></div><p class="muted small">Green marks the better number. "Ahead at the finish" counts races both started; a retirement counts as finishing behind.</p></div>`;
}

// ------------------------------------------------------------------ season
function seasonPanel(d, ss, v, vs) {
  const S = an.season;
  if (!ss.done.length) return `<div class="panel"><h2>Season ${S.season}</h2><p class="muted">No races finished yet.</p></div>`;
  const n = ss.done.length;
  const maxPos = Math.max(20, ...S.results.map((r) => r.position || 0));
  const bottom = maxPos + 1.5;
  const toPts = (s, withQuali) => s.rows.map((x) => ({
    x: x.i, y: x.kind === 'none' ? null : x.fin ?? bottom, gap: false, skipLine: !x.fin,
    shape: x.fin ? null : x.kind === 'none' ? null : 'x', r: 4,
    title: `${x.race.name}: ${x.fin ? 'P' + x.fin : x.kind === 'dnf' ? 'DNF' + (x.r?.status ? ` (${x.r.status})` : '') : x.kind === 'dns' ? 'did not start' : x.kind === 'dsq' ? 'disqualified' : '–'}${withQuali && x.quali ? ` · qualified P${x.quali}` : ''}`,
  }));
  const series = [
    { color: MAIN_COLOR, width: 2.4, points: toPts(ss, true) },
    { color: MAIN_COLOR, width: 1.4, dash: '3 4', opacity: 0.55, points: ss.rows.map((x) => ({ x: x.i, y: x.quali, r: 2.2, title: x.quali ? `${x.race.name}: qualified P${x.quali}` : '' })) },
  ];
  if (v) series.push({ color: VS_COLOR, width: 2.4, points: toPts(vs, true) });
  // trend line of the classified finishes
  const fins = ss.rows.filter((x) => x.fin);
  if (ss.slope !== null && fins.length >= 4) {
    const my = avgOf(fins.map((x) => x.fin)), mx = avgOf(fins.map((x) => x.i));
    series.push({ color: '#f0b429', width: 1.4, dash: '6 5', points: [0, n - 1].map((i) => ({ x: i, y: Math.max(1, Math.min(maxPos, my + ss.slope * (i - mx))), noDot: true })) });
  }
  const tw = trendWord(ss);
  const stat = (label, val, sub) => `<div><b>${val}</b><span>${label}</span>${sub ? `<em>${sub}</em>` : ''}</div>`;
  const halfNote = ss.firstHalf !== null && ss.secondHalf !== null ? `first half ${fix1(ss.firstHalf)} → second half ${fix1(ss.secondHalf)}` : '';
  // teammate
  const mate = state.drivers.find((x) => x.team && x.team === d.team && x.code !== d.code);
  let mateLine = '';
  if (mate) {
    const ms = seasonStats(anDriver(mate.code) || mate);
    let a = 0, b = 0, qa = 0, qb = 0;
    ss.rows.forEach((x, i) => {
      const y = ms.rows[i];
      if (x.kind !== 'none' && y && y.kind !== 'none') { const pa = x.fin ?? 99, pb = y.fin ?? 99; if (pa < pb) a++; else if (pb < pa) b++; }
      if (x.quali && y?.quali) { if (x.quali < y.quali) qa++; else qb++; }
    });
    mateLine = `<span>Teammate <b>${esc(mate.name)}</b>: ahead in <b>${a} of ${a + b}</b> races${qa + qb ? `, <b>${qa} of ${qa + qb}</b> qualifyings` : ''}</span>`;
  }
  const facts = [
    `<span class="${tw.cls}">${esc(tw.text)}</span>`,
    ss.last5avg !== null && ss.avg !== null ? `<span>Last 5 races avg <b>P${fix1(ss.last5avg)}</b> vs season <b>P${fix1(ss.avg)}</b> ${ss.last5avg < ss.avg - 0.5 ? '<span class="up">▲ in form</span>' : ss.last5avg > ss.avg + 0.5 ? '<span class="down">▼ off form</span>' : ''}</span>` : '',
    halfNote ? `<span>Avg finish: ${halfNote}</span>` : '',
    ss.gained !== null ? `<span>From qualifying to the flag: <b>${ss.gained >= 0 ? '+' : ''}${fix1(ss.gained)}</b> places on average</span>` : '',
    ss.pracVs !== null ? `<span>Practice rank vs result: finishes <b>${fix1(Math.abs(ss.pracVs))}</b> places ${ss.pracVs >= 0 ? 'better' : 'worse'} than his practice pace suggests</span>` : '',
    mateLine,
  ].filter(Boolean).join('');
  const every = Math.ceil(n / 24);
  const yt = [1, 5, 10, 15, 20].filter((t) => t <= maxPos);
  return `<div class="panel chart"><h2>Season ${S.season}: finishing positions</h2>
    <div class="an-stats">
      ${stat('Average finish', fix1(ss.avg), ss.median !== null ? `median P${fix1(ss.median)}` : '')}
      ${stat('Best finish', ss.best ? 'P' + ss.best : '–')}
      ${stat('Wins / podiums', `${ss.wins} / ${ss.podiums}`)}
      ${stat('Top 5', ss.top5, 'useful for P1-P5 picks')}
      ${stat('Points finishes', ss.top10)}
      ${stat('Finished P10', ss.p10, 'the P10 pick')}
      ${stat('Average qualifying', fix1(ss.avgQuali))}
    </div>
    ${svgChart({ H: 270, xMin: -0.5, xMax: n - 0.5, yMin: 0.5, yMax: bottom + 0.5, invert: true, yTicks: yt, yFmt: (v) => `P${v}`,
      xTicks: ss.done.map((r, i) => (i % every === 0 ? { x: i, label: raceCode(r.name), title: r.name } : null)).filter(Boolean),
      hlines: [{ y: 10.5, label: 'points', color: '#3a3f4a' }, { y: bottom, label: 'DNF', color: '#5a2a2a' }], series, aria: 'Finishing position in every race this season' })}
    <div class="legend"><span class="small"><i class="dot" style="background:${MAIN_COLOR}"></i>${esc(d.name)} finish</span><span class="small muted">- - qualifying</span>${v ? `<span class="small"><i class="dot" style="background:${VS_COLOR}"></i>${esc(v.name)} finish</span>` : ''}<span class="small muted"><i class="dot" style="background:#f0b429"></i>trend</span><span class="small muted">✕ DNF</span></div>
    <div class="facts" style="margin-top:10px">${facts}</div></div>`;
}

// --------------------------------------------------------------------- DNF
function dnfPanel(d, ss) {
  const S = an.season;
  const total = ss.entered.length;
  const done = total - ss.dnfs.length;
  // the whole field, for comparison and the "most likely to retire" list
  const field = {};
  for (const r of S.results) {
    const f = (field[r.driver_id] ||= { id: r.driver_id, starts: 0, dnf: 0, last5: 0, rounds: [] });
    f.starts++; f.rounds.push(r.round);
    if (isDnf(r) || isDns(r)) f.dnf++;
  }
  const lastRounds = S.races.filter((r) => S.results.some((x) => x.round === r.round)).slice(-5).map((r) => r.round);
  for (const r of S.results) if (lastRounds.includes(r.round) && (isDnf(r) || isDns(r))) field[r.driver_id].last5++;
  const all = Object.values(field);
  const fieldRate = all.reduce((a, f) => a + f.dnf, 0) / Math.max(1, all.reduce((a, f) => a + f.starts, 0));
  const rate = total ? ss.dnfs.length / total : 0;
  // streak: retirements in a row up to the latest race
  let streak = 0;
  for (let i = ss.entered.length - 1; i >= 0 && ['dnf', 'dns'].includes(ss.entered[i].kind); i--) streak++;
  const warn = [];
  if (ss.dnfLast5 >= 2) warn.push(`${ss.dnfLast5} DNFs in the last 5 races`);
  if (streak >= 2) warn.push(`${streak} retirements in a row`);
  if (total >= 6 && rate >= fieldRate * 1.6 && ss.dnfs.length >= 3) warn.push(`retires ${(rate / (fieldRate || 1)).toFixed(1)}× as often as the field`);
  const earlier = ss.entered.slice(0, -5);
  const earlierRate = earlier.length ? earlier.filter((x) => ['dnf', 'dns'].includes(x.kind)).length / earlier.length : null;
  let trend = '';
  if (earlierRate !== null && ss.entered.length >= 8) {
    const recentRate = ss.dnfLast5 / Math.min(5, ss.entered.length);
    trend = recentRate > earlierRate + 0.15 ? '<span class="down">DNFs are getting more frequent</span>' : recentRate < earlierRate - 0.15 ? '<span class="up">More reliable lately</span>' : 'No clear change in reliability';
  }
  const strip = ss.rows.map((x) => `<span class="dnfcell ${x.kind}" title="${esc(x.race.name)}: ${x.fin ? 'P' + x.fin : x.kind === 'none' ? 'did not take part' : x.kind.toUpperCase()}${x.r?.status && !x.fin ? ` (${esc(x.r.status)})` : ''}">${raceCode(x.race.name)}</span>`).join('');
  const list = ss.dnfs.map((x) => `<li><b>${esc(shortGp(x.race.name))}</b>: ${x.kind === 'dns' ? 'did not start' : 'retired'}${x.r?.status && !/^(retired|did not start|withdrew)$/i.test(x.r.status) ? ` <span class="muted">(${esc(x.r.status)})</span>` : ''}${x.quali ? ` <span class="muted small">· started from qualifying P${x.quali}</span>` : ''}</li>`).join('');
  const risk = all.filter((f) => f.starts >= 3).sort((a, b) => b.dnf / b.starts - a.dnf / a.starts || b.last5 - a.last5).slice(0, 6);
  const name = (id) => driverById(id)?.name || id;
  return `<div class="panel"><h2>DNF analysis</h2>
    ${warn.length ? `<div class="banner red">⚠️ DNF trend for ${esc(d.name)}: ${warn.map(esc).join(', ')}.</div>` : ''}
    <div class="an-stats">
      <div><b>${done} / ${total}</b><span>Races finished</span></div>
      <div><b>${ss.dnfs.length}</b><span>DNFs</span><em>${ss.dnfs.filter((x) => x.kind === 'dns').length ? `incl. ${ss.dnfs.filter((x) => x.kind === 'dns').length} DNS` : ''}</em></div>
      <div><b>${Math.round(rate * 100)}%</b><span>DNF rate</span><em>field: ${Math.round(fieldRate * 100)}%</em></div>
      <div><b>${ss.dnfLast5}</b><span>DNFs in last 5</span></div>
    </div>
    <div class="dnfstrip">${strip}</div>
    ${trend ? `<p class="small">${trend}</p>` : ''}
    ${list ? `<ul class="small dnflist">${list}</ul>` : '<p class="muted small">Finished every race he started this season.</p>'}
    <h3 style="margin-top:14px">Most likely to retire <span class="muted small">(DNF rate this season)</span></h3>
    <div class="scroll"><table class="quali"><tbody>${risk.map((f) => `<tr class="${f.id === d.driver_id ? 'lead' : ''}"><td>${driverCell({ driver_id: f.id, name: name(f.id), team: driverById(f.id)?.team }, 26)}</td><td class="r"><b>${f.dnf}</b> <span class="muted small">of ${f.starts}</span></td><td class="r">${Math.round((f.dnf / f.starts) * 100)}%</td><td class="r small">${f.last5 ? `<span class="down">${f.last5} in last 5</span>` : '<span class="muted">0 in last 5</span>'}</td></tr>`).join('')}</tbody></table></div>
    <p class="muted small">DNF follows the game's rules: retired, not classified or did not start. Handy for the DNF picks.</p></div>`;
}

// ------------------------------------------------- history at this circuit
async function trackRows(circuit, driverId) {
  const key = `th:${circuit}:${driverId}`;
  try {
    const c = JSON.parse(localStorage.getItem(key) || 'null');
    if (c && c.at > Date.now() - 86400000) return c.rows;
  } catch { /* storage not available */ }
  const data = await jolpica(`/circuits/${circuit}/drivers/${driverId}/results.json?limit=100`);
  const rows = (data.MRData.RaceTable.Races || []).map((r) => ({ season: Number(r.season), round: Number(r.round), team: r.Results[0]?.Constructor?.name, grid: Number(r.Results[0]?.grid) || null, pos: r.Results[0]?.positionText, status: r.Results[0]?.status }));
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), rows })); } catch { /* ignore */ }
  return rows;
}
async function paintTrack(d, v) {
  const box = document.getElementById('an-track');
  const circuit = an.prac.race.circuit_id;
  if (!box || !circuit) return;
  box.innerHTML = `<div class="panel"><h2>History at ${esc(an.prac.race.circuit_name || 'this circuit')}</h2><p class="muted small">Looking up past races…</p></div>`;
  const tok = (an.trackToken = (an.trackToken || 0) + 1);
  try {
    const [a, b] = await Promise.all([d.driver_id ? trackRows(circuit, d.driver_id) : [], v && v.driver_id ? trackRows(circuit, v.driver_id) : null]);
    if (an.trackToken !== tok || !document.getElementById('an-track')) return;
    box.innerHTML = trackPanel(d, a, v, b);
  } catch {
    if (an.trackToken === tok && document.getElementById('an-track')) box.innerHTML = `<div class="panel"><h2>History at this circuit</h2><p class="muted">The race data service is busy right now. Open this page again later.</p></div>`;
  }
}
function trackPanel(d, a, v, b) {
  const title = `<h2>History at ${esc(an.prac.race.circuit_name || 'this circuit')}</h2>`;
  const summary = (rows, x, color) => {
    if (!rows.length) return `<span><i class="dot" style="background:${color}"></i><b>${esc(x.name)}</b>: first race here</span>`;
    const fins = rows.filter((r) => /^\d+$/.test(r.pos)).map((r) => Number(r.pos));
    const dnf = rows.filter((r) => !/^\d+$/.test(r.pos)).length;
    return `<span><i class="dot" style="background:${color}"></i><b>${esc(x.name)}</b>: ${rows.length} race${rows.length === 1 ? '' : 's'} · best <b>${fins.length ? 'P' + Math.min(...fins) : '–'}</b> · avg ${fix1(avgOf(fins))} · ${fins.filter((f) => f <= 3).length} podium${fins.filter((f) => f <= 3).length === 1 ? '' : 's'} · ${dnf} DNF</span>`;
  };
  const years = [...new Set([...a.map((r) => r.season), ...(b || []).map((r) => r.season)])].sort((x, y) => y - x);
  if (!years.length) return `<div class="panel">${title}<div class="facts">${summary(a, d, MAIN_COLOR)}${v ? summary(b || [], v, VS_COLOR) : ''}</div></div>`;
  const cell = (r) => {
    if (!r) return '<td></td><td class="r"><span class="muted">–</span></td>';
    const fin = /^\d+$/.test(r.pos) ? Number(r.pos) : null;
    const gained = fin && r.grid ? r.grid - fin : null;
    return `<td>${teamChip(r.team)}</td><td class="r"><b class="${fin && fin <= 3 ? 'podium' : ''}">${fin ? 'P' + fin : `<span class="down">${esc(r.pos === 'R' ? 'DNF' : r.pos)}</span>`}</b>
      <div class="muted small">${r.grid ? `from P${r.grid}` : 'pit lane'}${gained ? ` · <span class="${gained > 0 ? 'up' : 'down'}">${gained > 0 ? '+' : ''}${gained}</span>` : ''}${!fin && r.status ? ` · ${esc(r.status)}` : ''}</div></td>`;
  };
  const rows = years.map((y) => `<tr><td class="num"><b>${y}</b></td>${cell(a.find((r) => r.season === y))}${v ? cell((b || []).find((r) => r.season === y)) : ''}</tr>`).join('');
  return `<div class="panel">${title}<div class="facts">${summary(a, d, MAIN_COLOR)}${v ? summary(b || [], v, VS_COLOR) : ''}</div>
    <div class="scroll"><table class="quali hist"><thead><tr><th>Year</th><th>${esc(d.code)} team</th><th class="r">Result</th>${v ? `<th>${esc(v.code)} team</th><th class="r">Result</th>` : ''}</tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted small">Every Formula 1 race of the driver at this circuit with the team he drove for. Data: Jolpica F1.</p></div>`;
}

// ------------------------------------------------------------------ events
Object.assign(actions, {
  'qa-tab'(btn) {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.qa-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    document.getElementById('quali-box').hidden = tab !== 'quali';
    document.getElementById('analytics-box').hidden = tab !== 'analytics';
    try { sessionStorage.setItem('qa-tab', tab); } catch { /* ignore */ }
    if (tab === 'analytics' && raceCtx) loadAnalyticsTab(raceCtx.lid, raceCtx.round);
  },
  'an-tab'(btn) {
    if (!an) return;
    an.tab = btn.dataset.tab;
    anUrl();
    paintWeekend();
  },
});
document.addEventListener('change', (e) => {
  if (!an) return;
  if (e.target.id === 'an-driver') { an.code = e.target.value; if (an.vs === an.code) { an.vs = null; document.getElementById('an-vs').value = ''; } paintAnalysis(); }
  if (e.target.id === 'an-vs') { an.vs = e.target.value && e.target.value !== an.code ? e.target.value : null; if (!an.vs) e.target.value = ''; paintAnalysis(); }
});
