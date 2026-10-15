/* F1 Vietiniai Predictions - front-end (no build step, plain JavaScript) */
'use strict';

const app = document.getElementById('app');
const state = { me: null, appName: 'F1 Predictions', drivers: null, races: null, offset: 0, notes: null };
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
// ----------------------------------------------------------- user pictures
// u: { id, name, avatar } where avatar is 'helmet:<team>', 'team:<team>', 'url:<image>', 'upload:<time>' or empty.
function helmetSvg(color) {
  return `<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" fill="#1b1e25"/>
    <path d="M9 40c0-15 12-27 28-27 11 0 19 8 19 19v9c0 5-4 9-9 9H19c-6 0-10-4-10-10z" fill="${color}"/>
    <path d="M9 41h40" stroke="#fff" stroke-width="3" opacity=".85"/>
    <path d="M30 25h26v11H35c-3 0-5-2-5-5z" fill="#0b0c10"/><path d="M33 27h21v3H34z" fill="#fff" opacity=".18"/>
    <path d="M19 50h28" stroke="#000" stroke-width="2" opacity=".25"/></svg>`;
}
const AV_COLORS = ['#e10600', '#3b9eff', '#2fbf71', '#f0b429', '#b07cff', '#ff8a3d', '#22d3c5', '#f472b6'];
function userAvatar(u, size = 32) {
  const a = (u && u.avatar) || '';
  const box = (inner, style = '') => `<span class="uav" style="--s:${size}px;${style}">${inner}</span>`;
  const img = (src) => `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`;
  if (a.startsWith('upload:')) return box(img(`/api/avatars/${u.id}?v=${encodeURIComponent(a.slice(7))}`));
  if (a.startsWith('url:')) return box(img(a.slice(4)), 'background:#2b303a');
  const team = (a.startsWith('helmet:') || a.startsWith('team:')) && teamBySlug(a.slice(a.indexOf(':') + 1));
  if (team && a.startsWith('helmet:')) return box(helmetSvg(team.color));
  if (team) return box(`<img class="logo" src="${esc(team.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">`, `background:${esc(team.color)}`);
  const name = String((u && u.name) || '?');
  const color = AV_COLORS[[...name].reduce((h, c) => h + c.charCodeAt(0), 0) % AV_COLORS.length];
  return box(`<span class="ini">${esc(name.slice(0, 1).toUpperCase())}</span>`, `background:${color}`);
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
const FLAGS = { australia: 'au', china: 'cn', japan: 'jp', usa: 'us', 'united states': 'us', canada: 'ca', monaco: 'mc', spain: 'es', austria: 'at',
  uk: 'gb', 'united kingdom': 'gb', 'great britain': 'gb', belgium: 'be', hungary: 'hu', netherlands: 'nl', italy: 'it', azerbaijan: 'az', bahrain: 'bh',
  singapore: 'sg', mexico: 'mx', brazil: 'br', uae: 'ae', 'united arab emirates': 'ae', qatar: 'qa', 'saudi arabia': 'sa', malaysia: 'my', portugal: 'pt',
  france: 'fr', germany: 'de', turkey: 'tr', 'south korea': 'kr', korea: 'kr', russia: 'ru', india: 'in', argentina: 'ar', 'south africa': 'za', morocco: 'ma', vietnam: 'vn' };
const flagImg = (country) => {
  const c = FLAGS[String(country || '').toLowerCase()];
  return c ? `<img class="flag" src="https://flagcdn.com/w40/${c}.png" srcset="https://flagcdn.com/w80/${c}.png 2x" alt="${esc(country)}" title="${esc(country)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
};
const trackImg = (r, cls = 'track') => {
  const pic = r.circuit_image ? `<img class="${cls}" src="${esc(r.circuit_image)}" alt="${esc(r.circuit_name)} layout" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : `<div class="track-ph">🏁</div>`;
  return `<span class="trackbox ${cls.includes('big') ? 'big' : ''}">${pic}${flagImg(r.country)}</span>`;
};

// ----------------------------------------------------------------- shell
function shell(inner) {
  const u = state.me;
  return `<div class="wrap ${state.me && teamBySlug(state.me.favorite_team) ? 'withside' : ''}">
    <header class="topbar">
      <a class="brand" href="/" data-link><img class="f1logo" src="/f1-logo.png" alt="F1" onerror="this.outerHTML='<span class=&quot;logo&quot;>F1</span>'"> ${esc(state.appName)}</a>
      <span class="spacer"></span>
      ${u ? `<a class="wpc-link" href="/wpc" data-link title="World Prediction Champion">${cupSvg('gold', 18)}<span>WPC</span></a><div class="bell"><button data-act="bell" aria-label="Notifications">🔔<span id="badge"></span></button>
        <div id="notes" class="notes" hidden></div></div>
        <a class="me-link" href="/account" data-link title="Your account: picture, team, password">${userAvatar(u, 30)}<span class="muted small">${esc(u.name)}</span></a>
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
    if (path === '/wpc' || (m = path.match(/^\/wpc\/(\d{4})$/))) return await wpcView(m ? Number(m[1]) : null);
    if ((m = path.match(/^\/player\/(\d+)$/))) return await playerView(`/players/${m[1]}`);
    if ((m = path.match(/^\/player\/h\/(.+)$/))) return await playerView(`/players/h/${m[1]}`);
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
      <label for="a-user">Username${authMode === 'register' ? ' (shown to league members)' : ''}</label>
      <input id="a-user" name="username" required ${authMode === 'register' ? 'minlength="3" maxlength="24"' : ''} autocomplete="username" autocapitalize="off" spellcheck="false">
      ${authMode === 'login' ? '<p class="muted small" style="margin:4px 0 0">Made your account with an email address? Your username is the name you chose then, or log in with that email.</p>' : ''}
      <label for="a-pass">Password ${authMode === 'register' ? '(min. 8 characters)' : ''}</label>
      <input id="a-pass" name="password" type="password" required minlength="${authMode === 'register' ? 8 : 1}" autocomplete="${authMode === 'register' ? 'new-password' : 'current-password'}">
      ${authMode === 'register' ? `<label for="team-sel">Favorite team (optional)</label>${teamSelect('')}` : ''}
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
  if (!forced && !state.drivers) loadDrivers().then(() => { const g = document.getElementById('av-drivers'); if (g) g.innerHTML = avatarChoices('driver'); }).catch(() => {});
  app.innerHTML = shell(`<div class="auth">${forced ? '' : avatarPanel()}${forced ? '' : `<div class="panel"><h2>Favorite team</h2>
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

function avatarChoices(kind) {
  const on = (v) => (state.me.avatar === v ? ' on' : '');
  const btn = (value, inner, title) => `<button class="avopt${on(value)}" data-act="set-avatar" data-avatar="${esc(value)}" title="${esc(title)}">${inner}</button>`;
  const teams = state.teams || [];
  if (kind === 'helmet') return teams.map((t) => btn(`helmet:${t.slug}`, userAvatar({ avatar: `helmet:${t.slug}` }, 52), `${t.name} helmet`)).join('');
  if (kind === 'team') return teams.map((t) => btn(`team:${t.slug}`, userAvatar({ avatar: `team:${t.slug}` }, 52), t.name)).join('');
  const drivers = (state.drivers || []).filter((d) => d.photo_url);
  if (!drivers.length) return '<p class="muted small">Loading drivers…</p>';
  return drivers.map((d) => btn(`driver:${d.driver_id}`, `<span class="uav" style="--s:52px;background:#2b303a"><img src="${esc(d.photo_url)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>`, d.name)).join('');
}

function avatarPanel() {
  return `<div class="panel"><h2>Your picture</h2>
    <div class="row" style="gap:16px;margin-bottom:6px">${userAvatar(state.me, 80)}
      <div><p class="muted small" style="margin:0 0 8px">League members see it next to your name.</p>
        <div class="row"><label class="btn" style="margin:0;color:var(--text)">Upload a photo<input type="file" accept="image/*" data-avatar-file hidden></label>
        ${state.me.avatar ? '<button class="ghost small" data-act="set-avatar" data-avatar="">Remove</button>' : ''}</div></div></div>
    <h3 class="avhead">Helmets</h3><div class="avgrid">${avatarChoices('helmet')}</div>
    <h3 class="avhead">Teams</h3><div class="avgrid">${avatarChoices('team')}</div>
    <h3 class="avhead">Drivers</h3><div class="avgrid" id="av-drivers">${avatarChoices('driver')}</div></div>`;
}

// Crops the chosen photo to a square around its centre and shrinks it to 256x256 before upload.
async function uploadAvatar(file) {
  if (!file || !file.type.startsWith('image/')) { toast('Please choose a picture', true); return; }
  try {
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    canvas.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
    const image = canvas.toDataURL('image/jpeg', 0.85);
    const r = await api('/account/avatar', { method: 'POST', body: { image } });
    state.me.avatar = r.avatar;
    toast('Picture saved');
    accountView();
  } catch (e) { fail(e.status ? e : new Error('This picture could not be read. Try a JPG or PNG.')); }
}
document.addEventListener('change', (e) => { if (e.target.matches('[data-avatar-file]')) uploadAvatar(e.target.files[0]); });

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
    </div>` : ''}
    <div class="panel flush"><div class="scroll"><table><thead><tr><th>Member</th><th>Role</th><th class="r"></th></tr></thead><tbody>
    ${info.members.map((m) => `<tr><td><a class="who-row plain" href="/player/${m.id}" data-link>${userAvatar(m, 32)}<span>${esc(m.name)}${m.id === me ? ' <span class="muted">(you)</span>' : ''}</span></a></td>
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
    <div class="row between"><div><h3 class="who-row">${userAvatar({ id: p.user_id, name: p.user_name, avatar: p.user_avatar }, 32)}<span>${esc(p.user_name)} · ${esc(p.race_name)}</span></h3>
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
      <td class="num">${i + 1}</td><td><span class="who-row"><span class="dot" style="background:${color(i)}"></span><a class="who-row plain" href="/player/${b.id}" data-link>${formAvatar(b, 30, formOf(b.per_race))}<span>${esc(b.name)}</span></a></span></td>
      <td class="r num"><b>${b.total}</b></td><td class="r num ${last.pts ? 'up' : 'same'}">${last.pts ? '+' + last.pts : '='}</td></tr>`; }).join('')}
    </tbody></table></div></div>`;
  return standings + trendChart(races, board, color) + remarks(races, board, color) + perRaceTable(races, board);
}

function trendChart(races, board, color) {
  const W = 760, H = 320, L = 40, R = 30, T = 16, B = 34;
  const max = Math.max(1, ...board.map((b) => b.total));
  const yMax = Math.ceil(max / 2) * 2 || 2;
  const x = (i) => L + (races.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (races.length - 1));
  const y = (v) => T + (H - T - B) * (1 - v / yMax);
  const grid = Array.from({ length: 5 }, (_, i) => Math.round((yMax * i) / 4));
  const forms = board.map((b) => (b.form === undefined ? formOf(b.per_race) : b.form));
  const lines = board.map((b, bi) => {
    const pts = [{ i: -1, v: 0 }, ...b.per_race.map((p, i) => ({ i, v: p.total }))];
    const px = (i) => (i < 0 ? L - 0 : x(i));
    const d = pts.map((p, k) => `${k ? 'L' : 'M'}${px(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    return `<path d="${d}" fill="none" stroke="${color(bi)}" stroke-width="2.5" stroke-linejoin="round"/>` +
      b.per_race.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.total).toFixed(1)}" r="3.5" fill="${color(bi)}"><title>${esc(b.name)} · ${esc(shortGp(races[i].name))}: ${p.total} pts (${p.pts ? '+' + p.pts : 'no change'})</title></circle>`).join('') +
      (forms[bi] && b.per_race.length ? `<text x="${(x(b.per_race.length - 1) + 7).toFixed(1)}" y="${(y(b.per_race[b.per_race.length - 1].total) + 5).toFixed(1)}" class="form-emoji">${forms[bi].kind === 'fire' ? '🔥' : '🧊'}</text>` : '');
  }).join('');
  const every = Math.ceil(races.length / 26);
  return `<div class="panel chart"><h3>Points over the season</h3>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative points per player after each race">
      ${grid.map((g) => `<line x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}" stroke="#2a2e37"/><text x="${L - 8}" y="${y(g) + 4}" text-anchor="end">${g}</text>`).join('')}
      ${races.map((r, i) => (i % every === 0 ? `<text x="${x(i)}" y="${H - 12}" text-anchor="middle" class="rc">${raceCode(r.name)}<title>${esc(r.name)}</title></text>` : '')).join('')}
      ${lines}
    </svg>
    <div class="legend">${board.map((b, i) => `<span class="small who-row" style="gap:6px"><span class="dot" style="background:${color(i)};margin:0"></span>${formAvatar(b.user || b, 24, forms[i])}${esc(b.name)}</span>`).join('')}</div></div>`;
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
    ${races.map((r, i) => `<tr><td><span class="rcode">${raceCode(r.name)}</span> ${esc(shortGp(r.name))}</td>${board.map((b) => { const p = b.per_race[i];
      return `<td class="r ${p.pts ? 'up' : 'same'}">${p.pts ? '+' + p.pts : p.submitted ? '=' : '–'}</td>`; }).join('')}</tr>`).join('')}
    <tr><td><b>Total</b></td>${board.map((b) => `<td class="r"><b>${b.total}</b></td>`).join('')}</tr>
    </tbody></table></div></div><p class="muted small">“–” means no prediction was submitted for that race.</p>`;
}

// Short race labels for charts ("AUS", "MON"…); the full name is in the tooltip.
const RACE_CODES = [['Australia', 'AUS'], ['Chin', 'CHN'], ['Japan', 'JPN'], ['Bahrain', 'BHR'], ['Saudi', 'KSA'], ['Miami', 'MIA'], ['Emilia', 'IMO'],
  ['Monaco', 'MON'], ['Barcelona', 'BAR'], ['Spanish', 'ESP'], ['Spain', 'ESP'], ['Madrid', 'MAD'], ['Canad', 'CAN'], ['Austria', 'AUT'], ['British', 'GBR'], ['Belgi', 'BEL'],
  ['Hungar', 'HUN'], ['Dutch', 'NED'], ['Ital', 'ITA'], ['Azerbaijan', 'AZE'], ['Singapore', 'SIN'], ['United States', 'USA'], ['Mexic', 'MEX'],
  ['Paulo', 'BRA'], ['Brazil', 'BRA'], ['Vegas', 'LVG'], ['Qatar', 'QAT'], ['Abu Dhabi', 'ABU'], ['Portug', 'POR'], ['Turk', 'TUR'], ['French', 'FRA']];
function raceCode(name) {
  const hit = RACE_CODES.find(([k]) => String(name).includes(k));
  return hit ? hit[1] : String(name).replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
}

// Form over the last 3 scored races compared with the player's own average:
// on fire = clearly better than usual, icy = clearly worse (or nothing at all).
function formOf(perRace) {
  const pts = perRace.map((p) => p.pts || 0);
  if (pts.length < 4) return null;
  const recent = pts.slice(-3);
  const recentAvg = recent.reduce((a, b) => a + b, 0) / 3;
  const avg = pts.reduce((a, b) => a + b, 0) / pts.length;
  if (recentAvg >= Math.max(2, avg * 1.5)) return { kind: 'fire', tip: `On fire: ${recent.join(' + ')} points in the last 3 races (usually ${avg.toFixed(1)} per race)` };
  if (recentAvg === 0 || (avg >= 1 && recentAvg <= avg * 0.4)) return { kind: 'ice', tip: `Ice cold: ${recent.join(' + ')} points in the last 3 races (usually ${avg.toFixed(1)} per race)` };
  return null;
}
function formAvatar(u, size, form) {
  if (!form) return userAvatar(u, size);
  return `<span class="form ${form.kind}" title="${esc(form.tip)}">${userAvatar(u, size)}<i>${form.kind === 'fire' ? '🔥' : '🧊'}</i></span>`;
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
    <div id="insights"><div class="panel muted small">Loading qualifying and track history…</div></div>
    ${results ? resultsPanel(results) : ''}
    ${data.locked ? `<div id="board-box">${predictionBoard(mine, others, missing, !!results, round)}</div>` : `<p class="muted small">Other players' predictions become visible when the race starts.</p>`}`);
  paintSlots(mine && mine.detail);
  if (!data.locked) startCountdown('cd', race.race_ts, 'closes in ');
  loadInsights(round);
}

// ---------------------------------------------- qualifying + track history
async function loadInsights(round) {
  let data;
  try { data = await api(`/races/${round}/insights`); } catch { data = null; }
  const el = document.getElementById('insights');
  if (!el || !raceCtx || raceCtx.round !== round) return; // the user moved on to another page
  if (!data) { el.innerHTML = '<div class="panel muted small">Qualifying and track history could not be loaded right now.</div>'; return; }
  el.innerHTML = `<div id="quali-box">${qualiPanel(data.qualifying)}</div><div id="hist-box">${historyPanel(data.history)}</div>`;
  if (['loading', 'partial'].includes(data.history.status)) collectHistory(round, data.history);
  if (data.qualifying.live) watchQualifying(round);
}

// While qualifying is underway or the race is still to start, the server re-reads formula1.com when
// the page is opened (at most once a minute for everybody), and an open page asks again every 2 minutes.
let qualiTimer = null;
function watchQualifying(round) {
  clearInterval(qualiTimer);
  qualiTimer = setInterval(async () => {
    const box = document.getElementById('quali-box');
    if (!box || !raceCtx || raceCtx.round !== round) { clearInterval(qualiTimer); return; }
    if (document.hidden) return;
    try {
      const q = (await api(`/races/${round}/insights`)).qualifying;
      box.innerHTML = qualiPanel(q);
      if (!q.live) clearInterval(qualiTimer);
    } catch { /* keep the table we have */ }
  }, 120000);
}

function ago(ts) {
  const s = Math.max(0, Math.round((nowTs() - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return fmtDate(ts);
}

// Past races come from the Jolpica F1 API. Its servers turn away requests from Cloudflare, so the
// browser of the first player who opens a race page collects the history and the app stores it for
// everyone (once per circuit). Overtakes and lead changes are worked out from the lap-by-lap positions.
const JOLPICA = 'https://api.jolpi.ca/ergast/f1';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let collecting = null;

async function jolpica(path) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await pause(300);
    const res = await fetch(JOLPICA + path);
    if (res.status === 429) { await pause((Number(res.headers.get('retry-after')) || 5 * (attempt + 1)) * 1000); continue; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }
  throw new Error('busy');
}

function showHistory(round, h, note) {
  const box = document.getElementById('hist-box');
  if (box && raceCtx && raceCtx.round === round) box.innerHTML = historyPanel(h, note);
}

async function collectHistory(round, h) {
  if (collecting === h.circuit_id) return;
  collecting = h.circuit_id;
  try {
    if (h.status === 'loading') {
      showHistory(round, h, 'Looking up past winners…');
      const byPos = [];
      for (const p of [1, 2, 3]) byPos.push((await jolpica(`/circuits/${h.circuit_id}/results/${p}.json?limit=100`)).MRData.RaceTable.Races || []);
      const editions = byPos[0].filter((r) => Number(r.season) < h.season).slice(-h.years).map((r) => ({
        season: Number(r.season), round: Number(r.round), race_name: r.raceName,
        podium: byPos.map((list) => {
          const x = list.find((y) => y.season === r.season)?.Results?.[0];
          return x ? { driver_id: x.Driver.driverId, code: x.Driver.code || null, name: `${x.Driver.givenName} ${x.Driver.familyName}`, team: x.Constructor?.name || null, grid: Number(x.grid) || null } : null;
        }),
      }));
      await api(`/races/${round}/history`, { method: 'POST', body: { editions } });
      h = (await api(`/races/${round}/insights`)).history;
    }
    const todo = h.editions.filter((e) => !e.stats_done);
    for (let i = 0; i < todo.length; i++) {
      const ed = todo[i];
      showHistory(round, h, `Counting overtakes and lead changes: ${ed.season} (${i + 1} of ${todo.length})…`);
      const stats = await editionStats(ed);
      await api(`/races/${round}/history/${ed.season}`, { method: 'POST', body: stats });
      Object.assign(ed, stats, { stats_done: true });
    }
    h.status = 'ready';
    showHistory(round, h);
  } catch {
    showHistory(round, h, 'The race data service is busy right now. Open this page again later to finish the history.');
  } finally {
    collecting = null;
  }
}

async function editionStats(ed) {
  const laps = [];
  for (let offset = 0, total = 1; offset < total; offset += 100) {
    const d = await jolpica(`/${ed.season}/${ed.round}/laps.json?limit=100&offset=${offset}`);
    total = Number(d.MRData.total) || 0;
    const page = d.MRData.RaceTable.Races?.[0]?.Laps || [];
    if (!page.length) break;
    for (const lap of page) {
      const same = laps.find((l) => l.number === lap.number);
      if (same) same.Timings.push(...lap.Timings); // a lap can be split over two pages
      else laps.push({ number: lap.number, Timings: [...lap.Timings] });
    }
  }
  if (!laps.length) return { laps: null, lead_changes: null, leaders: null, overtakes: null };
  const d = await jolpica(`/${ed.season}/${ed.round}/pitstops.json?limit=100`);
  const pits = new Set((d.MRData.RaceTable.Races?.[0]?.PitStops || []).map((p) => `${p.driverId}:${p.lap}`));
  return lapStats(laps, pits);
}

// A position swap between two laps counts as an overtake unless one of the two was in the pits on
// that lap or the lap after (in-lap / out-lap), or the passed car was over 15% slower than the field
// that lap (damage, a spin, retiring). The opening lap is not counted. Checked against real races:
// Monaco 2024 gives 7, Singapore 2025 gives 28; without the pit filter Singapore would show over 100.
function lapStats(laps, pits) {
  const secs = (t) => { const m = String(t || '').match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/); return m ? Number(m[1] || 0) * 60 + Number(m[2]) : null; };
  const sorted = [...laps].sort((a, b) => a.number - b.number);
  let leadChanges = 0, overtakes = 0, prev = null;
  const leaders = new Set();
  for (const lap of sorted) {
    const n = Number(lap.number);
    const pos = new Map(lap.Timings.map((t) => [t.driverId, Number(t.position)]));
    const time = new Map(lap.Timings.map((t) => [t.driverId, secs(t.time)]));
    const all = [...time.values()].filter(Boolean).sort((a, b) => a - b);
    const median = all[Math.floor(all.length / 2)];
    const leader = lap.Timings.find((t) => Number(t.position) === 1)?.driverId;
    if (leader) leaders.add(leader);
    if (prev) {
      if (leader && prev.leader && leader !== prev.leader) leadChanges++;
      const ids = [...pos.keys()].filter((id) => prev.pos.has(id) && !pits.has(`${id}:${n}`) && !pits.has(`${id}:${n - 1}`));
      for (const a of ids) for (const b of ids) {
        if (a !== b && prev.pos.get(a) > prev.pos.get(b) && pos.get(a) < pos.get(b) && !(median && time.get(b) > median * 1.15)) overtakes++;
      }
    }
    prev = { leader, pos };
  }
  return { laps: sorted.length, lead_changes: leadChanges, leaders: leaders.size, overtakes };
}

const surname = (name) => String(name || '').split(' ').slice(-1)[0];
function driverCell(r, size = 32) {
  const d = (r.driver_id && driverById(r.driver_id)) || (state.drivers || []).find((x) => x.code && x.code === r.code);
  return `<span class="drv">${avatar(d || { code: r.code }, size)}<span><b>${esc(r.name)}</b><span class="muted small team-sm">${esc(r.team || '')}</span></span></span>`;
}

function qualiPanel(q) {
  const head = `<div class="row between"><h2>Qualifying</h2>${q.link ? `<a class="small muted" href="${esc(q.link)}" target="_blank" rel="noopener">formula1.com ↗</a>` : ''}</div>`;
  const checked = q.live && q.checked_at ? ` <span class="muted small">· checked ${ago(q.checked_at)}</span>` : '';
  if (q.status === 'not_yet') {
    return `<div class="panel">${head}<p class="muted">Qualifying results are not public yet.${q.quali_ts ? ` Qualifying starts <b>${fmtDate(q.quali_ts)}</b>.` : ''}</p></div>`;
  }
  if (q.status === 'waiting') {
    return `<div class="panel">${head}<p class="muted">Qualifying results are not public yet.${checked} They appear here as soon as formula1.com publishes them.</p></div>`;
  }
  const hasGrid = q.rows.some((r) => r.grid);
  const best = (r) => r.q3 || r.q2 || r.q1;
  const rows = q.rows.map((r) => {
    const cut = r.position === 10 || r.position === 15 ? ' class="cut"' : '';
    const t = (v) => `<td class="r${v && v === best(r) ? ' best' : ''}">${v ? esc(v) : '<span class="muted">-</span>'}</td>`;
    let grid = '';
    if (hasGrid) {
      const moved = r.grid && /^\d+$/.test(r.grid) && /^\d+$/.test(r.pos_text) && Number(r.grid) !== Number(r.pos_text);
      const cls = !moved ? '' : Number(r.grid) > Number(r.pos_text) ? ' down' : ' up';
      grid = `<td class="r grid${cls}"><b>${r.grid ? esc(r.grid) : '<span class="muted">-</span>'}</b></td>`;
    }
    return `<tr${cut}><td class="num"><b>${esc(r.pos_text)}</b></td><td>${driverCell(r)}</td>${t(r.q1)}${t(r.q2)}${t(r.q3)}${grid}</tr>`;
  }).join('');
  const note = hasGrid
    ? 'Grid is the official starting grid, after penalties (red: starts further back than qualified).'
    : 'This is the qualifying order. The official starting grid (after penalties) is added here when it is published.';
  return `<div class="panel">${head}${checked ? `<div style="margin:-4px 0 8px">${checked}</div>` : ''}
    <div class="scroll"><table class="quali"><thead><tr><th>Pos</th><th>Driver</th><th class="r">Q1</th><th class="r">Q2</th><th class="r">Q3</th>${hasGrid ? '<th class="r">Grid</th>' : ''}</tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted small" style="margin-top:8px">${note}${q.source === 'jolpica' ? ' Source: Jolpica F1.' : ''}</p></div>`;
}

function historyPanel(h, note) {
  const head = `<h2>Track history</h2>`;
  const noteHtml = note ? `<p class="hist-note">${esc(note)}</p>` : '';
  if (h.status === 'loading') return `<div class="panel">${head}${noteHtml || '<p class="muted">Collecting the history of this track…</p>'}<p class="muted small">This takes about half a minute and is only needed once per track.</p></div>`;
  if (h.status === 'none' || !h.editions.length) return `<div class="panel">${head}<p class="muted">This is the first Formula 1 race at this circuit, so there is no history yet.</p></div>`;

  const eds = h.editions;
  const done = eds.filter((e) => e.stats_done && e.overtakes !== null);
  const maxOt = Math.max(1, ...done.map((e) => e.overtakes));
  const pod = (p, showGrid) => p ? `<b>${esc(surname(p.name))}</b>${showGrid && p.grid ? ` <span class="muted small">from P${p.grid}</span>` : ''}<div class="muted small">${esc(p.team || '')}</div>` : '<span class="muted">-</span>';
  const stat = (e, v) => (e.stats_done ? (v === null ? '<span class="muted">n/a</span>' : v) : '<span class="muted">…</span>');
  const rows = eds.map((e) => `<tr><td class="num"><b>${e.season}</b></td><td>${pod(e.podium[0], true)}</td><td>${pod(e.podium[1])}</td><td>${pod(e.podium[2])}</td>
    <td class="r">${stat(e, e.lead_changes)}${e.stats_done && e.leaders ? `<div class="muted small">${e.leaders} leader${e.leaders === 1 ? '' : 's'}</div>` : ''}</td>
    <td class="r">${stat(e, e.overtakes)}${e.stats_done && e.overtakes !== null ? `<div class="otbar"><i style="width:${Math.round((e.overtakes / maxOt) * 100)}%"></i></div>` : ''}</td></tr>`).join('');

  // a few quick facts
  const facts = [];
  const avg = (k) => Math.round(done.reduce((a, e) => a + e[k], 0) / done.length);
  if (done.length) facts.push(`About <b>${avg('overtakes')}</b> overtakes and <b>${avg('lead_changes')}</b> lead changes per race`);
  const winners = eds.map((e) => e.podium[0]).filter(Boolean);
  const fromPole = winners.filter((w) => w.grid === 1).length;
  if (winners.length) facts.push(`Won from pole <b>${fromPole} of ${winners.length}</b> times`);
  const wins = {};
  winners.forEach((w) => (wins[w.name] = (wins[w.name] || 0) + 1));
  const top = Object.entries(wins).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] > 1) facts.push(`<b>${esc(top[0])}</b> won here ${top[1]} times`);

  return `<div class="panel">${head}${noteHtml}
    ${facts.length ? `<div class="facts">${facts.map((f) => `<span>${f}</span>`).join('')}</div>` : ''}
    <div class="scroll"><table class="hist"><thead><tr><th>Year</th><th>Winner</th><th>2nd</th><th>3rd</th><th class="r">Lead changes</th><th class="r">Overtakes</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted small" style="margin-top:8px">Last ${eds.length} race${eds.length === 1 ? '' : 's'} at this circuit. Overtakes are estimated from lap-by-lap positions (leaving out pit stops, cars that slowed down sharply and the first lap), so they can differ from official counts. Lead changes include leads swapped during pit stops. Data: Jolpica F1.</p></div>`;
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

