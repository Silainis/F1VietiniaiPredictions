// One-click release: logs in to Cloudflare, creates the database, publishes the app,
// sets the admin key and checks that the live site answers.
//
// Run it by double-clicking release.bat (Windows) or with:  npm run release
// It is safe to run again: every step is skipped when it is already done, so the same
// script also publishes later updates.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
process.chdir(ROOT);

const WIN = process.platform === 'win32';
const NPX = process.env.RELEASE_NPX || (WIN ? 'npx.cmd' : 'npx');
const NPM = process.env.RELEASE_NPM || (WIN ? 'npm.cmd' : 'npm');
const CONFIG = 'wrangler.jsonc';
const DB_NAME = 'f1-predictions';
const KEY_FILE = 'admin-key.txt';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const say = (s = '') => console.log(s);
let stepNo = 0;
const step = (s) => say(`\n[${++stepNo}] ${s}`);
const ok = (s) => say(`    OK  ${s}`);
const note = (s) => say(`        ${s}`);

class Stop extends Error {}
const stop = (msg) => { throw new Stop(msg); };

// Runs a command. mode 'show' lets the user see and answer it (used for the Cloudflare login),
// 'capture' collects the output (and prints it afterwards unless quiet).
function run(cmd, args, { mode = 'capture', input, quiet = false, env } = {}) {
  const base = { ...process.env, ...(env || {}) };
  if (mode === 'show') {
    const r = spawnSync(cmd, args, { stdio: 'inherit', shell: WIN, env: base });
    return { code: r.status ?? 1, out: '' };
  }
  const r = spawnSync(cmd, args, {
    encoding: 'utf8', shell: WIN, env: base, input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  if (!quiet && out.trim()) say(out.trim().split('\n').map((l) => '        ' + l).join('\n'));
  return { code: r.status ?? 1, out };
}
const wrangler = (args, opts) => run(NPX, ['wrangler', ...args], opts);

let accountEnv = {};
const wr = (args, opts = {}) => wrangler(args, { ...opts, env: { ...accountEnv, ...(opts.env || {}) } });

async function main() {
  say('==============================================');
  say('  F1 Vietiniai Predictions - release to Cloudflare');
  say('==============================================');

  // ---- 1. tools
  step('Checking your computer');
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) stop(`Node.js ${process.versions.node} is too old. Install the current LTS version from https://nodejs.org and run this again.`);
  ok(`Node.js ${process.versions.node}`);
  if (!fs.existsSync(CONFIG)) stop(`${CONFIG} not found. Run this script from the project folder.`);
  if (!fs.existsSync(path.join('node_modules', 'wrangler'))) {
    note('Installing the project tools (first time only, about a minute)...');
    const r = run(NPM, ['install', '--no-audit', '--no-fund'], { mode: 'show' });
    if (r.code !== 0) stop('npm install failed. Check your internet connection and run this again.');
  }
  ok('project tools installed');

  // ---- 2. Cloudflare login
  step('Logging in to Cloudflare');
  let who = wr(['whoami'], { quiet: true });
  if (/not authenticated|not logged in/i.test(who.out) || who.code !== 0) {
    note('A browser window will open. Log in to Cloudflare there and click "Allow".');
    const r = wr(['login'], { mode: 'show' });
    if (r.code !== 0) stop('Cloudflare login did not finish. Run this again and click "Allow" in the browser.');
    who = wr(['whoami'], { quiet: true });
    if (/not authenticated|not logged in/i.test(who.out)) stop('Still not logged in to Cloudflare. Run this again.');
  }
  ok('logged in');

  // Several Cloudflare accounts? Ask once, so no command stops to ask later.
  const accounts = [...who.out.matchAll(/^[|│]\s*(.+?)\s*[|│]\s*([0-9a-f]{32})\s*[|│]?\s*$/gim)].map((m) => ({ name: m[1], id: m[2] }));
  if (accounts.length === 1) accountEnv = { CLOUDFLARE_ACCOUNT_ID: accounts[0].id };
  if (accounts.length > 1) {
    say('\n    You have several Cloudflare accounts:');
    accounts.forEach((a, i) => say(`      ${i + 1}) ${a.name}`));
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let pick = 0;
    while (!(pick >= 1 && pick <= accounts.length)) pick = Number((await rl.question('    Which one owns f1-vietiniai-predictions? Type its number: ')).trim());
    rl.close();
    accountEnv = { CLOUDFLARE_ACCOUNT_ID: accounts[pick - 1].id };
    ok(`using ${accounts[pick - 1].name}`);
  }

  // ---- 3. database
  step('Preparing the database');
  let cfg = fs.readFileSync(CONFIG, 'utf8');
  const idMatch = cfg.match(/"database_id"\s*:\s*"([^"]*)"/);
  if (!idMatch) stop(`Could not find "database_id" in ${CONFIG}.`);
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  if (UUID.test(idMatch[1])) {
    ok(`database already set up (${idMatch[1].slice(0, 8)}...)`);
  } else {
    let id = null;
    const info = wr(['d1', 'info', DB_NAME, '--json'], { quiet: true });
    if (info.code === 0) {
      try { id = JSON.parse(info.out.slice(info.out.indexOf('{'))).uuid; } catch { id = (info.out.match(UUID) || [])[0] || null; }
      if (id) note(`database "${DB_NAME}" already exists, reusing it`);
    }
    if (!id) {
      note(`Creating database "${DB_NAME}"...`);
      const created = wr(['d1', 'create', DB_NAME]);
      id = (created.out.match(UUID) || [])[0] || null;
      if (created.code !== 0 || !id) stop('Could not create the database. The message above says why (often: D1 is not enabled yet; open dash.cloudflare.com > Storage & Databases > D1 once, then run this again).');
    }
    fs.writeFileSync(CONFIG, cfg.replace(idMatch[0], `"database_id": "${id}"`));
    ok('database id saved in wrangler.jsonc');
  }

  // ---- 4. publish
  step('Publishing the app (about 20 seconds)');
  const dep = wr(['deploy']);
  if (dep.code !== 0) {
    stop('Publishing failed. Read the message above. Common fixes: run this again after logging in; if it names a different account, delete CLOUDFLARE_ACCOUNT_ID from your environment variables.');
  }
  const url = (dep.out.match(/https:\/\/[A-Za-z0-9.-]+\.workers\.dev/) || [])[0];
  if (!url) stop('The app was published but I could not read its address from the output above. Open Cloudflare > Workers & Pages to see it.');
  ok(`published at ${url}`);

  // ---- 5. admin key
  step('Setting the admin key');
  const secrets = wr(['secret', 'list', '--format', 'json'], { quiet: true });
  let haveKey = false;
  try { haveKey = JSON.parse(secrets.out.slice(secrets.out.indexOf('['))).some((s) => s.name === 'ADMIN_KEY'); } catch { /* treat as missing */ }
  let adminKey = fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, 'utf8').trim() : '';
  if (haveKey) {
    ok('admin key already set');
  } else {
    adminKey = crypto.randomBytes(24).toString('hex');
    const put = wr(['secret', 'put', 'ADMIN_KEY'], { input: adminKey + '\n', quiet: true });
    if (put.code !== 0) {
      say(put.out.trim());
      stop('Could not save the admin key. The app is already online; run this again to retry.');
    }
    fs.writeFileSync(KEY_FILE, adminKey + '\n');
    ok(`admin key created and saved in ${KEY_FILE} on this computer (keep it private)`);
  }

  // ---- 6. check the live site
  step('Checking the live site');
  const base = process.env.RELEASE_VERIFY_BASE || url;
  let alive = false;
  for (let i = 0; i < 8 && !alive; i++) {
    try {
      const res = await fetch(`${base}/api/me`);
      alive = res.ok && (res.headers.get('content-type') || '').includes('json');
    } catch { /* not ready yet */ }
    if (!alive) await sleep(i === 0 ? 1500 : 4000);
  }
  if (!alive) {
    note('The site did not answer yet. Cloudflare can need a minute for a first publish; open the address below in a browser.');
  } else {
    ok('the site is answering');
    if (adminKey) {
      try {
        const res = await fetch(`${base}/api/admin/sync?key=${encodeURIComponent(adminKey)}`);
        const j = await res.json();
        if (res.ok && j.races) ok(`calendar imported: ${j.races} races, ${j.drivers ?? '?'} drivers`);
        else note(`data import returned: ${JSON.stringify(j)} (it also retries by itself every 30 minutes)`);
      } catch (e) {
        note(`could not run the first data import (${e.message}); it also runs by itself every 30 minutes`);
      }
    }
  }

  say('\n==============================================');
  say('  DONE');
  say(`  Your app:  ${url}`);
  say('  1. Open it, create your account and a league.');
  say('  2. Copy the invite link from the Members tab and send it to your friends.');
  if (adminKey) say(`  Data refresh link (only for you):  ${url}/api/admin/sync?key=${adminKey}`);
  say('==============================================');
}

main().then(
  () => process.exit(0),
  (e) => {
    say('\n----------------------------------------------');
    if (e instanceof Stop) say('  STOPPED: ' + e.message);
    else say('  Unexpected error: ' + (e && e.stack ? e.stack : e));
    say('----------------------------------------------');
    process.exit(1);
  }
);
