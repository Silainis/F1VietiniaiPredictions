// Pulls the race calendar, drivers, results and images into the database.
//
// Data source: the Jolpica F1 API (the maintained successor of Ergast). It mirrors
// the official classification, and unlike scraping formula1.com pages it returns
// stable JSON. Driver photos and circuit maps come from formula1.com (src/f1photos.js and
// src/f1tracks.js); Wikipedia is only a fallback for drivers without a formula1.com photo.

import { f1PhotoFor } from './f1photos.js';
import { f1TrackFor } from './f1tracks.js';

const UA = 'f1-vietiniai-predictions/1.0 (https://f1-vietiniai-predictions.f1vietiniai.workers.dev)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const base = (env) => env.JOLPICA_BASE || 'https://api.jolpi.ca/ergast/f1';
const wiki = (env) => env.WIKI_BASE || 'https://en.wikipedia.org/api/rest_v1/page/summary';
const season = (env) => env.SEASON || String(new Date().getUTCFullYear());

// The Jolpica API allows only a few requests per second, so calls are spaced out
// and a rate-limit answer (429) is retried once after a pause.
async function getJson(env, url) {
  const gap = env.JOLPICA_DELAY_MS !== undefined ? Number(env.JOLPICA_DELAY_MS) : 350;
  for (let attempt = 0; attempt < 2; attempt++) {
    await sleep(gap);
    const res = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' } });
    if (res.status === 429 && attempt === 0) { await sleep(2000); continue; }
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    return res.json();
  }
}

export async function syncSchedule(env) {
  const data = await getJson(env, `${base(env)}/${season(env)}.json?limit=100`);
  const races = data.MRData.RaceTable.Races || [];
  const stmt = env.DB.prepare(
    `INSERT INTO races (round, name, circuit_id, circuit_name, locality, country, race_ts, wiki_url, circuit_wiki_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(round) DO UPDATE SET name=excluded.name, circuit_id=excluded.circuit_id,
       circuit_name=excluded.circuit_name, locality=excluded.locality, country=excluded.country,
       race_ts=excluded.race_ts, wiki_url=excluded.wiki_url, circuit_wiki_url=excluded.circuit_wiki_url`
  );
  if (races.length) {
    await env.DB.batch(
      races.map((r) =>
        stmt.bind(
          Number(r.round),
          r.raceName,
          r.Circuit.circuitId,
          r.Circuit.circuitName,
          r.Circuit.Location.locality,
          r.Circuit.Location.country,
          Date.parse(`${r.date}T${r.time || '13:00:00Z'}`),
          r.url || null,
          r.Circuit.url || null
        )
      )
    );
  }
  return races.length;
}

const upsertDriver = (env) =>
  env.DB.prepare(
    `INSERT INTO drivers (driver_id, code, number, name, wiki_url) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(driver_id) DO UPDATE SET code=excluded.code, number=excluded.number,
       name=excluded.name, wiki_url=COALESCE(excluded.wiki_url, drivers.wiki_url)`
  );

export async function syncDrivers(env) {
  const data = await getJson(env, `${base(env)}/${season(env)}/drivers.json?limit=100`);
  // Reserve/test drivers come without a code or number; skip them.
  const list = (data.MRData.DriverTable.Drivers || []).filter((d) => d.code && d.permanentNumber);
  const stmt = upsertDriver(env);
  if (list.length) {
    await env.DB.batch(
      list.map((d) => stmt.bind(d.driverId, d.code, d.permanentNumber, `${d.givenName} ${d.familyName}`, d.url || null))
    );
  }
  return list.length;
}