// ---------------------------------------------------------- driver picker
// Sort options; the choice is remembered in this browser. Championship orders put the leader first;
// drivers without a result in that championship (rookies, reserves) come last, in name order.
const PICK_SORTS = [
  ['team', 'Team (A-Z)'],
  ['driver', 'Driver (A-Z)'],
  ['team-last', "Last season's team championship"],
  ['driver-last', "Last season's driver championship"],
  ['driver-now', "This season's driver championship"],
];
const getPickSort = () => { try { return localStorage.getItem('pickSort') || 'team'; } catch { return 'team'; } };
const setPickSort = (v) => { try { localStorage.setItem('pickSort', v); } catch { /* private mode */ } };

// Team names differ between sources and seasons (Kick Sauber became Audi, "RB F1 Team" is Racing Bulls),
// so they are compared through a short key.
function teamKey(name) {
  const n = plain(name).replace(/[^a-z]/g, '');
  const rules = [['redbull', 'redbull'], ['bulls', 'rb'], ['alphatauri', 'rb'], ['visacash', 'rb'], ['sauber', 'audi'], ['audi', 'audi'], ['alfaromeo', 'audi'],
    ['haas', 'haas'], ['alpine', 'alpine'], ['aston', 'aston'], ['williams', 'williams'], ['mercedes', 'mercedes'], ['ferrari', 'ferrari'], ['mclaren', 'mclaren'], ['cadillac', 'cadillac']];
  if (n === 'rb' || n.startsWith('rbf')) return 'rb'; // "RB F1 Team"
  const hit = rules.find(([k]) => n.includes(k));
  return hit ? hit[1] : n;
}
const lastName = (name) => plain(String(name || '').split(' ').slice(-1)[0]);

