import { ensureSchema } from './schema.js';
import {
  HttpError, json, readBody, hashPassword, safeEqual, randomToken, randomCode, sha256Hex, parseCookies,
} from './util.js';
import { TEAM_SLUGS, teamsForClient } from './f1teams.js';
import { saveAvatar, avatarResponse } from './avatars.js';
import { syncAll, applyF1Photos, applyF1Tracks } from './sync.js';
import { Budget, getRaceInsights, saveHistoryPodiums, saveEditionStats } from './insights.js';
import { syncStandings, getStandings } from './standings.js';
import { getPractice } from './practice.js';
import { WPC_LEAGUE_ID, PLAYERS, wpcSeasons, allTime, seasonStats } from './wpc.js';
import { MAX_DNF_PICKS, buildResultLookup, scorePrediction } from './scoring.js';

let assetsApplied = false;
let standingsTried = 0;
const SESSION_DAYS = 30;
const PICK_KEYS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p10'];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      await ensureSchema(env);
      // Once per worker start: make sure stored drivers and races use their formula1.com images.
      // (each request runs it until one has finished: see ensureSchema for why a promise is not shared)
      if (!assetsApplied) {
        try { await Promise.all([applyF1Photos(env), applyF1Tracks(env)]); assetsApplied = true; } catch (e) { console.error(e); }
      }
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env, ctx, url);
      return env.ASSETS.fetch(request);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Something went wrong on the server.' }, 500);
    }
  },

  // Runs on the cron schedule from wrangler.jsonc.
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      await ensureSchema(env);
      const out = await syncAll(env);
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO sync_log (at, result) VALUES (?, ?)`).bind(Date.now(), JSON.stringify(out)),
        env.DB.prepare(`DELETE FROM sync_log WHERE id NOT IN (SELECT id FROM sync_log ORDER BY id DESC LIMIT 20)`),
      ]).catch((e) => console.error('sync_log', e));
    })());
  },
};

// ---------------------------------------------------------------- helpers

const now = () => Date.now();
const one = async (stmt) => (await stmt.first()) || null;

async function currentUser(request, env) {
  const sid = parseCookies(request.headers.get('cookie')).sid;
  if (!sid) return null;
  return one(
    env.DB.prepare(
      `SELECT u.id, u.name, u.username, u.must_change, u.favorite_team, u.avatar FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`
    ).bind(await sha256Hex(sid), now())
  );
}

async function requireUser(request, env) {
  const user = await currentUser(request, env);
  if (!user) throw new HttpError(401, 'Please log in.');
  return user;
}

async function requireMember(env, leagueId, userId) {
  const m = await one(env.DB.prepare(`SELECT role FROM members WHERE league_id=? AND user_id=?`).bind(leagueId, userId));
  if (!m) throw new HttpError(403, 'You are not a member of this league.');
  return m;
}

async function requireAdmin(env, leagueId, userId) {
  const m = await requireMember(env, leagueId, userId);
  if (m.role !== 'admin') throw new HttpError(403, 'Only league admins can do this.');
  return m;
}

async function notify(env, userId, text, link = '/') {
  await env.DB.prepare(`INSERT INTO notifications (user_id, text, link, created_at) VALUES (?, ?, ?, ?)`)
    .bind(userId, text, link, now())
    .run();
}

async function startSession(env, request, userId) {
  const token = randomToken();
  const expires = now() + SESSION_DAYS * 86400000;
  await env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ?`).bind(now()).run();
  await env.DB.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`)
    .bind(await sha256Hex(token), userId, expires)
    .run();
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

function cleanName(v, max = 40) {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (!s) throw new HttpError(400, 'Name is required.');
  return s.slice(0, max);
}

// Usernames: 3-24 letters (any alphabet), digits, spaces, dots, dashes or underscores.
// They are unique regardless of upper/lower case and also shown to league members.
function cleanUsername(v) {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (!/^[\p{L}\p{N} ._-]{3,24}$/u.test(s)) throw new HttpError(400, 'Username must be 3-24 characters: letters, numbers, spaces, dots, dashes or underscores.');
  return s;
}

async function leagueAdmins(env, leagueId) {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.name FROM members m JOIN users u ON u.id = m.user_id WHERE m.league_id=? AND m.role='admin'`
  ).bind(leagueId).all();
  return results;
}

async function ensureCalendar(env) {
  const c = await one(env.DB.prepare(`SELECT COUNT(*) AS n FROM races`));
  if (!c || c.n === 0) await syncAll(env, { extras: false }); // first visit: fill the database right away
}

// ------------------------------------------------------------------ router

