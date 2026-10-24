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
  // Championship standings (formula1.com) used to sort the driver picker; see src/standings.js.
  `CREATE TABLE IF NOT EXISTS standings (
    season INTEGER NOT NULL,
    kind TEXT NOT NULL,
    position INTEGER NOT NULL,
    code TEXT,
    name TEXT,
    team TEXT,
    points REAL,
    fetched_at INTEGER,
    PRIMARY KEY (season, kind, position)
  )`,
  // Best lap per driver in each practice session (formula1.com results pages, see src/practice.js).
  `CREATE TABLE IF NOT EXISTS practice (
    round INTEGER NOT NULL,
    session INTEGER NOT NULL,
    position INTEGER NOT NULL,
    pos_text TEXT,
    number TEXT,
    code TEXT,
    driver_id TEXT,
    name TEXT,
    team TEXT,
    time TEXT,
    ms INTEGER,
    laps INTEGER,
    fetched_at INTEGER,
    PRIMARY KEY (round, session, position)
  )`,
  // Uploaded profile pictures (small JPEG/WebP made in the browser, stored as base64).
  `CREATE TABLE IF NOT EXISTS avatars (
    user_id INTEGER PRIMARY KEY,
    mime TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
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

// Columns added after the first release, per table.
const COLUMNS = {
  users: { favorite_team: 'TEXT', username: 'TEXT', avatar: 'TEXT' },
  races: { quali_ts: 'INTEGER', f1_meeting_id: 'TEXT', f1_slug: 'TEXT', quali_checked_at: 'INTEGER', fp1_ts: 'INTEGER', fp2_ts: 'INTEGER', fp3_ts: 'INTEGER', sprint: 'INTEGER', practice_checked_at: 'INTEGER' },
  qualifying: { grid: 'TEXT' },
};

// Runs once per Worker instance. Each request does the work itself until one has finished it: a promise
// started by one request must not be awaited by another (if the first request is cancelled, for example
// because the visitor closed the page, its database calls never finish and every later request would
// wait forever; that left the whole app stuck on "Loading…" on 2026-10-24).
let ready = false;
export async function ensureSchema(env) {
  if (ready) return;
  await env.DB.batch(SCHEMA.map((sql) => env.DB.prepare(sql)));
  const tables = Object.keys(COLUMNS);
  const info = await env.DB.batch(tables.map((t) => env.DB.prepare(`SELECT name FROM pragma_table_info('${t}')`)));
  const missing = [];
  tables.forEach((t, i) => {
    const have = new Set((info[i].results || []).map((r) => r.name));
    for (const [col, type] of Object.entries(COLUMNS[t])) if (!have.has(col)) missing.push(`ALTER TABLE ${t} ADD COLUMN ${col} ${type}`);
  });
  // another request may add the same column at the same moment: that error is expected
  for (const sql of missing) await env.DB.prepare(sql).run().catch(() => {});
  await env.DB.batch([
    // accounts made with an email before usernames existed: their name becomes the username
    // (an id is added if two names are the same); they can still log in with their email too
    env.DB.prepare(`UPDATE users SET username = lower(name) || CASE WHEN EXISTS (SELECT 1 FROM users u2 WHERE lower(u2.name) = lower(users.name) AND u2.id < users.id) THEN id ELSE '' END WHERE username IS NULL`),
    env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (username)`),
  ]);
  ready = true;
}
