'use strict';
/**
 * Thobe World on cPanel: the release switcher.
 *
 * This is the « Application startup file » of the cPanel « Setup Node.js App »
 * entry (uploaded as `app.cjs` by `npm run deploy`; do not edit it on the
 * server). It lives in the application root, next to:
 *
 *   CURRENT                 the release to run (written by the deploy tool)
 *   GOOD                    the last release that passed its health check
 *   release-<id>.twpkg      an uploaded release, until it is unpacked
 *   release-<id>.sha256     its checksum, written after the upload completed
 *   releases/<id>/          unpacked releases (the newest few are kept)
 *   data/                   H47 Pay's projection, photos, image cache (shared)
 *   .env                    shared settings, if not set in cPanel
 *   logs/bootstrap.log      what this file did
 *
 * Switching or rolling back is only « write CURRENT »: this process notices
 * within two seconds and exits, and Passenger starts the new one on the next
 * request. If CURRENT does not load, GOOD is started instead.
 *
 * Plain CommonJS with no dependency, so it runs on any Node ≥ 20 whatever was
 * uploaded.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const ROOT = __dirname;
const RELEASES = path.join(ROOT, 'releases');
const KEEP = Number(process.env.TW_KEEP_RELEASES ?? 5);
// Letters, digits, - and _ only: never « . » or « .. » (which would name the app folder itself).
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const MAX_UNPACKED_BYTES = 400 * 1024 * 1024;
const MAX_FILES = 20_000;
const MAGIC = 'TWPKG1\n';

function log(message) {
  const line = `${new Date().toISOString()} [${process.pid}] ${message}\n`;
  process.stderr.write(line);
  try {
    const dir = path.join(ROOT, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'bootstrap.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 1_000_000) fs.renameSync(file, `${file}.1`);
    fs.appendFileSync(file, line);
  } catch {
    // logging must never stop the shop
  }
}

const readText = (name) => {
  try {
    return fs.readFileSync(path.join(ROOT, name), 'utf8').trim();
  } catch {
    return '';
  }
};

/** Shared settings: ROOT/.env fills what cPanel's environment variables did not set. */
function loadSharedEnv() {
  let text = '';
  try {
    text = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/u)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/u.exec(line);
    if (!match || line.trim().startsWith('#') || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/u, '$2');
  }
}

/**
 * A release package: "TWPKG1\n", then for each file a 4-byte big-endian header
 * length, a JSON header {p: posix path, m: mode, s: size} and the bytes. Gzipped.
 */