async function handleApi(request, env, ctx, url) {
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;
  let m;

  // ---- maintenance: open /api/admin/sync?key=YOUR_ADMIN_KEY in a browser to force a refresh
  if (path === '/api/admin/sync') {
    if (!env.ADMIN_KEY || !safeEqual(url.searchParams.get('key') || '', env.ADMIN_KEY)) throw new HttpError(403, 'Forbidden');
    return json(await syncAll(env));
  }

  // ---- auth
  if (method === 'POST' && path === '/api/register') {
    const b = await readBody(request);
    const name = cleanUsername(b.username);
    const username = name.toLowerCase();
    const password = String(b.password || '');
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
    const team = TEAM_SLUGS.has(String(b.team || '')) ? String(b.team) : null;
    if (await one(env.DB.prepare(`SELECT id FROM users WHERE username=?`).bind(username)))
      throw new HttpError(409, 'This username is already taken.');
    const { hash, salt } = await hashPassword(password, undefined, env.PBKDF2_ITERATIONS);
    // The email column is required by the original table; accounts without email get a unique placeholder.
    const r = await env.DB.prepare(`INSERT INTO users (email, name, username, pass_hash, salt, created_at, favorite_team) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(`user:${username}`, name, username, hash, salt, now(), team).run();
    const id = r.meta.last_row_id;
    return json({ user: { id, name, username, favorite_team: team, avatar: null } }, 200, { 'set-cookie': await startSession(env, request, id) });
  }

  if (method === 'POST' && path === '/api/login') {
    const b = await readBody(request);
    const login = String(b.username || '').trim().toLowerCase();
    // older accounts can still log in with the email address they registered with
    const u = await one(env.DB.prepare(`SELECT * FROM users WHERE username=? OR (email=? AND email LIKE '%@%')`).bind(login, login));
    const attempt = await hashPassword(String(b.password || ''), u?.salt, env.PBKDF2_ITERATIONS);
    if (!u || !safeEqual(attempt.hash, u.pass_hash)) throw new HttpError(401, 'Wrong username or password.');
    return json({ user: { id: u.id, name: u.name, username: u.username, must_change: u.must_change, favorite_team: u.favorite_team || null, avatar: u.avatar || null } }, 200, {
      'set-cookie': await startSession(env, request, u.id),
    });
  }

  if (method === 'POST' && path === '/api/logout') {
    const sid = parseCookies(request.headers.get('cookie')).sid;
    if (sid) await env.DB.prepare(`DELETE FROM sessions WHERE token_hash=?`).bind(await sha256Hex(sid)).run();
    return json({ ok: true }, 200, { 'set-cookie': 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });
  }

  if (method === 'GET' && path === '/api/teams') return json({ teams: teamsForClient() });

  if (method === 'GET' && path === '/api/me') {
    const user = await currentUser(request, env);
    return json({ user, app_name: env.APP_NAME || 'F1 Predictions' });
  }

  // ---- invite preview (works before login)
  if ((m = path.match(/^\/api\/join\/([a-z0-9]+)$/)) && method === 'GET') {
    const l = await one(env.DB.prepare(
      `SELECT l.name, (SELECT COUNT(*) FROM members WHERE league_id=l.id) AS members FROM leagues l WHERE invite_code=?`
    ).bind(m[1]));
    if (!l) throw new HttpError(404, 'This invite link is not valid (anymore).');
    return json(l);
  }

  // Everything below needs a logged-in user.
  const user = await requireUser(request, env);

  if ((m = path.match(/^\/api\/join\/([a-z0-9]+)$/)) && method === 'POST') {
    const l = await one(env.DB.prepare(`SELECT id, name FROM leagues WHERE invite_code=?`).bind(m[1]));
    if (!l) throw new HttpError(404, 'This invite link is not valid (anymore).');
    const res = await env.DB.prepare(`INSERT OR IGNORE INTO members (league_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`)
      .bind(l.id, user.id, now()).run();
    if (res.meta.changes) {
      for (const a of await leagueAdmins(env, l.id)) await notify(env, a.id, `${user.name} joined "${l.name}".`, `/league/${l.id}`);
    }
    return json({ league_id: l.id });
  }

  // ---- notifications
  if (method === 'GET' && path === '/api/notifications') {
    const { results } = await env.DB.prepare(
      `SELECT id, text, link, read, created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 30`
    ).bind(user.id).all();
    return json({ notifications: results, unread: results.filter((n) => !n.read).length });
  }
  if (method === 'POST' && path === '/api/notifications/read') {
    await env.DB.prepare(`UPDATE notifications SET read=1 WHERE user_id=?`).bind(user.id).run();
    return json({ ok: true });
  }

  // ---- calendar and drivers
  if (method === 'GET' && path === '/api/races') {
    await ensureCalendar(env);
    const { results } = await env.DB.prepare(
      `SELECT r.round, r.name, r.circuit_id, r.circuit_name, r.locality, r.country, r.race_ts, r.circuit_image,
         EXISTS (SELECT 1 FROM results x WHERE x.round = r.round) AS has_results
       FROM races r ORDER BY r.round`
    ).all();
    return json({ races: results.map((r) => ({ ...r, has_results: !!r.has_results, circuit_image: r.circuit_image === '-' ? null : r.circuit_image })), server_time: now() });
  }

  // qualifying classification + history of the race at this circuit (filled by the cron job)
  if ((m = path.match(/^\/api\/races\/(\d+)\/insights$/)) && method === 'GET') {
    const data = await getRaceInsights(env, Number(m[1]));
    if (!data) throw new HttpError(404, 'Race not found.');
    return json(data);
  }

  // best practice lap per driver in FP1-FP3 (Analytics tab of the race page)
  if ((m = path.match(/^\/api\/races\/(\d+)\/practice$/)) && method === 'GET') {
    const data = await getPractice(env, Number(m[1]));
    if (!data) throw new HttpError(404, 'Race not found.');
    return json(data);
  }

  // everything about this season the driver analysis page needs, in one answer
  if (method === 'GET' && path === '/api/season') return json(await seasonData(env));

  // OpenF1 (lap by lap times and car telemetry) passed through and cached for 5 minutes, used by the
  // driver analysis page when the browser cannot reach api.openf1.org itself.
  if ((m = path.match(/^\/api\/openf1\/(sessions|laps|car_data|stints|drivers|meetings|location|weather)$/)) && method === 'GET') {
    return openF1(env, ctx, m[1], url.search);
  }

  // track history collected by the browser (see collectHistory in public/app.js)
  if ((m = path.match(/^\/api\/races\/(\d+)\/history$/)) && method === 'POST') {
    const b = await readBody(request);
    if (!(await saveHistoryPodiums(env, Number(m[1]), b.editions))) throw new HttpError(400, 'Invalid history.');
    return json({ ok: true });
  }
  if ((m = path.match(/^\/api\/races\/(\d+)\/history\/(\d{4})$/)) && method === 'POST') {
    if (!(await saveEditionStats(env, Number(m[1]), Number(m[2]), await readBody(request)))) throw new HttpError(400, 'Invalid history.');
    return json({ ok: true });
  }

  // championship standings for sorting the driver picker (filled right away on first use)
  if (method === 'GET' && path === '/api/standings') {
    let data = await getStandings(env);
    if ((!data.last.drivers.length || !data.current.drivers.length) && now() - standingsTried > 5 * 60000) {
      standingsTried = now();
      await syncStandings(env, new Budget(4));
      data = await getStandings(env);
    }
    return json(data);
  }

  if (method === 'GET' && path === '/api/drivers') {
    await ensureCalendar(env);
    return json({ drivers: await listDrivers(env) });
  }

  // ---- leagues
  if (method === 'GET' && path === '/api/leagues') {
    const { results } = await env.DB.prepare(
      `SELECT l.id, l.name, m.role, (SELECT COUNT(*) FROM members WHERE league_id=l.id) AS member_count
       FROM members m JOIN leagues l ON l.id = m.league_id WHERE m.user_id=? ORDER BY l.name`
    ).bind(user.id).all();
    return json({ leagues: results });
  }

  if (method === 'POST' && path === '/api/leagues') {
    const b = await readBody(request);
    const name = cleanName(b.name, 50);
    const r = await env.DB.prepare(`INSERT INTO leagues (name, invite_code, owner_id, created_at) VALUES (?, ?, ?, ?)`)
      .bind(name, randomCode(10), user.id, now()).run();
    const id = r.meta.last_row_id;
    await env.DB.prepare(`INSERT INTO members (league_id, user_id, role, joined_at) VALUES (?, ?, 'admin', ?)`).bind(id, user.id, now()).run();
    return json({ id });
  }

  if ((m = path.match(/^\/api\/leagues\/(\d+)$/))) {
    const lid = Number(m[1]);
    const me = await requireMember(env, lid, user.id);
    if (method === 'GET') {
      const league = await one(env.DB.prepare(`SELECT id, name, invite_code, owner_id FROM leagues WHERE id=?`).bind(lid));
      const { results: members } = await env.DB.prepare(
        `SELECT u.id, u.name, u.avatar, m.role, m.joined_at FROM members m JOIN users u ON u.id = m.user_id WHERE m.league_id=? ORDER BY m.joined_at`
      ).bind(lid).all();
      const isAdmin = me.role === 'admin';
      const pending = isAdmin
        ? (await one(env.DB.prepare(`SELECT COUNT(*) AS n FROM predictions WHERE league_id=? AND status='late_pending'`).bind(lid))).n
        : 0;
      return json({
        league: { id: league.id, name: league.name, owner_id: league.owner_id, invite_code: isAdmin ? league.invite_code : undefined },
        members, role: me.role, pending, wpc: lid === WPC_LEAGUE_ID,
      });
    }
    if (method === 'DELETE') {
      const league = await one(env.DB.prepare(`SELECT owner_id FROM leagues WHERE id=?`).bind(lid));
      if (league.owner_id !== user.id) throw new HttpError(403, 'Only the league owner can delete it.');
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM predictions WHERE league_id=?`).bind(lid),
        env.DB.prepare(`DELETE FROM members WHERE league_id=?`).bind(lid),
        env.DB.prepare(`DELETE FROM leagues WHERE id=?`).bind(lid),
      ]);
      return json({ ok: true });
    }
  }

  if ((m = path.match(/^\/api\/leagues\/(\d+)\/regenerate-invite$/)) && method === 'POST') {
    const lid = Number(m[1]);
    await requireAdmin(env, lid, user.id);
    const code = randomCode(10);
    await env.DB.prepare(`UPDATE leagues SET invite_code=? WHERE id=?`).bind(code, lid).run();
    return json({ invite_code: code });
  }

  // ---- members: the league creator (owner) is always an admin and is the only one who
  // can grant or take away admin rights or remove admins.
  if ((m = path.match(/^\/api\/leagues\/(\d+)\/members\/(\d+)$/))) {
    const lid = Number(m[1]);
    const target = Number(m[2]);
    const me = await requireMember(env, lid, user.id);
    const league = await one(env.DB.prepare(`SELECT owner_id FROM leagues WHERE id=?`).bind(lid));
    const isOwner = league.owner_id === user.id;
    const targetRow = await one(env.DB.prepare(`SELECT role FROM members WHERE league_id=? AND user_id=?`).bind(lid, target));
    if (!targetRow) throw new HttpError(404, 'That person is not in this league.');

    if (method === 'POST') { // change role: { role: 'admin' | 'member' }
      if (!isOwner) throw new HttpError(403, 'Only the league creator can change admin rights.');
      const b = await readBody(request);
      if (!['admin', 'member'].includes(b.role)) throw new HttpError(400, 'Invalid role.');
      if (target === league.owner_id) throw new HttpError(400, 'The league creator is always an admin.');
      await env.DB.prepare(`UPDATE members SET role=? WHERE league_id=? AND user_id=?`).bind(b.role, lid, target).run();
      if (b.role === 'admin') await notify(env, target, `You are now an admin of this league.`, `/league/${lid}/approvals`);
      return json({ ok: true });
    }
    if (method === 'DELETE') { // remove a member, or leave the league yourself
      if (target === league.owner_id) throw new HttpError(400, 'The league creator cannot leave or be removed. Delete the league instead.');
      if (target !== user.id) {
        if (me.role !== 'admin') throw new HttpError(403, 'Only league admins can remove members.');
        if (targetRow.role === 'admin' && !isOwner) throw new HttpError(403, 'Only the league creator can remove an admin.');
      }
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM predictions WHERE league_id=? AND user_id=?`).bind(lid, target),
        env.DB.prepare(`DELETE FROM members WHERE league_id=? AND user_id=?`).bind(lid, target),
      ]);
      return json({ ok: true });
    }
  }

  // An admin hands a member who forgot their password a random temporary one (no email needed).
  // Admins can reset regular members; only the creator can reset another admin. The creator's own
  // password cannot be reset by anyone else.
  if ((m = path.match(/^\/api\/leagues\/(\d+)\/members\/(\d+)\/reset-password$/)) && method === 'POST') {
    const lid = Number(m[1]);
    const target = Number(m[2]);
    await requireAdmin(env, lid, user.id);
    const league = await one(env.DB.prepare(`SELECT owner_id FROM leagues WHERE id=?`).bind(lid));
    if (target === user.id) throw new HttpError(400, 'Use the Password page to change your own password.');
    const t = await one(env.DB.prepare(`SELECT role FROM members WHERE league_id=? AND user_id=?`).bind(lid, target));
    if (!t) throw new HttpError(404, 'That person is not in this league.');
    if (target === league.owner_id) throw new HttpError(403, "The league creator's password cannot be reset by others.");
    if (t.role === 'admin' && league.owner_id !== user.id) throw new HttpError(403, 'Only the league creator can reset an admin password.');
    const temp = randomCode(12);
    const { hash, salt } = await hashPassword(temp, undefined, env.PBKDF2_ITERATIONS);
    await env.DB.batch([
      env.DB.prepare(`UPDATE users SET pass_hash=?, salt=?, must_change=1 WHERE id=?`).bind(hash, salt, target),
      env.DB.prepare(`DELETE FROM sessions WHERE user_id=?`).bind(target),
    ]);
    await notify(env, target, `Your password was reset by ${user.name}.`, '/');
    return json({ temp_password: temp });
  }

  // ---- WPC (World Prediction Champion): all seasons, the all-time table and player profiles
  if (method === 'GET' && path === '/api/wpc') {
    const seasons = await wpcSeasons(env, getScoreboard);
    return json({ seasons, alltime: allTime(seasons), league_id: WPC_LEAGUE_ID });
  }
  if ((m = path.match(/^\/api\/players\/(\d+)$/)) && method === 'GET') return json(await playerProfile(env, { id: Number(m[1]) }));
  if ((m = path.match(/^\/api\/players\/h\/(.+)$/)) && method === 'GET') return json(await playerProfile(env, { name: decodeURIComponent(m[1]) }));

  // ---- profile picture: a preset ({ avatar: 'helmet:<team>' | 'team:<team>' | 'driver:<driver id>' | '' })
  // or an uploaded picture ({ image: 'data:image/jpeg;base64,...' }, made small in the browser)
  if (method === 'POST' && path === '/api/account/avatar') {
    return json({ ok: true, avatar: await saveAvatar(env, user.id, await readBody(request)) });
  }
  if ((m = path.match(/^\/api\/avatars\/(\d+)$/)) && method === 'GET') return avatarResponse(env, Number(m[1]));

  // ---- favorite team ('' clears it)
  if (method === 'POST' && path === '/api/account/team') {
    const b = await readBody(request);
    const team = String(b.team || '');
    if (team && !TEAM_SLUGS.has(team)) throw new HttpError(400, 'Unknown team.');
    await env.DB.prepare(`UPDATE users SET favorite_team=? WHERE id=?`).bind(team || null, user.id).run();
    return json({ ok: true, favorite_team: team || null });
  }

  // ---- change own password (also used after a reset, when the current one is not needed)
  if (method === 'POST' && path === '/api/account/password') {
    const b = await readBody(request);
    const full = await one(env.DB.prepare(`SELECT * FROM users WHERE id=?`).bind(user.id));
    if (!full.must_change) {
      const check = await hashPassword(String(b.current || ''), full.salt, env.PBKDF2_ITERATIONS);
      if (!safeEqual(check.hash, full.pass_hash)) throw new HttpError(401, 'Your current password is not correct.');
    }
    const next = String(b.new || '');
    if (next.length < 8) throw new HttpError(400, 'New password must be at least 8 characters.');
    const { hash, salt } = await hashPassword(next, undefined, env.PBKDF2_ITERATIONS);
    const keep = await sha256Hex(parseCookies(request.headers.get('cookie')).sid || '');
    await env.DB.batch([
      env.DB.prepare(`UPDATE users SET pass_hash=?, salt=?, must_change=0 WHERE id=?`).bind(hash, salt, user.id),
      env.DB.prepare(`DELETE FROM sessions WHERE user_id=? AND token_hash<>?`).bind(user.id, keep),
    ]);
    return json({ ok: true });
  }

  // ---- predictions
  if ((m = path.match(/^\/api\/leagues\/(\d+)\/predictions\/(\d+)$/))) {
    const lid = Number(m[1]);
    const round = Number(m[2]);
    await requireMember(env, lid, user.id);
    if (method === 'GET') return json(await getRacePredictions(env, lid, round, user));
    if (method === 'PUT') return json(await savePrediction(env, ctx, url, lid, round, user, await readBody(request)));
  }

  if ((m = path.match(/^\/api\/leagues\/(\d+)\/my-predictions$/)) && method === 'GET') {
    const lid = Number(m[1]);
    await requireMember(env, lid, user.id);
    const { results } = await env.DB.prepare(`SELECT round, status FROM predictions WHERE league_id=? AND user_id=?`).bind(lid, user.id).all();
    return json({ predictions: results });
  }

  if ((m = path.match(/^\/api\/leagues\/(\d+)\/pending$/)) && method === 'GET') {
    const lid = Number(m[1]);
    await requireAdmin(env, lid, user.id);
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.user_id, p.round, p.p1, p.p2, p.p3, p.p4, p.p5, p.p10, p.dnfs, p.submitted_at, u.name AS user_name, u.avatar AS user_avatar, r.name AS race_name, r.race_ts
       FROM predictions p JOIN users u ON u.id = p.user_id JOIN races r ON r.round = p.round
       WHERE p.league_id=? AND p.status='late_pending' ORDER BY p.submitted_at`
    ).bind(lid).all();
    return json({ pending: results.map((p) => ({ ...p, dnfs: JSON.parse(p.dnfs) })), drivers: await listDrivers(env, true) });
  }

  if ((m = path.match(/^\/api\/leagues\/(\d+)\/pending\/(\d+)$/)) && method === 'POST') {
    const lid = Number(m[1]);
    await requireAdmin(env, lid, user.id);
    const b = await readBody(request);
    if (!['approve', 'reject'].includes(b.action)) throw new HttpError(400, 'Invalid action.');
    const p = await one(env.DB.prepare(
      `SELECT p.id, p.user_id, p.round, r.name AS race_name, l.name AS league_name
       FROM predictions p JOIN races r ON r.round=p.round JOIN leagues l ON l.id=p.league_id
       WHERE p.id=? AND p.league_id=? AND p.status='late_pending'`
    ).bind(Number(m[2]), lid));
    if (!p) throw new HttpError(404, 'This request was already handled.');
    const approved = b.action === 'approve';
    await env.DB.prepare(`UPDATE predictions SET status=? WHERE id=?`).bind(approved ? 'late_approved' : 'late_rejected', p.id).run();
    const text = approved
      ? `Your late prediction for the ${p.race_name} in "${p.league_name}" was approved.`
      : `Your late prediction for the ${p.race_name} in "${p.league_name}" was not accepted.`;
    await notify(env, p.user_id, text, `/league/${lid}/race/${p.round}`);
    return json({ ok: true });
  }

  // ---- scoreboard
  if ((m = path.match(/^\/api\/leagues\/(\d+)\/scoreboard$/)) && method === 'GET') {
    const lid = Number(m[1]);
    await requireMember(env, lid, user.id);
    return json(await getScoreboard(env, lid));
  }

  throw new HttpError(404, 'Not found');
}

