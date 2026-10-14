/* F1 Vietiniai Predictions - front-end (no build step, plain JavaScript) */
'use strict';

const app = document.getElementById('app');
const state = { me: null, appName: 'F1 Predictions', emailEnabled: false, drivers: null, races: null, offset: 0, notes: null };
const DNF_SLOTS = 3;
const COLORS = ['#e10600', '#3b9eff', '#2fbf71', '#f0b429', '#b07cff', '#ff8a3d', '#22d3c5', '#f472b6', '#a3e635', '#94a3b8'];

// ------------------------------------------------------------------ utils
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nowTs = () => Date.now() + state.offset;
const shortGp = (n) => String(n).replace(' Grand Prix', '') + ' GP';

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'content-type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || 'Request failed');
    e.status = res.status;
    throw e;
  }
  return data;
}

let toastTimer;
function toast(msg, isErr = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), 3200);
}
const fail = (e) => toast(e.message || 'Something went wrong', true);

function fmtDate(ts) {
  return new Date(ts).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
}
function timeLeft(ms) {
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return d > 0 ? `${d}d ${p(h)}h ${p(m)}m` : `${p(h)}:${p(m)}:${p(sec)}`;
}

function go(path) {
  history.pushState({}, '', path);
  render();
}
window.addEventListener('popstate', render);