// Fetches results for every race that started more than 2 hours ago and has none stored yet.
// Returns the number of HTTP requests made.
export async function syncResults(env, maxRaces = 20) {
  const cutoff = Date.now() - 2 * 3600 * 1000;
  const { results: due } = await env.DB.prepare(
    `SELECT round, name FROM races r
     WHERE race_ts < ? AND NOT EXISTS (SELECT 1 FROM results x WHERE x.round = r.round)
     ORDER BY round LIMIT ?`
  )
    .bind(cutoff, maxRaces)
    .all();

  let requests = 0;
  for (const race of due) {
    requests++;
    let data;
    try {
      data = await getJson(env, `${base(env)}/${season(env)}/${race.round}/results.json?limit=100`);
    } catch (e) {
      console.error('Results fetch failed', race.round, e.message);
      continue;
    }
    const rows = data.MRData.RaceTable.Races?.[0]?.Results;
    if (!rows || !rows.length) continue; // official results not published yet

    const stmts = [];
    for (const r of rows) {
      stmts.push(
        upsertDriver(env).bind(r.Driver.driverId, r.Driver.code || null, r.Driver.permanentNumber || r.number || null,
          `${r.Driver.givenName} ${r.Driver.familyName}`, r.Driver.url || null),
        env.DB.prepare(`UPDATE drivers SET team=? WHERE driver_id=?`).bind(r.Constructor?.name || null, r.Driver.driverId),
        env.DB.prepare(
          `INSERT OR REPLACE INTO results (round, driver_id, position, pos_text, status) VALUES (?, ?, ?, ?, ?)`
        ).bind(race.round, r.Driver.driverId, Number(r.position), String(r.positionText), r.status)
      );
    }
    await env.DB.batch(stmts);

    await env.DB.prepare(
      `INSERT INTO notifications (user_id, text, link, created_at)
       SELECT DISTINCT user_id, ?, '/', ? FROM members`
    )
      .bind(`Results are in for the ${race.name}. Check the scoreboard!`, Date.now())
      .run();
  }
  return requests;
}

// Sets the formula1.com photo for every driver listed in src/f1photos.js. No network requests;
// it only writes when a photo is missing or different, so it is cheap to run often.
export async function applyF1Photos(env) {
  const { results } = await env.DB.prepare(`SELECT driver_id, name FROM drivers`).all();
  const stmts = [];
  for (const d of results) {
    const url = f1PhotoFor(d.name);
    if (url) {
      stmts.push(env.DB.prepare(`UPDATE drivers SET photo_url=? WHERE driver_id=? AND COALESCE(photo_url,'')<>?`).bind(url, d.driver_id, url));
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  return stmts.length;
}

// Sets the formula1.com circuit map for every race (matched by circuit id, see src/f1tracks.js).
// A circuit without a map gets none, so the page shows a placeholder instead of a different style.
export async function applyF1Tracks(env) {
  const { results } = await env.DB.prepare(`SELECT round, circuit_id FROM races`).all();
  const stmts = results.map((r) => {
    const url = f1TrackFor(r.circuit_id);
    return env.DB.prepare(`UPDATE races SET circuit_image=? WHERE round=? AND COALESCE(circuit_image,'')<>COALESCE(?,'')`).bind(url, r.round, url);
  });
  if (stmts.length) await env.DB.batch(stmts);
  return stmts.length;
}

// Driver photos from Wikipedia, only for drivers without a formula1.com photo. Only fetches what is missing,
// at most `max` per run, so it is safe on the free Workers plan (50 requests per run).
export async function syncImages(env, max = 30) {
  if (max <= 0) return 0;
  let used = 0;
  const title = (url) => decodeURIComponent(new URL(url).pathname.split('/').pop());
  const thumb = async (url) => {
    used++;
    try {
      const res = await fetch(`${wiki(env)}/${encodeURIComponent(title(url))}`, {
        headers: { 'User-Agent': UA, accept: 'application/json' },
      });
      if (!res.ok) return '-';
      const j = await res.json();
      return j.thumbnail?.source || '-';
    } catch {
      return '-';
    }
  };

  const { results: drivers } = await env.DB.prepare(
    `SELECT driver_id, wiki_url FROM drivers WHERE photo_url IS NULL AND wiki_url IS NOT NULL LIMIT ?`
  )
    .bind(max)
    .all();
  for (const d of drivers) {
    const src = await thumb(d.wiki_url);
    await env.DB.prepare(`UPDATE drivers SET photo_url=? WHERE driver_id=?`).bind(src, d.driver_id).run();
  }

  return used;
}

export async function syncAll(env) {
  const out = {};
  try { out.races = await syncSchedule(env); } catch (e) { out.racesError = e.message; }
  try { out.f1tracks = await applyF1Tracks(env); } catch (e) { out.f1tracksError = e.message; }
  try { out.drivers = await syncDrivers(env); } catch (e) { out.driversError = e.message; }
  let used = 2;
  try { used += await syncResults(env); } catch (e) { out.resultsError = e.message; }
  try { out.f1photos = await applyF1Photos(env); } catch (e) { out.f1photosError = e.message; }
  try { out.images = await syncImages(env, 44 - used); } catch (e) { out.imagesError = e.message; }
  return out;
}