// ------------------------------------------------------------ data helpers

// Profile of an app user ({ id }) or of a name from the old WPC tables ({ name }).
async function playerProfile(env, key) {
  let user = null;
  if (key.id) {
    user = await one(env.DB.prepare(`SELECT id, name, username, avatar, favorite_team, created_at FROM users WHERE id=?`).bind(key.id));
    if (!user) throw new HttpError(404, 'Player not found.');
  }
  const seasons = await wpcSeasons(env, getScoreboard);
  const table = allTime(seasons);
  const entry = user ? table.find((p) => p.user && p.user.id === user.id) : table.find((p) => p.name === key.name);
  if (!user && !entry) throw new HttpError(404, 'Player not found.');
  if (!user && entry?.user) user = await one(env.DB.prepare(`SELECT id, name, username, avatar, favorite_team, created_at FROM users WHERE id=?`).bind(entry.user.id));
  const wpcName = entry?.name || Object.keys(PLAYERS).find((n) => PLAYERS[n] === user?.username) || null;

  // Season-by-season WPC finishes and the per-race running totals for a sparkline
  const history = seasons.map((s) => {
    const r = s.rows.find((x) => (user && x.user && x.user.id === user.id) || (wpcName && x.name === wpcName));
    return r ? { season: s.season, position: r.position, total: r.total, players: s.rows.length, live: s.live, complete: s.complete, totals: r.totals, races: s.races, stats: seasonStats(s, r) } : null;
  }).filter(Boolean);

  // This season in the app: how often each kind of pick was right
  let current = null;
  if (user) {
    const { results: preds } = await env.DB.prepare(
      `SELECT p.*, r.name AS race_name FROM predictions p JOIN races r ON r.round = p.round
       WHERE p.user_id=? AND p.league_id=? AND p.status IN ('ok','late_approved') ORDER BY p.round`
    ).bind(user.id, WPC_LEAGUE_ID).all();
    const hits = { p1: 0, p2: 0, p3: 0, p4: 0, p5: 0, p10: 0, dnf: 0, dnfPicked: 0 };
    let races = 0, points = 0, best = null;
    for (const p of preds) {
      const lookup = await resultLookup(env, p.round);
      if (!lookup) continue;
      const sc = scorePrediction(p, lookup);
      races++;
      points += sc.pts;
      for (const k of PICK_KEYS) if (sc.detail[k]) hits[k]++;
      hits.dnf += sc.detail.dnfs.filter(Boolean).length;
      hits.dnfPicked += sc.detail.dnfs.length;
      if (!best || sc.pts > best.pts) best = { round: p.round, race: p.race_name, pts: sc.pts };
    }
    current = { season: Number(env.SEASON || new Date().getUTCFullYear()), races, points, best, hits, avg: races ? Math.round((points / races) * 10) / 10 : 0 };
  }

  return {
    player: user ? { id: user.id, name: user.name, avatar: user.avatar, favorite_team: user.favorite_team, joined: user.created_at } : { id: null, name: wpcName, avatar: null },
    wpc_name: wpcName,
    titles: entry ? { titles: entry.titles, podiums: entry.podiums, seasons: entry.seasons, best: entry.best, points: entry.points } : null,
    history,
    current,
  };
}