async function loadStandings() {
  if (!state.standings) {
    try { state.standings = await api('/standings'); } catch { state.standings = { last: { drivers: [], teams: [] }, current: { drivers: [], teams: [] } }; }
  }
  return state.standings;
}

// -> [{ header, drivers: [{ d, note }] }]  (one group without a header for the driver orders)
function sortedDrivers(mode) {
  const list = [...(state.drivers || [])];
  const st = state.standings || { last: { drivers: [], teams: [] }, current: { drivers: [], teams: [] } };
  const byName = (a, b) => lastName(a.name).localeCompare(lastName(b.name)) || a.name.localeCompare(b.name);
  const rankIn = (rows) => { const m = new Map(rows.filter((r) => r.code).map((r) => [r.code, r])); return (d) => m.get(d.code) || null; };
  const pts = (r) => `P${r.position} · ${r.points} pt${r.points === 1 ? '' : 's'}`;

  if (mode === 'driver') return [{ drivers: list.sort(byName).map((d) => ({ d })) }];
  if (mode === 'driver-last' || mode === 'driver-now') {
    const table = mode === 'driver-last' ? st.last : st.current;
    const rank = rankIn(table.drivers);
    list.sort((a, b) => (rank(a)?.position || 999) - (rank(b)?.position || 999) || byName(a, b));
    return [{ drivers: list.map((d) => ({ d, note: rank(d) ? pts(rank(d)) : `not in the ${table.season} standings` })) }];
  }
  // team groups
  const teams = new Map();
  for (const d of list) {
    const k = teamKey(d.team);
    if (!teams.has(k)) teams.set(k, { name: d.team || 'No team', drivers: [] });
    teams.get(k).drivers.push(d);
  }
  let groups = [...teams.entries()].map(([k, g]) => ({ key: k, ...g }));
  if (mode === 'team-last') {
    const teamRank = new Map(st.last.teams.map((t) => [teamKey(t.name), t]));
    const drvRank = rankIn(st.last.drivers);
    groups.sort((a, b) => (teamRank.get(a.key)?.position || 99) - (teamRank.get(b.key)?.position || 99) || a.name.localeCompare(b.name));
    return groups.map((g) => {
      const t = teamRank.get(g.key);
      g.drivers.sort((a, b) => (drvRank(a)?.position || 999) - (drvRank(b)?.position || 999) || byName(a, b));
      return { header: g.name, sub: t ? `${pts(t)} in ${st.last.season}` : `new team / not ranked in ${st.last.season}`, drivers: g.drivers.map((d) => ({ d, note: drvRank(d) ? pts(drvRank(d)) : '' })) };
    });
  }
  groups.sort((a, b) => a.name.localeCompare(b.name));
  return groups.map((g) => ({ header: g.name, drivers: g.drivers.sort(byName).map((d) => ({ d })) }));
}

