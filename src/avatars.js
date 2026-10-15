// Profile pictures. users.avatar holds what to show:
//   helmet:<team slug>   a helmet in the team's colours, drawn by the web page
//   team:<team slug>     the team logo on the team colour
//   url:<image address>  a driver photo (formula1.com, chosen from the drivers list)
//   upload:<time>        the user's own picture, stored in the avatars table and served by /api/avatars/<id>
//   NULL                 initials
// Uploaded pictures are cropped and shrunk to 256x256 in the browser before they are sent, so a
// stored picture is only some tens of kilobytes.

import { HttpError } from './util.js';
import { TEAM_SLUGS } from './f1teams.js';

const MAX_BASE64 = 400_000; // about 300 KB of image data
const TYPES = ['image/jpeg', 'image/webp', 'image/png'];

export async function saveAvatar(env, userId, body) {
  const t = Date.now();
  let value = null;
  if (body.image) {
    const m = String(body.image).match(/^data:(image\/(?:jpeg|webp|png));base64,([A-Za-z0-9+/=]+)$/);
    if (!m || !TYPES.includes(m[1])) throw new HttpError(400, 'Please choose a JPG, PNG or WebP picture.');
    if (m[2].length > MAX_BASE64) throw new HttpError(400, 'The picture is too large.');
    await env.DB.prepare(
      `INSERT INTO avatars (user_id, mime, data, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET mime=excluded.mime, data=excluded.data, updated_at=excluded.updated_at`
    ).bind(userId, m[1], m[2], t).run();
    value = `upload:${t}`;
  } else {
    const a = String(body.avatar || '');
    const [kind, key] = [a.split(':')[0], a.slice(a.indexOf(':') + 1)];
    if (!a) value = null;
    else if ((kind === 'helmet' || kind === 'team') && TEAM_SLUGS.has(key)) value = `${kind}:${key}`;
    else if (kind === 'driver') {
      const d = await env.DB.prepare(`SELECT photo_url FROM drivers WHERE driver_id=?`).bind(key).first();
      if (!d || !d.photo_url || d.photo_url === '-') throw new HttpError(400, 'That driver has no photo.');
      value = `url:${d.photo_url}`;
    } else throw new HttpError(400, 'Unknown picture.');
    await env.DB.prepare(`DELETE FROM avatars WHERE user_id=?`).bind(userId).run();
  }
  await env.DB.prepare(`UPDATE users SET avatar=? WHERE id=?`).bind(value, userId).run();
  return value;
}

export async function avatarResponse(env, userId) {
  const row = await env.DB.prepare(`SELECT mime, data FROM avatars WHERE user_id=?`).bind(userId).first();
  if (!row) return new Response('Not found', { status: 404 });
  const bytes = Uint8Array.from(atob(row.data), (c) => c.charCodeAt(0));
  // the page asks for /api/avatars/<id>?v=<time>, so a new picture gets a new address
  return new Response(bytes, { headers: { 'content-type': row.mime, 'cache-control': 'private, max-age=31536000, immutable' } });
}
