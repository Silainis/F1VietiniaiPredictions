// Pulls the race calendar, drivers, results and images into the database.
//
// Data source: the Jolpica F1 API (the maintained successor of Ergast). It mirrors
// the official classification, and unlike scraping formula1.com pages it returns
// stable JSON. Driver photos and circuit maps come from formula1.com (src/f1photos.js and
// src/f1tracks.js); Wikipedia is only a fallback for drivers without a formula1.com photo.

import { f1PhotoFor } from './f1photos.js';
import { f1TrackFor } from './f1tracks.js';
import { Budget, syncQualifying } from './insights.js';
import { syncPractice } from './practice.js';
import { syncResults } from './results.js';
import { syncStandings } from './standings.js';

const UA = 'f1-vietiniai-predictions/1.0 (https://f1-vietiniai-predictions.f1vietiniai.workers.dev)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const base = (env) => env.JOLPICA_BASE || 'https://api.jolpi.ca/ergast/f1';
const wiki = (env) => env.WIKI_BASE || 'https://en.wikipedia.org/api/rest_v1/page/summary';
const season = (env) => env.SEASON || String(new Date().getUTCFullYear());

// The Jolpica API allows only a few requests per second, so calls are spaced out
// and a rate-limit answer (429) is retried once after a pause.
async function getJson(env, url) {
  const gap = env.JOLPICA_DELAY_MS !== undefined ? Number(env.JOLPICA_DELAY_MS) : 350;
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(gap);
    const res = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' } });
    if (res.status === 429 && attempt < 2) { await sleep(gap ? Math.min(15, Number(res.headers.get('retry-after')) || 4 * (attempt + 1)) * 1000 : 0); continue; }
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    return res.json();
  }
}

// Start time of a weekend session from the Jolpica calendar ({ date, time }), or null.
const sessionTs = (s) => (s?.date ? Date.parse(`${s.date}T${s.time || '12:00:00Z'}`) : null);

export async function syncSchedule(env) {
  const data = await getJson(env, `${base(env)}/${season(env)}.json?limit=100`);
  const races = data.MRData.RaceTable.Races || [];
  const stmt = env.DB.prepare(
    `INSERT INTO races (round, name, circuit_id, circuit_name, locality, country, race_ts, wiki_url, circuit_wiki_url, quali_ts, fp1_ts, fp2_ts, fp3_ts, sprint)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(round) DO UPDATE SET name=excluded.name, circuit_id=excluded.circuit_id,
       circuit_name=excluded.circuit_name, locality=excluded.locality, country=excluded.country,
       race_ts=excluded.race_ts, wiki_url=excluded.wiki_url, circuit_wiki_url=excluded.circuit_wiki_url,
       quali_ts=excluded.quali_ts, fp1_ts=excluded.fp1_ts, fp2_ts=excluded.fp2_ts, fp3_ts=excluded.fp3_ts, sprint=excluded.sprint`
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
          r.Circuit.url || null,
          r.Qualifying?.date ? Date.parse(`${r.Qualifying.date}T${r.Qualifying.time || '14:00:00Z'}`) : null,
          sessionTs(r.FirstPractice), sessionTs(r.SecondPractice), sessionTs(r.ThirdPractice),
          r.Sprint || r.SprintQualifying ? 1 : 0
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

// One run makes at most ~45 outside requests (the free Workers plan allows 50). The fixed jobs go
// first; qualifying and missing photos share what is left.
export async function syncAll(env, { extras = true } = {}) {
  const out = {};
  const budget = new Budget(Number(env.SYNC_BUDGET || 45));
  budget.take(2);
  try { out.races = await syncSchedule(env); } catch (e) { out.racesError = e.message; }
  try { out.f1tracks = await applyF1Tracks(env); } catch (e) { out.f1tracksError = e.message; }
  try { out.drivers = await syncDrivers(env); } catch (e) { out.driversError = e.message; }
  try { out.results = await syncResults(env, budget); } catch (e) { out.resultsError = e.message; }
  try { out.f1photos = await applyF1Photos(env); } catch (e) { out.f1photosError = e.message; }
  if (extras) {
    try { out.qualifying = await syncQualifying(env, budget); } catch (e) { out.qualifyingError = e.message; }
    try { out.practice = await syncPractice(env, budget); } catch (e) { out.practiceError = e.message; }
    try { out.standings = await syncStandings(env, budget); } catch (e) { out.standingsError = e.message; }
  }
  try { out.images = await syncImages(env, Math.min(10, budget.left)); } catch (e) { out.imagesError = e.message; }
  return out;
}