function pickerGrid(slot, mode) {
  const used = new Set([...SLOTS.map((k) => sel[k]), ...sel.dnfs].filter(Boolean));
  const current = slot.startsWith('dnf') ? sel.dnfs[Number(slot.slice(3))] : sel[slot];
  const card = ({ d, note }) => {
    const taken = used.has(d.driver_id) && d.driver_id !== current;
    return `<button class="slot pick" data-act="choose" data-slot="${slot}" data-id="${esc(d.driver_id)}" style="${taken ? 'opacity:.4' : ''}" title="${taken ? 'Already picked: choosing again moves them here' : ''}">
      ${avatar(d, 64)}<b>${esc(d.name)}</b><small>${esc(d.team || '')}${d.number ? ' · #' + esc(d.number) : ''}</small>${note ? `<small class="rank">${esc(note)}</small>` : ''}</button>`;
  };
  return sortedDrivers(mode).map((g) => `${g.header ? `<div class="pick-head"><b>${esc(g.header)}</b>${g.sub ? ` <span class="muted small">${esc(g.sub)}</span>` : ''}</div>` : ''}${g.drivers.map(card).join('')}`).join('');
}

function openPicker(slot) {
  const current = slot.startsWith('dnf') ? sel.dnfs[Number(slot.slice(3))] : sel[slot];
  const title = slot.startsWith('dnf') ? 'Pick a driver who will not finish' : `Who finishes ${slot.toUpperCase()}?`;
  const mode = getPickSort();
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `<div class="sheet"><div class="row between"><h2>${title}</h2><button data-act="close-modal">Close</button></div>
    <div class="row" style="margin-top:8px"><label for="pick-sort" style="margin:0">Sort by</label>
      <select id="pick-sort" style="width:auto;flex:1;max-width:340px">${PICK_SORTS.map(([v, l]) => `<option value="${v}" ${v === mode ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
    <div class="pick-grid" id="pick-grid" style="margin-top:12px">${pickerGrid(slot, mode)}</div>
    ${current ? `<p><button class="ghost danger" data-act="choose" data-slot="${slot}" data-id="">Clear this pick</button></p>` : ''}</div>`;
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  const redraw = async (m) => {
    const grid = modal.querySelector('#pick-grid');
    if (m !== 'team' && m !== 'driver' && !state.standings) {
      grid.innerHTML = '<p class="muted">Loading standings…</p>';
      await loadStandings();
    }
    grid.innerHTML = pickerGrid(slot, m);
  };
  modal.querySelector('#pick-sort').addEventListener('change', (e) => { setPickSort(e.target.value); redraw(e.target.value); });
  document.body.appendChild(modal);
  if (mode !== 'team' && mode !== 'driver' && !state.standings) redraw(mode);
}

function resultsPanel(results) {
  const list = results.top10.map((id, i) => { const d = driverById(id); return d ? `<div>${avatar(d, 36)}<span><b class="num">P${i + 1}</b> ${esc(d.name)}</span></div>` : ''; }).join('');
  const dnf = results.dnf.map((id) => { const d = driverById(id); return d ? esc(d.name) : ''; }).filter(Boolean).join(', ');
  return `<div class="panel"><h2>Official result (top 10)</h2><div class="result-list">${list}</div>
    <p class="muted small" style="margin-top:12px">Did not finish: ${dnf || 'nobody'}</p></div>`;
}

// Excuses for players who sent nothing; the same player gets the same excuse for the same race.
const DNS_EXCUSES = [
  'Dog ate the phone', 'Car engine failure on the way, did not make it in time', 'Was stuck in a 2-hour safety car queue at the supermarket',
  'Phone battery died at 1%', 'Forgot the password, again', 'Pit crew lost the phone', 'Was busy changing tyres on the family car',
  'Fell asleep during practice', 'Internet went red-flagged', 'Thought the race was next week', 'Grandma\'s birthday, no phones at the table',
  'Wi-Fi in the cottage: none', 'Gearbox failure (in the brain)', 'Stuck behind a tractor, could not overtake', 'Penalty: 5 seconds too late',
  'Was arguing with the TV about the last race', 'Brakes overheated after a long week', 'Left the phone in the other jacket',
  'Kids hid the phone', 'Team orders: had to let the others through', 'Went to the sauna and lost track of time', 'Strategy call: plan B, then no plan',
  'Too nervous to choose', 'Rain at the house, waited for intermediates', 'Washing machine flooded the paddock',
];
function dnsExcuse(userId, round) {
  const h = [...`${userId}:${round}`].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return DNS_EXCUSES[h % DNS_EXCUSES.length];
}

let boardCtx = null;
function predictionBoard(mine, others, missing, scored, round) {
  const players = [...(mine && ['ok', 'late_approved'].includes(mine.status) ? [{ ...mine, me: true }] : []), ...others]
    .map((p) => ({ ...p, user: { id: p.user_id, name: p.user_name, avatar: p.user_avatar } }));
  if (scored) players.sort((a, b) => (b.points || 0) - (a.points || 0));
  const dns = missing.map((u) => ({ user: u, excuse: dnsExcuse(u.id, round) }));
  boardCtx = { players, scored };
  if (!players.length && !dns.length) return '';

  const dnfRows = Math.max(0, ...players.map((p) => p.dnfs.length));
  const rows = [...SLOTS.map((k) => ({ key: k, label: k.toUpperCase() })), ...Array.from({ length: dnfRows }, (_, i) => ({ key: 'dnf', i, label: 'DNF' }))];
  const pickOf = (p, r) => (r.key === 'dnf' ? p.dnfs[r.i] : p[r.key]);
  const okOf = (p, r) => !!(p.detail && (r.key === 'dnf' ? p.detail.dnfs[r.i] : p.detail[r.key]));
  const chip = (id, ok) => {
    const d = driverById(id);
    if (!id) return '<span class="muted">-</span>';
    return `<span class="bpick ${ok ? 'ok' : ''}" title="${esc(d ? d.name : id)}">${avatar(d, 24)}<b>${esc(d ? d.code || d.name : '?')}</b></span>`;
  };
  // most popular pick in each row (only when at least two players agree)
  const popular = rows.map((r) => {
    const count = {};
    players.forEach((p) => { const id = pickOf(p, r); if (id) count[id] = (count[id] || 0) + 1; });
    const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
    return top && top[1] >= 2 ? top : null;
  });

  const head = players.map((p) => `<th class="bcol"><a class="plain bhead" href="/player/${p.user.id}" data-link>${userAvatar(p.user, 34)}<span>${esc(p.user.name)}${p.me ? ' (you)' : ''}</span>${scored ? `<span class="chip green">${p.points} pt${p.points === 1 ? '' : 's'}</span>` : ''}</a></th>`).join('')
    + dns.map((d) => `<th class="bcol dns"><a class="plain bhead" href="/player/${d.user.id}" data-link>${userAvatar(d.user, 34)}<span>${esc(d.user.name)}</span><span class="chip red">DNS</span></a></th>`).join('');
  const body = rows.map((r, ri) => `<tr><th class="bslot">${r.label}</th>${players.map((p) => `<td>${chip(pickOf(p, r), okOf(p, r))}</td>`).join('')}
      ${ri === 0 ? dns.map((d) => `<td class="dns-cell" rowspan="${rows.length}"><div><b>Did not start</b><span>${esc(d.excuse)}</span></div></td>`).join('') : ''}
      <td class="bpop">${popular[ri] ? `${chip(popular[ri][0], false)} <span class="muted small">×${popular[ri][1]}</span>` : ''}</td></tr>`).join('');

  const options = (sel) => players.map((p, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(p.user.name)}${p.me ? ' (you)' : ''}</option>`).join('');
  const rival = players.length >= 2 ? `<div class="panel"><h3>Head to head</h3>
      <div class="row"><select id="riv-a" style="width:auto;flex:1">${options(0)}</select><span class="muted">vs</span><select id="riv-b" style="width:auto;flex:1">${options(1)}</select></div>
      <div id="riv-out">${rivalry(0, 1)}</div></div>` : '';

  return `<h2>Prediction board</h2>
    <div class="panel flush"><div class="scroll"><table class="board"><thead><tr><th></th>${head}<th class="bpop">Most picked</th></tr></thead><tbody>${body}</tbody></table></div></div>
    ${scored ? '<p class="muted small">Green = right pick.</p>' : ''}${rival}`;
}