function unpack(buffer, targetDir) {
  // Bounded: a small package that expands to gigabytes would kill the process on a shared host.
  const data = zlib.gunzipSync(buffer, { maxOutputLength: MAX_UNPACKED_BYTES });
  if (data.subarray(0, MAGIC.length).toString('latin1') !== MAGIC) throw new Error('not a release package');
  let offset = MAGIC.length;
  let files = 0;
  const root = path.resolve(targetDir);
  while (offset < data.length) {
    if (offset + 4 > data.length) throw new Error('truncated package');
    const headerLength = data.readUInt32BE(offset);
    offset += 4;
    const header = JSON.parse(data.subarray(offset, offset + headerLength).toString('utf8'));
    offset += headerLength;
    const size = Number(header.s);
    if (!Number.isSafeInteger(size) || size < 0 || offset + size > data.length) throw new Error('truncated package');
    const rel = String(header.p);
    const target = path.resolve(root, ...rel.split('/'));
    if (!rel || rel.startsWith('/') || rel.split('/').includes('..') || !target.startsWith(root + path.sep)) {
      throw new Error(`unsafe path in package: ${rel}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data.subarray(offset, offset + size), { mode: Number(header.m) & 0o777 || 0o644 });
    offset += size;
    files += 1;
    if (files > MAX_FILES) throw new Error(`more than ${MAX_FILES} files in the package`);
  }
  return files;
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * The unpacked directory of release `id`, unpacking its uploaded package first if needed.
 * Several Passenger workers may start at once: one unpacks (it holds releases/<id>.lock),
 * the others wait for its .ready. A directory with .ready is never removed here.
 */
function prepare(id) {
  if (!ID.test(id)) throw new Error(`invalid release id « ${id} »`);
  const dir = path.join(RELEASES, id);
  const ready = () => fs.existsSync(path.join(dir, '.ready'));
  if (ready()) return dir;
  const pkg = path.join(ROOT, `release-${id}.twpkg`);
  const expected = readText(`release-${id}.sha256`).split(/\s+/u)[0];
  if (!fs.existsSync(pkg)) throw new Error(`release ${id}: neither unpacked nor uploaded`);
  if (!expected) throw new Error(`release ${id}: upload not finished (no checksum yet)`);

  fs.mkdirSync(RELEASES, { recursive: true });
  const lock = path.join(RELEASES, `${id}.lock`);
  for (let waited = 0; ; waited += 250) {
    try {
      fs.mkdirSync(lock);
      break; // ours
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (ready()) return dir; // another worker finished it
      const age = Date.now() - fs.statSync(lock).mtimeMs;
      if (age > 5 * 60_000) fs.rmSync(lock, { recursive: true, force: true }); // its owner died
      else if (waited > 120_000) throw new Error(`release ${id}: still being unpacked by another process`);
      else sleep(250);
    }
  }
  try {
    if (ready()) return dir;
    const buffer = fs.readFileSync(pkg);
    const actual = crypto.createHash('sha256').update(buffer).digest('hex');
    if (actual !== expected) throw new Error(`release ${id}: checksum mismatch, the upload is incomplete or damaged`);
    const partial = path.join(RELEASES, `${id}.partial-${process.pid}`);
    fs.rmSync(partial, { recursive: true, force: true });
    fs.mkdirSync(partial, { recursive: true });
    const started = Date.now();
    const files = unpack(buffer, partial);
    fs.writeFileSync(path.join(partial, '.ready'), `${actual}\n`);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true }); // an unfinished leftover (no .ready)
    fs.renameSync(partial, dir);
    fs.rmSync(pkg, { force: true });
    fs.rmSync(path.join(ROOT, `release-${id}.sha256`), { force: true });
    log(`release ${id}: unpacked ${files} files in ${Date.now() - started} ms`);
    return dir;
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

/** Remove old releases, keeping CURRENT, GOOD and the KEEP newest that started (a broken one never counts). */
function prune() {
  let entries = [];
  try {
    entries = fs.readdirSync(RELEASES, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return;
  }
  const keep = new Set([readText('CURRENT'), readText('GOOD')]);
  const ready = [];
  for (const entry of entries) {
    const dir = path.join(RELEASES, entry.name);
    if (entry.name.includes('.partial-')) {
      const pid = Number(entry.name.split('.partial-')[1]);
      if (pid !== process.pid) fs.rmSync(dir, { recursive: true, force: true });
      continue;
    }
    try {
      const at = fs.statSync(path.join(dir, '.ready')).mtimeMs;
      ready.push({ name: entry.name, at, started: fs.existsSync(path.join(dir, '.started')) });
    } catch {
      // not finished: left alone, prepare() replaces it
    }
  }
  ready.sort((a, b) => b.at - a.at);
  ready.filter((r) => r.started).slice(0, KEEP).forEach((r) => keep.add(r.name));
  for (const r of ready) {
    if (keep.has(r.name)) continue;
    fs.rmSync(path.join(RELEASES, r.name), { recursive: true, force: true });
    log(`release ${r.name}: removed (older than the ${KEEP} kept)`);
  }
}

/** Nothing could start: answer every request with a short maintenance page (503). */
function maintenance(reason) {
  const http = require('node:http');
  log(`maintenance page: ${reason}`);
  const body = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>عالم الثوب</title>'
    + '<body style="font-family:system-ui;text-align:center;padding:4rem 1rem;color:#3b2f1e;background:#fbf8f2">'
    + '<h1 style="color:#b08d3c">عالم الثوب · Thobe World</h1><p>الموقع قيد الصيانة، نعود بعد لحظات.</p><p>Site en maintenance, revenez dans un instant.</p>';
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/health')) {
      res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: false, release: null, error: 'maintenance' })); // the reason stays in logs/bootstrap.log
      return;
    }
    res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'retry-after': '30', 'cache-control': 'no-store' });
    res.end(body);
  });
  const port = process.env.PORT && /^\d+$/u.test(process.env.PORT) ? Number(process.env.PORT) : process.env.PORT || 8080;
  server.listen(port);
  watchForSwitch('');
}

/** Exit when CURRENT is rewritten, so Passenger starts the new release on the next request. */
function watchForSwitch(running) {
  const baseline = readText('CURRENT');
  const file = path.join(ROOT, 'CURRENT');
  const watcher = fs.watchFile(file, { interval: 2000 }, () => {
    const wanted = readText('CURRENT');
    if (wanted && wanted !== baseline) {
      log(`CURRENT is now ${wanted} (running ${running || 'nothing'}): restarting`);
      setTimeout(() => process.exit(0), 250);
    }
  });
  watcher.unref?.();
}

async function start() {
  loadSharedEnv();
  if (!process.env.DATA_DIR) process.env.DATA_DIR = path.join(ROOT, 'data');
  for (const dir of [RELEASES, path.join(ROOT, 'tmp'), process.env.DATA_DIR]) fs.mkdirSync(dir, { recursive: true });

  const current = readText('CURRENT');
  const good = readText('GOOD');
  const candidates = [...new Set([current, good].filter(Boolean))];
  if (current === 'none') return maintenance('no release to run (the deploy tool set CURRENT to « none »)');
  if (!candidates.length) return maintenance('no release deployed yet (CURRENT is empty)');

  const failures = [];
  for (const id of candidates) {
    try {
      const dir = prepare(id);
      process.env.TW_RELEASE = id;
      process.env.TW_RELEASE_FALLBACK = id === current ? '' : '1';
      process.chdir(dir);
      await import(pathToFileURL(path.join(dir, 'src', 'server.js')).href);
      log(`release ${id}: started${id === current ? '' : ` (fallback: ${current} failed)`}`);
      fs.writeFileSync(path.join(dir, '.started'), `${new Date().toISOString()}\n`);
      watchForSwitch(id);
      setTimeout(() => {
        try {
          prune();
        } catch (error) {
          log(`prune: ${error.message}`);
        }
      }, 5000).unref();
      return undefined;
    } catch (error) {
      failures.push(`${id}: ${error.message}`);
      log(`release ${id}: could not start: ${error.stack ?? error.message}`);
    }
  }
  return maintenance(failures.join(' | '));
}

module.exports = { unpack, prepare, prune, MAGIC };

if (process.env.TW_BOOTSTRAP_LIBRARY !== '1') {
  start().catch((error) => {
    log(`bootstrap: ${error.stack ?? error.message}`);
    maintenance(error.message);
  });
}
