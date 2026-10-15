// Database tables. They are created automatically on first request.
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    pass_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    must_change INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS leagues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    owner_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS members (
    league_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (league_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS races (
    round INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    circuit_id TEXT,
    circuit_name TEXT,
    locality TEXT,
    country TEXT,
    race_ts INTEGER NOT NULL,
    wiki_url TEXT,
    circuit_wiki_url TEXT,
    circuit_image TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS drivers (
    driver_id TEXT PRIMARY KEY,
    code TEXT,
    number TEXT,
    name TEXT NOT NULL,
    team TEXT,
    wiki_url TEXT,
    photo_url TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS results (
    round INTEGER NOT NULL,
    driver_id TEXT NOT NULL,
    position INTEGER,
    pos_text TEXT,
    status TEXT,
    PRIMARY KEY (round, driver_id)
  )`,
  `CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    round INTEGER NOT NULL,
    p1 TEXT, p2 TEXT, p3 TEXT, p4 TEXT, p5 TEXT, p10 TEXT,
    dnfs TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'ok',
    submitted_at INTEGER NOT NULL,
    UNIQUE (league_id, user_id, round)
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    link TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  // Qualifying classification per race (formula1.com results page, Jolpica as a fallback).
  `CREATE TABLE IF NOT EXISTS qualifying (
    round INTEGER NOT NULL,
    position INTEGER NOT NULL,
    pos_text TEXT,
    number TEXT,
    code TEXT,
    driver_id TEXT,
    name TEXT,
    team TEXT,
    q1 TEXT, q2 TEXT, q3 TEXT,
    laps INTEGER,
    source TEXT,
    fetched_at INTEGER,
    PRIMARY KEY (round, position)
  )`,
  // Past editions of a race at the same circuit: podium plus lead changes and overtakes
  // worked out from the lap-by-lap positions (see src/insights.js).
  `CREATE TABLE IF NOT EXISTS track_history (
    circuit_id TEXT NOT NULL,
    season INTEGER NOT NULL,
    round INTEGER NOT NULL,
    race_name TEXT,
    podium TEXT NOT NULL DEFAULT '[]',
    laps INTEGER,
    lead_changes INTEGER,
    leaders INTEGER,
    overtakes INTEGER,
    stats_done INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (circuit_id, season)
  )`,
  `CREATE TABLE IF NOT EXISTS track_meta (
    circuit_id TEXT PRIMARY KEY,
    podiums_at INTEGER
  )`,
  // What the last scheduled syncs did (kept short), to see from the database whether imports work.
  `CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    result TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications (user_id, read)`,
  `CREATE INDEX IF NOT EXISTS idx_pred_league_round ON predictions (league_id, round)`,
];

async function addColumns(env, statements) {
  for (const sql of statements) await env.DB.prepare(sql).run().catch(() => {});
}

let ready = null;
export function ensureSchema(env) {
  if (!ready) {
    ready = env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)))
      // columns added after the first release; the error when the column already exists is expected
      .then(() => addColumns(env, [
        `ALTER TABLE users ADD COLUMN favorite_team TEXT`,
        `ALTER TABLE races ADD COLUMN quali_ts INTEGER`,
        `ALTER TABLE races ADD COLUMN f1_meeting_id TEXT`,
        `ALTER TABLE races ADD COLUMN f1_slug TEXT`,
        `ALTER TABLE races ADD COLUMN quali_checked_at INTEGER`,
        `ALTER TABLE qualifying ADD COLUMN grid TEXT`,
      ]))
      .catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}