function rivalry(ai, bi) {
  const { players, scored } = boardCtx;
  const A = players[ai], B = players[bi];
  if (!A || !B || A === B) return '<p class="muted small">Choose two different players.</p>';
  const name = (id) => { const d = driverById(id); return d ? d.code || d.name : '-'; };
  const rows = [...SLOTS.map((k) => [k.toUpperCase(), A[k], B[k], A.detail?.[k], B.detail?.[k]]),
    ...Array.from({ length: Math.max(A.dnfs.length, B.dnfs.length) }, (_, i) => ['DNF', A.dnfs[i], B.dnfs[i], A.detail?.dnfs[i], B.detail?.dnfs[i]])];
  // a DNF pick counts as shared when the other player also has that driver among their DNFs
  const same = (r) => (r[0] === 'DNF' ? r[1] && B.dnfs.includes(r[1]) : r[1] && r[1] === r[2]);
  const agree = rows.filter(same).length;
  const cell = (id, ok) => `<span class="${ok ? 'up' : ''}">${esc(name(id))}${ok ? ' ✓' : ''}</span>`;
  return `<div class="facts" style="margin-top:12px"><span>Agreed on <b>${agree}</b> of ${rows.length} picks</span>
      ${scored ? `<span><b>${esc(A.user.name)}</b> ${A.points} : ${B.points} <b>${esc(B.user.name)}</b></span>` : ''}</div>
    <table class="riv"><tbody>${rows.map((r) => `<tr class="${same(r) ? 'same-pick' : 'diff-pick'}"><td class="r">${cell(r[1], r[3])}</td><th>${r[0]}</th><td>${cell(r[2], r[4])}</td></tr>`).join('')}</tbody></table>`;
}
document.addEventListener('change', (e) => {
  if (e.target.id === 'riv-a' || e.target.id === 'riv-b') {
    const out = document.getElementById('riv-out');
    if (out) out.innerHTML = rivalry(Number(document.getElementById('riv-a').value), Number(document.getElementById('riv-b').value));
  }
});