async function seasonData(env) {
  const [races, results, quali, practice, drivers] = await Promise.all([
    env.DB.prepare(`SELECT round, name, circuit_id, country, race_ts FROM races ORDER BY round`).all(),
    env.DB.prepare(`SELECT round, driver_id, position, pos_text, status FROM results ORDER BY round, position`).all(),
    env.DB.prepare(`SELECT round, driver_id, code, position FROM qualifying ORDER BY round, position`).all(),
    env.DB.prepare(`SELECT round, session, driver_id, code, position, ms FROM practice ORDER BY round, session, position`).all(),
    listDrivers(env, true),
  ]);
  return { season: Number(env.SEASON || new Date().getUTCFullYear()), races: races.results, results: results.results, qualifying: quali.results, practice: practice.results, drivers, server_time: now() };
}

const OPENF1 = 'https://api.openf1.org/v1';
async function openF1(env, ctx, endpoint, search) {
  const target = `${env.OPENF1_BASE || OPENF1}/${endpoint}${search}`;
  const cache = caches.default;
  const key = new Request(target);
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await fetch(target, { headers: { accept: 'application/json', 'User-Agent': 'f1-vietiniai-predictions/1.0' } });
  if (!res.ok) return json({ error: `OpenF1 answered HTTP ${res.status}` }, res.status === 429 ? 429 : 502);
  const out = new Response(res.body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' } });
  ctx.waitUntil(cache.put(key, out.clone()));
  return out;
}

async function listDrivers(env, includeAll = false) {
  const hasResults = (await one(env.DB.prepare(`SELECT COUNT(*) AS n FROM results`))).n > 0;
  // Once races have happened, only offer drivers who actually raced this season.
  const where = hasResults && !includeAll ? `WHERE driver_id IN (SELECT DISTINCT driver_id FROM results)` : '';
  const { results } = await env.DB.prepare(
    `SELECT driver_id, code, number, name, team, photo_url FROM drivers ${where} ORDER BY COALESCE(team, 'zzz'), name`
  ).all();
  return results.map((d) => ({ ...d, photo_url: d.photo_url === '-' ? null : d.photo_url }));
}

async function getRaceOrThrow(env, round) {
  const race = await one(env.DB.prepare(`SELECT * FROM races WHERE round=?`).bind(round));
  if (!race) throw new HttpError(404, 'Race not found.');
  return race;
}

async function resultLookup(env, round) {
  const { results } = await env.DB.prepare(`SELECT driver_id, pos_text FROM results WHERE round=?`).bind(round).all();
  return results.length ? buildResultLookup(results) : null;
}

const shapePrediction = (p, lookup) => {
  const out = { ...p, dnfs: JSON.parse(p.dnfs || '[]') };
  if (lookup) {
    const s = scorePrediction(out, lookup);
    out.points = s.pts;
    out.detail = s.detail;
  }
  return out;
};

async function getRacePredictions(env, lid, round, user) {
  const race = await getRaceOrThrow(env, round);
  const lookup = await resultLookup(env, round);
  const locked = now() >= race.race_ts;
  const { results: rows } = await env.DB.prepare(
    `SELECT p.*, u.name AS user_name, u.avatar AS user_avatar FROM predictions p JOIN users u ON u.id = p.user_id WHERE p.league_id=? AND p.round=?`
  ).bind(lid, round).all();

  const mine = rows.find((p) => p.user_id === user.id);
  let others = [];
  let missing = [];
  if (locked) {
    others = rows.filter((p) => p.user_id !== user.id && ['ok', 'late_approved'].includes(p.status)).map((p) => shapePrediction(p, lookup));
    const { results: members } = await env.DB.prepare(
      `SELECT u.id, u.name, u.avatar FROM members m JOIN users u ON u.id = m.user_id WHERE m.league_id=?`
    ).bind(lid).all();
    const have = new Set(rows.filter((p) => ['ok', 'late_approved'].includes(p.status)).map((p) => p.user_id));
    missing = members.filter((u) => !have.has(u.id)).map((u) => ({ id: u.id, name: u.name, avatar: u.avatar }));
  }

  let resultView = null;
  if (lookup) {
    resultView = { top10: Array.from({ length: 10 }, (_, i) => lookup.byPos[i + 1] || null), dnf: [...lookup.dnf] };
  }
  return {
    race: { ...race, circuit_image: race.circuit_image === '-' ? null : race.circuit_image },
    server_time: now(),
    locked,
    mine: mine ? shapePrediction(mine, lookup) : null,
    others, missing, results: resultView,
  };
}

async function savePrediction(env, ctx, url, lid, round, user, b) {
  const race = await getRaceOrThrow(env, round);

  const picks = {};
  for (const k of PICK_KEYS) picks[k] = String(b[k] || '');
  const dnfs = Array.isArray(b.dnfs) ? b.dnfs.map(String) : [];
  if (dnfs.length > MAX_DNF_PICKS) throw new HttpError(400, `You can pick at most ${MAX_DNF_PICKS} DNFs.`);

  const all = [...PICK_KEYS.map((k) => picks[k]), ...dnfs];
  if (PICK_KEYS.some((k) => !picks[k])) throw new HttpError(400, 'Pick a driver for P1-P5 and P10.');
  if (new Set(all).size !== all.length) throw new HttpError(400, 'Each driver can only be used once in your prediction.');
  const known = new Set((await env.DB.prepare(`SELECT driver_id FROM drivers`).all()).results.map((d) => d.driver_id));
  if (all.some((id) => !known.has(id))) throw new HttpError(400, 'Unknown driver selected.');

  const existing = await one(env.DB.prepare(`SELECT status FROM predictions WHERE league_id=? AND user_id=? AND round=?`).bind(lid, user.id, round));
  const onTime = now() < race.race_ts;
  let status = 'ok';

  if (!onTime) {
    if (existing && ['ok', 'late_approved'].includes(existing.status)) throw new HttpError(403, 'Predictions are locked for this race.');
    const others = (await leagueAdmins(env, lid)).filter((a) => a.id !== user.id);
    status = others.length ? 'late_pending' : 'late_approved'; // a lone admin approves themselves
    if (status === 'late_pending') {
      const l = await one(env.DB.prepare(`SELECT name FROM leagues WHERE id=?`).bind(lid));
      const text = `${user.name} submitted a late prediction for the ${race.name} in "${l.name}". Approval needed.`;
      for (const a of others) {
        await notify(env, a.id, text, `/league/${lid}/approvals`);
      }
    }
  }

  await env.DB.prepare(
    `INSERT INTO predictions (league_id, user_id, round, p1, p2, p3, p4, p5, p10, dnfs, status, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(league_id, user_id, round) DO UPDATE SET p1=excluded.p1, p2=excluded.p2, p3=excluded.p3, p4=excluded.p4,
       p5=excluded.p5, p10=excluded.p10, dnfs=excluded.dnfs, status=excluded.status, submitted_at=excluded.submitted_at`
  ).bind(lid, user.id, round, picks.p1, picks.p2, picks.p3, picks.p4, picks.p5, picks.p10, JSON.stringify(dnfs), status, now()).run();

  return { status };
}

async function getScoreboard(env, lid) {
  const { results: races } = await env.DB.prepare(
    `SELECT r.round, r.name, r.country, r.circuit_name FROM races r
     WHERE EXISTS (SELECT 1 FROM results x WHERE x.round = r.round) ORDER BY r.round`
  ).all();
  const { results: members } = await env.DB.prepare(
    `SELECT u.id, u.name, u.avatar FROM members m JOIN users u ON u.id = m.user_id WHERE m.league_id=? ORDER BY u.name`
  ).bind(lid).all();
  const { results: preds } = await env.DB.prepare(
    `SELECT * FROM predictions WHERE league_id=? AND status IN ('ok','late_approved')`
  ).bind(lid).all();

  const lookups = {};
  for (const r of races) lookups[r.round] = await resultLookup(env, r.round);

  const board = members.map((mem) => {
    let total = 0;
    const per_race = races.map((r) => {
      const p = preds.find((x) => x.user_id === mem.id && x.round === r.round);
      const pts = p ? scorePrediction(p, lookups[r.round]).pts : 0;
      total += pts;
      return { round: r.round, pts, total, submitted: !!p, change: pts > 0 ? 'up' : 'same' };
    });
    return { id: mem.id, name: mem.name, avatar: mem.avatar, total, per_race };
  });
  board.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return { races, board };
}