function avatar(d, size = 44) {
  if (!d) return `<span class="av" style="--s:${size}px"></span>`;
  const img = d.photo_url ? `<img src="${esc(d.photo_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
  return `<span class="av" style="--s:${size}px"><span class="ini">${esc(d.code || d.number || '')}</span>${img}</span>`;
}
const driverById = (id) => (state.driverMap || {})[id];
async function loadDrivers() {
  const { drivers } = await api('/drivers');
  state.drivers = drivers;
  state.driverMap = Object.fromEntries(drivers.map((d) => [d.driver_id, d]));
  return drivers;
}
async function loadTeams() {
  try { state.teams = (await api('/teams')).teams; } catch { state.teams = []; }
  return state.teams;
}
const teamBySlug = (slug) => (state.teams || []).find((t) => t.slug === slug);
const plain = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const teamSelect = (current) => `<select name="team" id="team-sel"><option value="">No favorite team</option>${(state.teams || []).map((t) => `<option value="${esc(t.slug)}" ${t.slug === current ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`;
// Side panel: team logo, its drivers, the car and some race photos (formula1.com images).
function teamSide() {
  const t = state.me && teamBySlug(state.me.favorite_team);
  if (!t) return '';
  const drivers = t.drivers.map((ln) => (state.drivers || []).find((d) => plain(d.name).includes(ln))).filter(Boolean);
  const img = (src, cls, alt) => `<img class="${cls}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">`;
  return `<aside class="teamside" style="--team:${esc(t.color)}">
    <a class="tlogo" href="${esc(t.url)}" target="_blank" rel="noopener">${img(t.logo, 'tl', t.name)}<span>${esc(t.name)}</span></a>
    <div class="tdrivers">${drivers.map((d) => `<div class="tdrv">${avatar(d, 56)}<b>${esc(d.name)}</b><span class="muted small">${d.number ? '#' + esc(d.number) : ''}</span></div>`).join('')}</div>
    ${img(t.car, 'tcar', t.name + ' car')}
    <div class="tphotos">${t.photos.map((p) => img(p, 'tph', t.name + ' on track')).join('')}</div>
    <p class="muted small">Your favorite team · <a href="/account" data-link>change</a></p>
  </aside>`;
}
async function loadRaces() {
  const { races, server_time } = await api('/races');
  state.races = races;
  state.offset = server_time - Date.now();
  return races;
}
const trackImg = (r, cls = 'track') =>
  r.circuit_image ? `<img class="${cls}" src="${esc(r.circuit_image)}" alt="${esc(r.circuit_name)} layout" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : `<div class="track-ph">🏁</div>`;

// ----------------------------------------------------------------- shell
function shell(inner) {
  const u = state.me;
  return `<div class="wrap ${state.me && teamBySlug(state.me.favorite_team) ? 'withside' : ''}">
    <header class="topbar">
      <a class="brand" href="/" data-link><img class="f1logo" src="/f1-logo.png" alt="F1" onerror="this.outerHTML='<span class=&quot;logo&quot;>F1</span>'"> ${esc(state.appName)}</a>
      <span class="spacer"></span>
      ${u ? `<div class="bell"><button data-act="bell" aria-label="Notifications">🔔<span id="badge"></span></button>
        <div id="notes" class="notes" hidden></div></div>
        <a class="muted small" href="/account" data-link title="Change password">${esc(u.name)}</a>
        <button class="ghost small" data-act="logout">Log out</button>` : ''}
    </header>
    ${teamSide() ? `<div class="layout"><main>${inner}</main>${teamSide()}</div>` : inner}
  </div>`;
}

async function refreshBadge() {
  if (!state.me) return;
  try {
    const { notifications, unread } = await api('/notifications');
    state.notes = notifications;
    const b = document.getElementById('badge');
    if (b) b.innerHTML = unread ? `<span class="badge">${unread}</span>` : '';
  } catch { /* ignore */ }
}
setInterval(refreshBadge, 60000);

// ---------------------------------------------------------------- routing
async function render() {
  clearInterval(state.tick);
  const path = location.pathname.replace(/\/+$/, '') || '/';
  try {
    if (!state.loaded) {
      const me = await api('/me');
      state.me = me.user;
      state.appName = me.app_name;
      state.emailEnabled = me.email_enabled;
      state.loaded = true;
      document.title = state.appName;
    }
    if (!state.teams) await loadTeams();
    if (state.me && state.me.favorite_team && !state.drivers) { try { await loadDrivers(); } catch { /* ignore */ } }
    let m;
    if ((m = path.match(/^\/join\/([a-z0-9]+)$/))) return await joinView(m[1]);
    if (!state.me) return authView();
    if (state.me.must_change || path === '/account') return accountView();
    if (path === '/') return await homeView();
    if ((m = path.match(/^\/league\/(\d+)\/race\/(\d+)$/))) return await raceView(Number(m[1]), Number(m[2]));
    if ((m = path.match(/^\/league\/(\d+)(?:\/(races|scoreboard|members|approvals))?$/))) return await leagueView(Number(m[1]), m[2] || 'races');
    app.innerHTML = shell(`<div class="panel"><h2>Page not found</h2><a href="/" data-link>Back to home</a></div>`);
  } catch (e) {
    if (e.status === 401) { state.me = null; return authView(); }
    app.innerHTML = shell(`<div class="panel"><h2>Oops</h2><p>${esc(e.message)}</p><a href="/" data-link>Back to home</a></div>`);
  }
  refreshBadge();
}

// ------------------------------------------------------------------- auth
let authMode = 'login';
function authForm(afterAuth) {
  return `<div class="panel">
    <div class="seg"><button data-act="authmode" data-mode="login" class="${authMode === 'login' ? 'on' : ''}">Log in</button>
    <button data-act="authmode" data-mode="register" class="${authMode === 'register' ? 'on' : ''}">Create account</button></div>
    <form data-form="auth">
      ${authMode === 'register' ? `<label for="a-name">Your name (shown to league members)</label><input id="a-name" name="name" required maxlength="40" autocomplete="name">` : ''}
      ${authMode === 'register' ? `<label for="team-sel">Favorite team (optional)</label>${teamSelect('')}` : ''}
      <label for="a-email">Email</label><input id="a-email" name="email" type="email" required autocomplete="email">
      <label for="a-pass">Password ${authMode === 'register' ? '(min. 8 characters)' : ''}</label>
      <input id="a-pass" name="password" type="password" required minlength="${authMode === 'register' ? 8 : 1}" autocomplete="${authMode === 'register' ? 'new-password' : 'current-password'}">
      <p><button class="primary" style="width:100%;justify-content:center">${authMode === 'register' ? 'Create account' : 'Log in'}</button></p>
    </form>
  </div>`;
}
function authView() {
  app.innerHTML = shell(`<div class="auth"><h1>Predict the grid.<br>Beat your friends.</h1><p class="muted">Create or join a league, predict the top 5, P10 and DNFs for every Grand Prix.</p>${authForm()}</div>`);
}

// ---------------------------------------------------------------- account
function accountView() {
  const forced = !!state.me.must_change;
  app.innerHTML = shell(`<div class="auth">${forced ? '' : `<div class="panel"><h2>Favorite team</h2>
    <p class="muted small">Your team is shown at the side of every page with its drivers, car and race photos.</p>
    <form data-form="team"><label for="team-sel">Team</label>${teamSelect(state.me.favorite_team)}
      <p><button class="primary">Save team</button></p></form></div>`}<div class="panel">
    <h2>${forced ? 'Choose a new password' : 'Change password'}</h2>
    ${forced ? '<p class="banner">Your password was reset by the league creator. Choose your own password to continue.</p>' : ''}
    <form data-form="password">
      ${forced ? '' : '<label for="pw-cur">Current password</label><input id="pw-cur" name="current" type="password" required autocomplete="current-password">'}
      <label for="pw-new">New password (min. 8 characters)</label>
      <input id="pw-new" name="new" type="password" required minlength="8" autocomplete="new-password">
      <p class="row"><button class="primary">Save password</button>${forced ? '' : '<a class="btn" href="/" data-link>Cancel</a>'}</p>
    </form></div></div>`);
}

// ------------------------------------------------------------------- join
async function joinView(code) {
  let info;
  try { info = await api('/join/' + code); } catch (e) {
    app.innerHTML = shell(`<div class="auth panel"><h2>Invite not valid</h2><p class="muted">${esc(e.message)}</p><a href="/" data-link>Go home</a></div>`);
    return;
  }
  const body = state.me
    ? `<p><button class="primary" data-act="join" data-code="${esc(code)}">Join this league</button></p>`
    : `<p class="muted">Log in or create an account to join.</p>${authForm()}`;
  app.innerHTML = shell(`<div class="auth"><div class="panel"><h2>You're invited</h2>
    <p>Join <b>${esc(info.name)}</b> (${info.members} member${info.members === 1 ? '' : 's'}).</p>${state.me ? body : ''}</div>${state.me ? '' : body}</div>`);
}

// ------------------------------------------------------------------- home
async function homeView() {
  const [{ leagues }] = await Promise.all([api('/leagues'), loadRaces()]);
  const next = state.races.find((r) => r.race_ts > nowTs());
  app.innerHTML = shell(`
    ${next ? `<div class="panel"><div class="row">${trackImg(next, 'track big')}<div>
      <div class="muted small">Next race · round ${next.round}</div><h2>${esc(next.name)}</h2>
      <div class="muted">${esc(next.circuit_name)}, ${esc(next.locality)}</div>
      <div>${fmtDate(next.race_ts)}</div><div class="chip amber" id="cd">…</div></div></div></div>` : ''}
    <h2>Your leagues</h2>
    <div class="grid two">
      ${leagues.map((l) => `<a class="panel" style="text-decoration:none;margin:0" href="/league/${l.id}" data-link>
        <h3>${esc(l.name)}</h3><span class="chip">${l.member_count} member${l.member_count === 1 ? '' : 's'}</span>
        ${l.role === 'admin' ? '<span class="chip">admin</span>' : ''}</a>`).join('') ||
        `<div class="panel muted" style="margin:0">You are not in a league yet. Create one below, or open an invite link from a friend.</div>`}
    </div>
    <div class="panel" style="margin-top:18px"><h3>Create a league</h3>
      <form data-form="newleague" class="row"><input name="name" placeholder="League name" required maxlength="50">
      <button class="primary">Create</button></form></div>`);
  if (next) startCountdown('cd', next.race_ts, 'Predictions close in ');
}

function startCountdown(id, ts, prefix = '') {
  const tick = () => {
    const el = document.getElementById(id);
    if (!el) return clearInterval(state.tick);
    el.textContent = prefix + timeLeft(ts - nowTs());
  };
  tick();
  state.tick = setInterval(tick, 1000);
}

// ----------------------------------------------------------------- league
async function leagueView(id, tab) {
  const [info] = await Promise.all([api('/leagues/' + id), loadRaces()]);
  const isAdmin = info.role === 'admin';
  const tabs = [['races', 'Races'], ['scoreboard', 'Scoreboard'], ['members', 'Members']];
  if (isAdmin) tabs.push(['approvals', `Approvals${info.pending ? ` <span class="badge">${info.pending}</span>` : ''}`]);
  if (tab === 'approvals' && !isAdmin) tab = 'races';
  let content = '';
  if (tab === 'races') content = await racesTab(id);
  if (tab === 'scoreboard') content = await scoreboardTab(id);
  if (tab === 'members') content = membersTab(info);
  if (tab === 'approvals') content = await approvalsTab(id);
  app.innerHTML = shell(`
    <div class="row between"><h1>${esc(info.league.name)}</h1><a class="small muted" href="/" data-link>← All leagues</a></div>
    <nav class="tabs">${tabs.map(([k, label]) => `<a href="/league/${id}/${k}" data-link class="${k === tab ? 'on' : ''}">${label}</a>`).join('')}</nav>
    ${content}`);
  if (tab === 'races') {
    const next = state.races.find((r) => r.race_ts > nowTs());
    if (next) startCountdown('cd-' + next.round, next.race_ts, 'closes in ');
  }
}

async function racesTab(id) {
  const { predictions } = await api(`/leagues/${id}/my-predictions`);
  const mine = Object.fromEntries(predictions.map((p) => [p.round, p.status]));
  const next = state.races.find((r) => r.race_ts > nowTs());
  const badge = (r) => {
    const s = mine[r.round];
    if (s === 'ok') return '<span class="chip green">✓ Predicted</span>';
    if (s === 'late_approved') return '<span class="chip green">✓ Late entry approved</span>';
    if (s === 'late_pending') return '<span class="chip amber">⏳ Waiting for approval</span>';
    if (s === 'late_rejected') return '<span class="chip red">Late entry rejected</span>';
    return r.race_ts > nowTs() ? '<span class="chip">Not predicted yet</span>' : '<span class="chip red">Missed</span>';
  };
  return `<div class="panel flush">${state.races.map((r) => {
    const status = r.has_results ? '<span class="chip">Final</span>'
      : r.race_ts <= nowTs() ? '<span class="chip amber">Locked · awaiting results</span>'
      : `<span class="chip ${next && next.round === r.round ? 'amber' : ''}" ${next && next.round === r.round ? `id="cd-${r.round}"` : ''}>Open</span>`;
    return `<a class="race" href="/league/${id}/race/${r.round}" data-link>
      <div class="rnd">${r.round}</div>${trackImg(r)}
      <div><div class="name">${esc(r.name)}</div><div class="muted small">${esc(r.locality)}, ${esc(r.country)} · ${fmtDate(r.race_ts)}</div></div>
      <div class="side">${status}${badge(r)}</div></a>`;
  }).join('')}</div>`;
}

function membersTab(info) {
  const isAdmin = info.role === 'admin';
  const me = state.me.id;
  const ownerId = info.league.owner_id;
  const isOwner = ownerId === me;
  const link = info.league.invite_code ? `${location.origin}/join/${info.league.invite_code}` : '';
  const controls = (m) => {
    const d = `data-id="${info.league.id}" data-uid="${m.id}" data-name="${esc(m.name)}"`;
    if (m.id === ownerId) return '<span class="muted small">creator</span>';
    let out = '';
    if (isOwner) out += `<button class="small" data-act="role" ${d} data-role="${m.role === 'admin' ? 'member' : 'admin'}">${m.role === 'admin' ? 'Remove admin rights' : 'Make admin'}</button> `;
    if (isAdmin && m.id !== me && (m.role !== 'admin' || isOwner)) out += `<button class="small" data-act="resetpw" ${d}>Reset password</button> `;
    if (isAdmin && m.id !== me && (m.role !== 'admin' || isOwner)) out += `<button class="small danger" data-act="kick" ${d}>Remove</button>`;
    return out;
  };
  return `${isAdmin ? `<div class="panel"><h3>Invite people</h3>
      <p class="muted small">Send this link by WhatsApp, Messenger, anything. Whoever opens it can create an account and join this league.</p>
      <div class="copybox"><input readonly value="${esc(link)}" id="invite-link"><button data-act="copy">Copy</button></div>
      <p class="row" style="margin-top:12px"><button class="ghost small" data-act="regen" data-id="${info.league.id}">Create a new link (old one stops working)</button></p>
      ${state.emailEnabled ? `<form data-form="invite-email" data-id="${info.league.id}" class="row" style="margin-top:8px"><input name="email" type="email" placeholder="friend@example.com" required><button>Send invite by email</button></form>` : ''}
    </div>` : ''}
    <div class="panel flush"><div class="scroll"><table><thead><tr><th>Member</th><th>Role</th><th class="r"></th></tr></thead><tbody>
    ${info.members.map((m) => `<tr><td>${esc(m.name)}${m.id === me ? ' <span class="muted">(you)</span>' : ''}</td>
      <td><span class="chip ${m.role === 'admin' ? 'amber' : ''}">${m.id === ownerId ? 'creator · admin' : m.role}</span></td>
      <td class="r">${controls(m)}</td></tr>`).join('')}
    </tbody></table></div></div>
    ${isOwner ? '<p class="muted small">Only you, as the creator, can give or take away admin rights. Admins approve late predictions, remove regular members and can reset a member&#39;s password.</p>' : ''}
    <p class="row">
      ${isOwner ? `<button class="ghost danger small" data-act="delete-league" data-id="${info.league.id}">Delete league</button>`
        : `<button class="ghost danger small" data-act="leave" data-id="${info.league.id}">Leave league</button>`}
    </p>`;
}

async function approvalsTab(id) {
  const { pending, drivers } = await api(`/leagues/${id}/pending`);
  const map = Object.fromEntries(drivers.map((d) => [d.driver_id, d]));
  const nm = (x) => (map[x] ? map[x].code || map[x].name : '?');
  if (!pending.length) return `<div class="panel muted">No late predictions waiting for approval.</div>`;
  return pending.map((p) => `<div class="panel">
    <div class="row between"><div><h3>${esc(p.user_name)} · ${esc(p.race_name)}</h3>
      <div class="muted small">Submitted ${fmtDate(p.submitted_at)} · race started ${fmtDate(p.race_ts)}</div></div>
      <div class="row"><button class="primary" data-act="decide" data-id="${id}" data-pid="${p.id}" data-action="approve">Approve</button>
      <button class="danger" data-act="decide" data-id="${id}" data-pid="${p.id}" data-action="reject">Reject</button></div></div>
    <div class="picks" style="margin-top:10px">
      ${['p1', 'p2', 'p3', 'p4', 'p5', 'p10'].map((k) => `<span class="pk"><b>${k.toUpperCase()}</b>${esc(nm(p[k]))}</span>`).join('')}
      ${p.dnfs.map((d) => `<span class="pk"><b>DNF</b>${esc(nm(d))}</span>`).join('')}</div></div>`).join('');
}

// ------------------------------------------------------------- scoreboard
async function scoreboardTab(id) {
  const { races, board } = await api(`/leagues/${id}/scoreboard`);
  if (!races.length) return `<div class="panel muted">No race has been scored yet. The scoreboard fills in automatically after the first Grand Prix.</div>`;
  const color = (i) => COLORS[i % COLORS.length];
  const standings = `<div class="panel flush"><div class="scroll"><table><thead><tr><th>#</th><th>Player</th><th class="r">Points</th><th class="r">Last race</th></tr></thead><tbody>
    ${board.map((b, i) => { const last = b.per_race[b.per_race.length - 1]; return `<tr class="${i === 0 ? 'lead' : ''}">
      <td class="num">${i + 1}</td><td><span class="dot" style="background:${color(i)}"></span>${esc(b.name)}</td>
      <td class="r num"><b>${b.total}</b></td><td class="r num ${last.pts ? 'up' : 'same'}">${last.pts ? '+' + last.pts : '='}</td></tr>`; }).join('')}
    </tbody></table></div></div>`;
  return standings + trendChart(races, board, color) + remarks(races, board, color) + perRaceTable(races, board);
}

function trendChart(races, board, color) {
  const W = 760, H = 320, L = 40, R = 16, T = 16, B = 34;
  const max = Math.max(1, ...board.map((b) => b.total));
  const yMax = Math.ceil(max / 2) * 2 || 2;
  const x = (i) => L + (races.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (races.length - 1));
  const y = (v) => T + (H - T - B) * (1 - v / yMax);
  const grid = Array.from({ length: 5 }, (_, i) => Math.round((yMax * i) / 4));
  const lines = board.map((b, bi) => {
    const pts = [{ i: -1, v: 0 }, ...b.per_race.map((p, i) => ({ i, v: p.total }))];
    const px = (i) => (i < 0 ? L - 0 : x(i));
    const d = pts.map((p, k) => `${k ? 'L' : 'M'}${px(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    return `<path d="${d}" fill="none" stroke="${color(bi)}" stroke-width="2.5" stroke-linejoin="round"/>` +
      b.per_race.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.total).toFixed(1)}" r="3.5" fill="${color(bi)}"><title>${esc(b.name)} · ${esc(shortGp(races[i].name))}: ${p.total} pts (${p.pts ? '+' + p.pts : 'no change'})</title></circle>`).join('');
  }).join('');
  const every = Math.ceil(races.length / 12);
  return `<div class="panel chart"><h3>Points over the season</h3>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative points per player after each race">
      ${grid.map((g) => `<line x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}" stroke="#2a2e37"/><text x="${L - 8}" y="${y(g) + 4}" text-anchor="end">${g}</text>`).join('')}
      ${races.map((r, i) => (i % every === 0 ? `<text x="${x(i)}" y="${H - 12}" text-anchor="middle">R${r.round}</text>` : '')).join('')}
      ${lines}
    </svg>
    <div class="legend">${board.map((b, i) => `<span class="small"><span class="dot" style="background:${color(i)}"></span>${esc(b.name)}</span>`).join('')}</div></div>`;
}

function remarks(races, board, color) {
  return `<div class="panel"><h3>Where the points came from</h3>
    ${board.map((b, i) => {
      const up = b.per_race.filter((p) => p.change === 'up').map((p) => `${esc(shortGp(races.find((r) => r.round === p.round).name))} <span class="up">+${p.pts}</span>`);
      const same = b.per_race.filter((p) => p.change === 'same').map((p) => esc(shortGp(races.find((r) => r.round === p.round).name)));
      return `<div class="remark"><span class="dot" style="background:${color(i)}"></span><b>${esc(b.name)}</b><br>
        <span class="up">▲ Score increased:</span> ${up.join(', ') || '<span class="muted">none yet</span>'}<br>
        <span class="same">＝ Score stayed the same:</span> <span class="muted">${same.join(', ') || 'none'}</span></div>`;
    }).join('')}</div>`;
}

function perRaceTable(races, board) {
  return `<div class="panel flush"><div class="scroll"><table><thead><tr><th>Race</th>${board.map((b) => `<th class="r">${esc(b.name)}</th>`).join('')}</tr></thead><tbody>
    ${races.map((r, i) => `<tr><td>R${r.round} · ${esc(shortGp(r.name))}</td>${board.map((b) => { const p = b.per_race[i];
      return `<td class="r ${p.pts ? 'up' : 'same'}">${p.pts ? '+' + p.pts : p.submitted ? '=' : '–'}</td>`; }).join('')}</tr>`).join('')}
    <tr><td><b>Total</b></td>${board.map((b) => `<td class="r"><b>${b.total}</b></td>`).join('')}</tr>
    </tbody></table></div></div><p class="muted small">“–” means no prediction was submitted for that race.</p>`;
}

// ------------------------------------------------------------- race page
const SLOTS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p10'];
let sel = null;
let raceCtx = null;

async function raceView(lid, round) {
  const [data] = await Promise.all([api(`/leagues/${lid}/predictions/${round}`), state.drivers ? null : loadDrivers()]);
  state.offset = data.server_time - Date.now();
  const { race, mine, others, missing, results } = data;
  const finished = !!results;
  // Editable before the race starts; after the start only if nothing valid exists yet (late request).
  const isEditable = !data.locked || !mine || mine.status === 'late_rejected';
  raceCtx = { lid, round, race, locked: data.locked, finished, editable: isEditable };
  sel = { p1: null, p2: null, p3: null, p4: null, p5: null, p10: null, dnfs: Array(DNF_SLOTS).fill(null) };
  if (mine) {
    SLOTS.forEach((k) => (sel[k] = mine[k]));
    mine.dnfs.forEach((d, i) => { if (i < DNF_SLOTS) sel.dnfs[i] = d; });
  }

  let banner = '';
  if (finished && isEditable) banner = `<div class="banner red">This race is already finished, so voting is closed. You can still fill in a prediction and send it: the league admins will be asked to review it and decide whether an exception can be made.</div>`;
  else if (finished) banner = `<div class="banner green">This race is finished. Points are in.</div>`;
  else if (!data.locked) banner = `<div class="banner">Predictions close at the race start: <b>${fmtDate(race.race_ts)}</b> · <span id="cd">…</span></div>`;
  else if (mine && mine.status === 'late_pending') banner = `<div class="banner">⏳ Your late prediction is waiting for approval from a league admin.</div>`;
  else if (mine && mine.status === 'late_rejected') banner = `<div class="banner red">Your late prediction was not accepted. You can send a new one for approval.</div>`;
  else if (!mine) banner = `<div class="banner red">Voting closed when the race started (${fmtDate(race.race_ts)}). You can still submit a late prediction, but a league admin has to approve it.</div>`;
  else banner = `<div class="banner">Predictions are locked. The race is underway.</div>`;

  const points = mine && mine.points !== undefined ? `<span class="chip green">${mine.points} point${mine.points === 1 ? '' : 's'}</span>` : '';
  app.innerHTML = shell(`
    <a class="small muted" href="/league/${lid}/races" data-link>← Back to races</a>
    <div class="row" style="margin:10px 0 16px">${trackImg(race, 'track big')}<div><div class="muted small">Round ${race.round}</div>
      <h1>${esc(race.name)}</h1><div class="muted">${esc(race.circuit_name)} · ${esc(race.locality)}, ${esc(race.country)}</div>
      <div class="muted small">${fmtDate(race.race_ts)}</div></div></div>
    ${banner}
    <div class="panel"><div class="row between"><h2>Your prediction</h2>${points}</div>
      <div id="slots"></div>
      ${isEditable ? `<p><button class="primary" data-act="save">${data.locked ? 'Send late prediction for approval' : 'Save prediction'}</button></p>` : ''}
    </div>
    ${results ? resultsPanel(results) : ''}
    ${data.locked ? othersPanel(others, missing, !!results) : `<p class="muted small">Other players' predictions become visible when the race starts.</p>`}`);
  paintSlots(mine && mine.detail);
  if (!data.locked) startCountdown('cd', race.race_ts, 'closes in ');
}

function slotButton(key, label, id, detail, idx) {
  const d = id ? driverById(id) : null;
  let cls = d ? '' : 'empty';
  if (detail) cls += (key === 'dnf' ? detail.dnfs[idx] : detail[key]) ? ' ok' : ' bad';
  return `<button class="slot ${cls}" data-act="pick" data-slot="${key === 'dnf' ? 'dnf' + idx : key}" ${raceCtx.editable ? '' : 'disabled'}>
    <span class="pos">${label}</span>${d ? avatar(d, 44) : '<span class="av" style="--s:44px"></span>'}
    <span class="who">${d ? `<b>${esc(d.name)}</b><span class="muted small">${esc(d.team || '')}</span>` : `<span>${raceCtx.editable ? 'Choose a driver' : 'No pick'}</span>`}</span></button>`;
}

function paintSlots(detail) {
  const el = document.getElementById('slots');
  if (!el) return;
  el.innerHTML = `<h3 class="muted small" style="text-transform:uppercase;letter-spacing:.05em">Finishing order</h3>
    <div class="slots">${SLOTS.map((k) => slotButton(k, k.toUpperCase(), sel[k], detail)).join('')}</div>
    <h3 class="muted small" style="text-transform:uppercase;letter-spacing:.05em;margin-top:16px">Drivers who will not finish (up to ${DNF_SLOTS}, optional)</h3>
    <div class="slots">${sel.dnfs.map((id, i) => slotButton('dnf', 'DNF', id, detail, i)).join('')}</div>`;
}

function openPicker(slot) {
  const used = new Set([...SLOTS.map((k) => sel[k]), ...sel.dnfs].filter(Boolean));
  const current = slot.startsWith('dnf') ? sel.dnfs[Number(slot.slice(3))] : sel[slot];
  const title = slot.startsWith('dnf') ? 'Pick a driver who will not finish' : `Who finishes ${slot.toUpperCase()}?`;
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `<div class="sheet"><div class="row between"><h2>${title}</h2><button data-act="close-modal">Close</button></div>
    <div class="pick-grid" style="margin-top:12px">
    ${state.drivers.map((d) => `<button class="slot pick" data-act="choose" data-slot="${slot}" data-id="${esc(d.driver_id)}" style="${used.has(d.driver_id) && d.driver_id !== current ? 'opacity:.4' : ''}" title="${used.has(d.driver_id) && d.driver_id !== current ? 'Already picked: choosing again moves them here' : ''}">
      ${avatar(d, 64)}<b>${esc(d.name)}</b><small>${esc(d.team || '')}${d.number ? ' · #' + esc(d.number) : ''}</small></button>`).join('')}
    </div>${current ? `<p><button class="ghost danger" data-act="choose" data-slot="${slot}" data-id="">Clear this pick</button></p>` : ''}</div>`;
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

function resultsPanel(results) {
  const list = results.top10.map((id, i) => { const d = driverById(id); return d ? `<div>${avatar(d, 36)}<span><b class="num">P${i + 1}</b> ${esc(d.name)}</span></div>` : ''; }).join('');
  const dnf = results.dnf.map((id) => { const d = driverById(id); return d ? esc(d.name) : ''; }).filter(Boolean).join(', ');
  return `<div class="panel"><h2>Official result (top 10)</h2><div class="result-list">${list}</div>
    <p class="muted small" style="margin-top:12px">Did not finish: ${dnf || 'nobody'}</p></div>`;
}

function othersPanel(others, missing, scored) {
  const nm = (id) => { const d = driverById(id); return d ? d.code || d.name : '?'; };
  const card = (p) => `<div class="panel" style="margin-bottom:10px"><div class="row between"><b>${esc(p.user_name)}</b>${scored ? `<span class="chip green">${p.points} pt${p.points === 1 ? '' : 's'}</span>` : ''}</div>
    <div class="picks" style="margin-top:8px">${SLOTS.map((k) => `<span class="pk ${p.detail && p.detail[k] ? 'ok' : ''}"><b>${k.toUpperCase()}</b>${esc(nm(p[k]))}</span>`).join('')}
    ${p.dnfs.map((d, i) => `<span class="pk ${p.detail && p.detail.dnfs[i] ? 'ok' : ''}"><b>DNF</b>${esc(nm(d))}</span>`).join('')}</div></div>`;
  return `<h2>Everyone's predictions</h2>${others.map(card).join('') || '<p class="muted">Nobody else has a valid prediction for this race.</p>'}
    ${missing.length ? `<p class="muted small">No prediction from: ${missing.map(esc).join(', ')}</p>` : ''}`;
}

// -------------------------------------------------------- click handling
const actions = {
  authmode(el) { authMode = el.dataset.mode; location.pathname.startsWith('/join/') ? render() : authView(); },
  async logout() { await api('/logout', { method: 'POST' }); state.me = null; go('/'); },
  async bell() {
    const box = document.getElementById('notes');
    if (!box.hidden) { box.hidden = true; return; }
    await refreshBadge();
    const list = state.notes || [];
    box.innerHTML = list.length
      ? list.map((n) => `<a class="note ${n.read ? '' : 'unread'}" href="${esc(n.link || '/')}" data-link>${esc(n.text)}<div class="muted small">${fmtDate(n.created_at)}</div></a>`).join('')
      : '<div class="note muted">No notifications yet.</div>';
    box.hidden = false;
    api('/notifications/read', { method: 'POST' }).then(() => { const b = document.getElementById('badge'); if (b) b.innerHTML = ''; }).catch(() => {});
  },
  async join(el) {
    try { const r = await api('/join/' + el.dataset.code, { method: 'POST' }); go('/league/' + r.league_id); } catch (e) { fail(e); }
  },
  copy() {
    const i = document.getElementById('invite-link');
    i.select();
    navigator.clipboard?.writeText(i.value).then(() => toast('Link copied'), () => document.execCommand('copy'));
  },
  async regen(el) {
    if (!confirm('The old invite link will stop working. Continue?')) return;
    try { await api(`/leagues/${el.dataset.id}/regenerate-invite`, { method: 'POST' }); toast('New link created'); render(); } catch (e) { fail(e); }
  },
  async role(el) {
    try { await api(`/leagues/${el.dataset.id}/members/${el.dataset.uid}`, { method: 'POST', body: { role: el.dataset.role } }); render(); } catch (e) { fail(e); }
  },
  async resetpw(el) {
    if (!confirm(`Reset the password of ${el.dataset.name}? They will have to choose a new one at their next login.`)) return;
    try {
      const r = await api(`/leagues/${el.dataset.id}/members/${el.dataset.uid}/reset-password`, { method: 'POST' });
      prompt(`Random temporary password for ${el.dataset.name}. Copy it and send it to them privately (shown only once; they must choose a new one when they log in):`, r.temp_password);
    } catch (e) { fail(e); }
  },
  async kick(el) {
    if (!confirm(`Remove ${el.dataset.name} from the league? Their predictions in this league will be deleted.`)) return;
    try { await api(`/leagues/${el.dataset.id}/members/${el.dataset.uid}`, { method: 'DELETE' }); render(); } catch (e) { fail(e); }
  },
  async leave(el) {
    if (!confirm('Leave this league? Your predictions in it will be deleted.')) return;
    try { await api(`/leagues/${el.dataset.id}/members/${state.me.id}`, { method: 'DELETE' }); go('/'); } catch (e) { fail(e); }
  },
  async 'delete-league'(el) {
    if (!confirm('Delete this league for everyone? This cannot be undone.')) return;
    try { await api(`/leagues/${el.dataset.id}`, { method: 'DELETE' }); go('/'); } catch (e) { fail(e); }
  },
  async decide(el) {
    try { await api(`/leagues/${el.dataset.id}/pending/${el.dataset.pid}`, { method: 'POST', body: { action: el.dataset.action } }); toast(el.dataset.action === 'approve' ? 'Approved' : 'Rejected'); render(); } catch (e) { fail(e); }
  },
  pick(el) { if (raceCtx?.editable) openPicker(el.dataset.slot); },
  'close-modal'() { document.querySelector('.modal')?.remove(); },
  choose(el) {
    const slot = el.dataset.slot, id = el.dataset.id || null;
    if (id) { // a driver can only be used once: take them out of their previous place
      for (const k of SLOTS) if (sel[k] === id) sel[k] = null;
      sel.dnfs = sel.dnfs.map((d) => (d === id ? null : d));
    }
    if (slot.startsWith('dnf')) sel.dnfs[Number(slot.slice(3))] = id; else sel[slot] = id;
    document.querySelector('.modal')?.remove();
    paintSlots();
  },
  async save(el) {
    const body = { ...Object.fromEntries(SLOTS.map((k) => [k, sel[k]])), dnfs: sel.dnfs.filter(Boolean) };
    if (SLOTS.some((k) => !body[k])) return toast('Pick a driver for P1–P5 and P10 first.', true);
    if (raceCtx.locked && !confirm('This race has already started, so voting is closed. Your prediction will be sent to the league admins, who will review it and decide whether an exception can be made. Send it?')) return;
    el.disabled = true;
    try {
      const r = await api(`/leagues/${raceCtx.lid}/predictions/${raceCtx.round}`, { method: 'PUT', body });
      toast(r.status === 'late_pending' ? 'Too late for normal voting. Sent to the league admins for approval' : 'Prediction saved');
      render();
    } catch (e) { fail(e); el.disabled = false; }
  },
};

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-link]');
  if (link && !e.metaKey && !e.ctrlKey) { e.preventDefault(); go(link.getAttribute('href')); return; }
  const btn = e.target.closest('[data-act]');
  if (btn && actions[btn.dataset.act]) actions[btn.dataset.act](btn, e);
  else if (!e.target.closest('.bell')) { const n = document.getElementById('notes'); if (n) n.hidden = true; }
});

const forms = {
  async auth(f) {
    const body = Object.fromEntries(new FormData(f));
    try {
      const r = await api(authMode === 'register' ? '/register' : '/login', { method: 'POST', body });
      state.me = r.user;
      const join = location.pathname.match(/^\/join\/([a-z0-9]+)$/);
      if (join) { const j = await api('/join/' + join[1], { method: 'POST' }); go('/league/' + j.league_id); } else go('/');
    } catch (e) { fail(e); }
  },
  async password(f) {
    try {
      await api('/account/password', { method: 'POST', body: Object.fromEntries(new FormData(f)) });
      state.me.must_change = 0; toast('Password changed'); go('/');
    } catch (e) { fail(e); }
  },
  async team(f) {
    try {
      const r = await api('/account/team', { method: 'POST', body: Object.fromEntries(new FormData(f)) });
      state.me.favorite_team = r.favorite_team;
      if (r.favorite_team && !state.drivers) await loadDrivers();
      toast(r.favorite_team ? 'Favorite team saved' : 'Favorite team cleared'); render();
    } catch (e) { fail(e); }
  },
  async newleague(f) {
    try { const r = await api('/leagues', { method: 'POST', body: Object.fromEntries(new FormData(f)) }); go(`/league/${r.id}/members`); } catch (e) { fail(e); }
  },
  async 'invite-email'(f) {
    try { await api(`/leagues/${f.dataset.id}/invite-email`, { method: 'POST', body: Object.fromEntries(new FormData(f)) }); toast('Invite sent'); f.reset(); } catch (e) { fail(e); }
  },
};
document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form]');
  if (f) { e.preventDefault(); forms[f.dataset.form](f); }
});

render();