// ------------------------------------------------------------------- WPC
// World Prediction Champion: our championship over the seasons (/wpc) and player profiles (/player/...).
const MEDAL = { 1: 'gold', 2: 'silver', 3: 'bronze' };
function cupSvg(kind, size = 22) {
  const c = { gold: ['#f5c542', '#b8860b'], silver: ['#d9dde3', '#8a919c'], bronze: ['#d38b4f', '#8c5428'] }[kind];
  return `<svg class="cup" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 3h10v5a5 5 0 0 1-10 0z" fill="${c[0]}"/><path d="M7 4H4v2a4 4 0 0 0 4 4M17 4h3v2a4 4 0 0 1-4 4" fill="none" stroke="${c[1]}" stroke-width="1.6"/>
    <path d="M11 13h2v4h-2z" fill="${c[1]}"/><path d="M8 19h8v2H8z" fill="${c[0]}"/><path d="M9 17h6v2H9z" fill="${c[1]}"/>
    <path d="M9 4.5h1.5v4.5H9z" fill="#fff" opacity=".35"/></svg>`;
}
const placeLabel = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
const playerHref = (r) => (r.user ? `/player/${r.user.id}` : `/player/h/${encodeURIComponent(r.name)}`);
function playerName(r, size = 28) {
  return `<a class="who-row plain" href="${playerHref(r)}" data-link>${userAvatar(r.user || { name: r.name }, size)}<span>${esc(r.name)}</span></a>`;
}

