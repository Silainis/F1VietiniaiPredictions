const enc = new TextEncoder();

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export async function readBody(request) {
  try {
    return (await request.json()) || {};
  } catch {
    throw new HttpError(400, 'Invalid request body');
  }
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---- encoding helpers ----
const b64e = (bytes) => btoa(String.fromCharCode(...bytes));
const b64d = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

export function randomToken(bytes = 32) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function randomCode(len = 10) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export async function sha256Hex(text) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))));
}

// ---- passwords (PBKDF2, the strongest iteration count Workers allows) ----
// The stored "salt" field looks like "100000$<salt>" so the iteration count travels with each
// password. That means PBKDF2_ITERATIONS can be changed later without locking anyone out.
export async function hashPassword(password, saltField, iterations = 100000) {
  let salt;
  let iter = Math.min(100000, Math.max(1000, Number(iterations) || 100000)); // Workers allows at most 100000
  if (saltField) {
    const [i, s] = saltField.split('$');
    iter = Number(i);
    salt = b64d(s);
  } else {
    salt = crypto.getRandomValues(new Uint8Array(16));
  }
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, key, 256);
  return { hash: b64e(new Uint8Array(bits)), salt: `${iter}$${b64e(salt)}` };
}

export function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