async function wpcView(year) {
  const { seasons, alltime } = await api('/wpc');
  const pick = seasons.find((s) => s.season === year) || seasons[seasons.length - 1];
  const finished = seasons.filter((s) => !s.live).reverse();
  const hall = finished.map((s) => `<div class="hof">
      <div class="hof-year">WPC ${s.season}</div>
      ${s.rows.filter((r) => r.position <= 3).map((r) => `<div class="hof-row p${r.position}">${cupSvg(MEDAL[r.position], r.position === 1 ? 26 : 20)}${playerName(r, r.position === 1 ? 30 : 24)}<span class="num muted small">${r.total} pts</span></div>`).join('')}
      ${s.complete ? '' : `<div class="muted small">after ${esc(s.races[s.races.length - 1])}</div>`}</div>`).join('');
  const titlesCell = (p) => p.finishes.filter((f) => !f.live && f.position <= 3).sort((a, b) => a.position - b.position || a.season - b.season)
    .map((f) => `<span title="${placeLabel(f.position)} in ${f.season}">${cupSvg(MEDAL[f.position], 18)}</span>`).join('') || '<span class="muted">-</span>';
  const allTable = `<div class="panel flush"><div class="scroll"><table><thead><tr><th>Player</th><th>Trophies</th><th class="r">Titles</th><th class="r">Podiums</th><th class="r">Best</th><th class="r">Seasons</th><th class="r">Points</th></tr></thead><tbody>
    ${alltime.map((p) => `<tr><td>${playerName(p)}</td><td class="cups">${titlesCell(p)}</td><td class="r num"><b>${p.titles}</b></td><td class="r num">${p.podiums}</td><td class="r num">${p.best ? placeLabel(p.best) : '-'}</td><td class="r num">${p.seasons}</td><td class="r num">${p.points}</td></tr>`).join('')}
    </tbody></table></div></div>`;
  const color = (i) => COLORS[i % COLORS.length];
  const board = pick.rows.map((r) => {
    const per_race = r.totals.map((t, i) => ({ total: t ?? 0, pts: (t ?? 0) - (i ? r.totals[i - 1] ?? 0 : 0) }));
    return { ...r, per_race, form: pick.live ? formOf(per_race) : null };
  });
  const races = pick.races.map((n, i) => ({ round: i + 1, name: n }));
  const standings = `<div class="panel flush"><div class="scroll"><table><thead><tr><th>#</th><th>Player</th><th class="r">Points</th></tr></thead><tbody>
    ${pick.rows.map((r, i) => `<tr class="${r.position === 1 ? 'lead' : ''}"><td class="num">${!pick.live && MEDAL[r.position] ? cupSvg(MEDAL[r.position], 18) : r.position}</td>
      <td><span class="who-row"><span class="dot" style="background:${color(i)}"></span><a class="who-row plain" href="${playerHref(r)}" data-link>${formAvatar(r.user || { name: r.name }, 28, board[i].form)}<span>${esc(r.name)}</span></a></span></td><td class="r num"><b>${r.total}</b></td></tr>`).join('')}
    </tbody></table></div></div>`;
  app.innerHTML = shell(`
    <div class="row between"><h1>${cupSvg('gold', 30)} World Prediction Champion</h1><a class="small muted" href="/" data-link>← Home</a></div>
    <p class="muted">Our own championship: everybody's prediction points over a whole Formula 1 season.</p>
    <h2>Hall of fame</h2><div class="hof-grid">${hall}</div>
    <h2 style="margin-top:20px">All-time</h2>${allTable}
    <h2 style="margin-top:20px">Seasons</h2>
    <nav class="tabs">${seasons.map((s) => `<a href="/wpc/${s.season}" data-link class="${s === pick ? 'on' : ''}">${s.season}${s.live ? ' (now)' : ''}</a>`).join('')}</nav>
    ${pick.live ? `<p class="muted small">This season comes from the app league. It counts the races scored in the app so far.</p>` : ''}
    ${standings}${races.length ? trendChart(races, board, color) : ''}`);
}

async function playerView(apiPath) {
  const data = await api(apiPath);
  const pl = data.player;
  const team = pl.favorite_team && teamBySlug(pl.favorite_team);
  const trophies = data.history.filter((h) => !h.live && h.position <= 3);
  const shelf = trophies.length
    ? `<div class="shelf">${trophies.sort((a, b) => a.position - b.position || b.season - a.season).map((h) => `<div class="trophy ${MEDAL[h.position]}">${cupSvg(MEDAL[h.position], 34)}<b>WPC ${h.season}</b><span class="small">${h.position === 1 ? 'Champion' : placeLabel(h.position) + ' place'}</span></div>`).join('')}</div>`
    : '<p class="muted small">No WPC podium yet.</p>';

  // highlights from every season's numbers
  const hl = [];
  for (const h of data.history) {
    const st = h.stats, y = h.season + (h.live ? ' (so far)' : '');
    if (st.best.pts >= 4) hl.push(`🎯 <b>${st.best.pts} right picks</b> in one race (${esc(st.best.races.join(', '))} ${y})`);
    if (st.hot.length >= 2) hl.push(`🔥 <b>${st.hot.length} races in a row</b> with 3+ right picks (${esc(st.hot.from)} to ${esc(st.hot.to)} ${y})`);
    if (st.scoring.length >= 8) hl.push(`📈 Scored in <b>${st.scoring.length} races in a row</b> (${esc(st.scoring.from)} to ${esc(st.scoring.to)} ${y})`);
    if (st.led >= 3) hl.push(`👑 Led the WPC after <b>${st.led} races</b> in ${y}`);
    if (st.drought.length >= 4) hl.push(`🧊 ${st.drought.length} races in a row without a point (${esc(st.drought.from)} to ${esc(st.drought.to)} ${y})`);
  }

  const seasonRows = data.history.slice().reverse().map((h) => `<tr><td class="num"><b>${h.season}</b>${h.live ? ' <span class="chip">now</span>' : ''}</td>
    <td>${!h.live && MEDAL[h.position] ? cupSvg(MEDAL[h.position], 18) + ' ' : ''}${placeLabel(h.position)} <span class="muted small">of ${h.players}</span></td>
    <td class="r num"><b>${h.total}</b></td><td class="r num">${h.stats.avg}</td><td class="r num">${h.stats.best.pts}</td><td class="r num">${h.stats.led}</td>
    <td>${sparkline(h.stats.per)}</td></tr>`).join('');

  let current = '';
  const c = data.current;
  if (c && c.races) {
    const bar = (label, n, of) => `<div class="acc"><span>${label}</span><div class="otbar wide"><i style="width:${of ? Math.round((n / of) * 100) : 0}%"></i></div><span class="num small">${n}/${of}</span></div>`;
    current = `<div class="panel"><h2>${c.season} in the app</h2>
      <div class="facts"><span><b>${c.points}</b> points</span><span><b>${c.races}</b> race${c.races === 1 ? '' : 's'} predicted</span><span><b>${c.avg}</b> per race</span>${c.best ? `<span>Best: <b>${c.best.pts}</b> at ${esc(c.best.race.replace(' Grand Prix', ''))}</span>` : ''}</div>
      <h3 class="avhead">Right picks</h3>
      ${['p1', 'p2', 'p3', 'p4', 'p5', 'p10'].map((k) => bar(k.toUpperCase(), c.hits[k], c.races)).join('')}
      ${bar('DNF', c.hits.dnf, c.hits.dnfPicked)}</div>`;
  }

  app.innerHTML = shell(`<a class="small muted" href="/wpc" data-link>← WPC</a>
    <div class="profile-head">${userAvatar(pl.id ? pl : { name: pl.name }, 84)}<div>
      <h1>${esc(pl.name)}</h1>
      ${data.wpc_name && data.wpc_name !== pl.name ? `<div class="muted small">In the WPC tables as ${esc(data.wpc_name)}</div>` : ''}
      ${team ? `<div class="muted small">Supports ${esc(team.name)}</div>` : ''}
      ${!pl.id ? '<div class="muted small">No account in the app yet</div>' : ''}
      ${data.titles ? `<div class="facts" style="margin-top:8px"><span><b>${data.titles.titles}</b> title${data.titles.titles === 1 ? '' : 's'}</span><span><b>${data.titles.podiums}</b> podium${data.titles.podiums === 1 ? '' : 's'}</span><span><b>${data.titles.seasons}</b> season${data.titles.seasons === 1 ? '' : 's'}</span></div>` : ''}
    </div></div>
    <div class="panel"><h2>Trophies</h2>${shelf}</div>
    ${hl.length ? `<div class="panel"><h2>Highlights</h2><ul class="hl">${hl.map((x) => `<li>${x}</li>`).join('')}</ul></div>` : ''}
    ${data.history.length ? `<div class="panel flush"><div class="scroll"><table><thead><tr><th>Season</th><th>Finish</th><th class="r">Points</th><th class="r">Per race</th><th class="r">Best race</th><th class="r">Races led</th><th>Points per race</th></tr></thead><tbody>${seasonRows}</tbody></table></div></div>` : ''}
    ${current}`);
}

// Tiny bar chart of the points in each race of a season.
function sparkline(per) {
  const max = Math.max(1, ...per);
  const w = 3, gap = 1, h = 22;
  return `<svg class="spark" width="${per.length * (w + gap)}" height="${h}" viewBox="0 0 ${per.length * (w + gap)} ${h}" aria-hidden="true">${per.map((p, i) => `<rect x="${i * (w + gap)}" y="${h - Math.max(1, (p / max) * h)}" width="${w}" height="${Math.max(1, (p / max) * h)}" rx="1" fill="${p ? 'var(--red)' : '#3a3f4b'}"/>`).join('')}</svg>`;
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
  async 'set-avatar'(el) {
    try {
      const r = await api('/account/avatar', { method: 'POST', body: { avatar: el.dataset.avatar } });
      state.me.avatar = r.avatar;
      toast(r.avatar ? 'Picture saved' : 'Picture removed');
      accountView();
    } catch (e) { fail(e); }
  },
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
};
document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form]');
  if (f) { e.preventDefault(); forms[f.dataset.form](f); }
});

render();
