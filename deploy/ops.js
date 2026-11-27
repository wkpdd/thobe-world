/**
 * Deploy, roll back, status and check. A deploy is:
 *
 *   1. lock (DEPLOY_LOCK), so two deploys never cross
 *   2. upload app.cjs (the switcher), release-<id>.twpkg, then its checksum
 *   3. CURRENT = <id>  → the running process restarts itself on the new release
 *   4. wait for /health to answer release = <id>, then check the home page and
 *      that /api/sync.php is answered by Node (not by PHP or a 404 page)
 *   5. good → GOOD = <id>.  Bad → CURRENT = the previous release, and wait for
 *      it to answer again. Every step is written to deploys.json.
 *
 * Rolling back is steps 3–5 with an older release that is still on the host.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { buildRelease, gitState, REPO, releaseId, savePackage } from './build.js';

export const BOOTSTRAP = join(REPO, 'deploy', 'bootstrap.cjs');
const LOCK_MINUTES = 15;
const LOCK_SETTLE_MS = 1500;
const HISTORY_MAX = 60;

/** Settings from the environment, then `.deploy.env` at the repository root (never committed). */
export function loadSettings(env = process.env, file = join(REPO, '.deploy.env')) {
  const fromFile = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/u)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/u.exec(line);
      if (match && !line.trim().startsWith('#')) fromFile[match[1]] = match[2].replace(/^(['"])(.*)\1$/u, '$2');
    }
  }
  const get = (key, fallback) => env[key] ?? fromFile[key] ?? fallback;
  const appDir = get('APP_DIR', 'thobe-world').replace(/^~\/?/u, '').replace(/\/+$/u, '');
  return {
    method: get('DEPLOY_METHOD', 'cpanel'),
    siteUrl: (get('SITE_URL', '') ?? '').replace(/\/+$/u, ''),
    healthTimeoutMs: Number(get('HEALTH_TIMEOUT_S', 180)) * 1000,
    by: get('DEPLOY_BY', hostname()),
    cpanel: {
      url: get('CPANEL_URL'),
      user: get('CPANEL_USER'),
      token: get('CPANEL_TOKEN'),
      password: get('CPANEL_PASSWORD'),
      auth: get('CPANEL_AUTH'),
      appDir,
    },
    ftp: {
      host: get('FTP_HOST'),
      port: get('FTP_PORT', '21'),
      user: get('FTP_USER'),
      password: get('FTP_PASSWORD'),
      secure: get('FTP_SECURE', 'true') !== 'false',
      tlsServername: get('FTP_TLS_SERVERNAME'),
      appDir: get('FTP_APP_DIR', appDir),
    },
    local: { dir: get('LOCAL_DIR') },
  };
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function readJson(transport, rel, fallback) {
  const text = await transport.read(rel);
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export async function readState(transport) {
  const [current, good, history, lock] = await Promise.all([
    transport.read('CURRENT'),
    transport.read('GOOD'),
    readJson(transport, 'deploys.json', []),
    readJson(transport, 'DEPLOY_LOCK', null),
  ]);
  return { current: (current ?? '').trim(), good: (good ?? '').trim(), history: Array.isArray(history) ? history : [], lock };
}

async function record(transport, entry) {
  const history = await readJson(transport, 'deploys.json', []);
  const list = Array.isArray(history) ? history : [];
  list.push({ ...entry, at: new Date().toISOString() });
  await transport.write('deploys.json', `${JSON.stringify(list.slice(-HISTORY_MAX), null, 2)}\n`);
}

/**
 * FTP and cPanel cannot create a file « only if absent », so the lock is: check it is free,
 * write ours with a random token, wait a moment, read it back. Whoever's token is there owns it.
 * Unlock only clears a lock that is still ours.
 */
async function lock(transport, by, force, settleMs = LOCK_SETTLE_MS) {
  const free = (held) => !held?.at || Date.now() - Date.parse(held.at) >= LOCK_MINUTES * 60_000;
  const held = await readJson(transport, 'DEPLOY_LOCK', null);
  if (!free(held) && !force) {
    throw new Error(`another deploy is running (started ${held.at} by ${held.by}). Wait, or pass --force if it crashed.`);
  }
  const token = randomUUID();
  await transport.write('DEPLOY_LOCK', JSON.stringify({ at: new Date().toISOString(), by, token }));
  await sleep(settleMs);
  const now = await readJson(transport, 'DEPLOY_LOCK', null);
  if (now?.token !== token) throw new Error(`another deploy took the lock at the same moment (${now?.by ?? '?'}). Try again in a minute.`);
  return token;
}
async function unlock(transport, token) {
  const held = await readJson(transport, 'DEPLOY_LOCK', null);
  if (held?.token === token) await transport.write('DEPLOY_LOCK', '');
}

/** Restart hint for Passenger. The switcher also restarts on its own when CURRENT changes. */
async function touchRestart(transport) {
  try {
    await transport.write('tmp/restart.txt', `${new Date().toISOString()}\n`);
  } catch {
    // tmp/ appears after the first start; the CURRENT watcher covers it
  }
}

/** What /health says right now; null when it does not answer JSON. */
export async function probe(siteUrl, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`${siteUrl}/health?ts=${Date.now()}`, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(20_000) });
    const json = await response.json();
    return { status: response.status, ...json };
  } catch (error) {
    return { status: 0, ok: false, error: error.cause?.code ?? error.message };
  }
}

/** Wait until the site runs `id` (null: until it answers at all). */
export async function waitForRelease(siteUrl, id, { timeoutMs, fetchImpl = fetch, log = () => {}, intervalMs = 3000 }) {
  const until = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < until) {
    last = await probe(siteUrl, fetchImpl);
    if (last.ok && (id === null || (last.release === id && !last.fallback))) return { ok: true, health: last };
    if (last.release && last.release !== id && last.fallback) {
      return { ok: false, health: last, reason: `the server could not start ${id} and fell back to ${last.release}` };
    }
    await sleep(intervalMs);
  }
  log(`  /health last said: ${JSON.stringify(last)}`);
  return { ok: false, health: last, reason: `no healthy answer with release ${id} within ${Math.round(timeoutMs / 1000)} s` };
}

/** After /health: the shop front renders and the H47 Pay endpoint reaches Node. */
export async function smoke(siteUrl, fetchImpl = fetch) {
  const problems = [];
  try {
    const home = await fetchImpl(`${siteUrl}/`, { signal: AbortSignal.timeout(20_000) });
    const html = await home.text();
    if (home.status !== 200 || !html.includes('<html')) problems.push(`home page answered HTTP ${home.status}`);
  } catch (error) {
    problems.push(`home page: ${error.message}`);
  }
  try {
    const sync = await fetchImpl(`${siteUrl}/api/sync.php`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(20_000) });
    const type = sync.headers.get('content-type') ?? '';
    if (!type.includes('json')) problems.push(`/api/sync.php is not answered by the store (HTTP ${sync.status}, ${type || 'no content-type'}): H47 Pay could not sync`);
  } catch (error) {
    problems.push(`/api/sync.php: ${error.message}`);
  }
  return problems;
}

async function bootstrapTail(transport) {
  try {
    const text = await transport.read('logs/bootstrap.log');
    return (text ?? '').trim().split('\n').slice(-12).join('\n');
  } catch {
    return '';
  }
}

/** Point CURRENT at `id` and wait for it. Returns {ok, reason}. */
async function switchTo(transport, settings, id, { fetchImpl, log }) {
  await transport.write('CURRENT', `${id}\n`);
  await touchRestart(transport);
  log(`CURRENT = ${id}; waiting for ${settings.siteUrl}/health …`);
  const live = await waitForRelease(settings.siteUrl, id, { timeoutMs: settings.healthTimeoutMs, intervalMs: settings.healthIntervalMs ?? 3000, fetchImpl, log });
  if (!live.ok) return live;
  const problems = await smoke(settings.siteUrl, fetchImpl);
  if (problems.length) return { ok: false, reason: problems.join('; '), health: live.health };
  return live;
}

/**
 * Build (unless `release` is given), upload and switch. On failure, switch
 * back to what ran before and return {ok:false}.
 */
export async function deploy({ transport, settings, release, force = false, allowDirty = false, fetchImpl = fetch, log = console.log }) {
  if (!settings.siteUrl) throw new Error('SITE_URL is missing (e.g. https://www.example.dz)');
  let pkg = release;
  if (!pkg) {
    const git = gitState();
    if (git.dirty && !allowDirty) throw new Error('src/, public/ or package files have uncommitted changes: commit them first (or pass --allow-dirty)');
    const id = releaseId(git.commit, git.dirty);
    log(`Building release ${id} (${git.branch}@${git.commit})`);
    const built = buildRelease({ id, commit: git.commit, log: (m) => log(`  ${m}`) });
    pkg = { id, commit: git.commit, ...built };
  }
  const saved = pkg.file ? { file: pkg.file, cleanup: () => {} } : savePackage(pkg.buffer, pkg.id);

  const state = await readState(transport);
  const token = await lock(transport, settings.by, force, settings.lockSettleMs);
  const previous = state.good && state.good !== 'none' ? state.good : state.current !== 'none' ? state.current : '';
  try {
    log(`Uploading to ${transport.describe}`);
    // The startup file is replaced only when it changed: a worker starting during that write would read half of it.
    if ((await transport.read('app.cjs')) !== readFileSync(BOOTSTRAP, 'utf8')) await transport.upload('app.cjs', BOOTSTRAP);
    const started = Date.now();
    await transport.upload(`release-${pkg.id}.twpkg`, saved.file);
    await transport.write(`release-${pkg.id}.sha256`, `${pkg.sha256}\n`);
    log(`  release-${pkg.id}.twpkg uploaded in ${((Date.now() - started) / 1000).toFixed(1)} s`);

    const result = await switchTo(transport, settings, pkg.id, { fetchImpl, log });
    if (result.ok) {
      await transport.write('GOOD', `${pkg.id}\n`);
      await record(transport, { action: 'deploy', id: pkg.id, commit: pkg.commit, result: 'live', by: settings.by, previous: previous || null });
      log(`✔ ${pkg.id} is live on ${settings.siteUrl}`);
      return { ok: true, id: pkg.id, previous };
    }

    log(`✘ ${pkg.id} failed: ${result.reason}`);
    const tail = await bootstrapTail(transport);
    if (tail) log(`  server log (logs/bootstrap.log):\n${tail.replace(/^/gmu, '    ')}`);
    let restored = null;
    if (previous) {
      log(`Rolling back to ${previous} …`);
      const back = await switchTo(transport, settings, previous, { fetchImpl, log });
      restored = back.ok;
      log(back.ok ? `✔ ${previous} is live again` : `✘ ${previous} did not come back either: ${back.reason}`);
    } else {
      await transport.write('CURRENT', 'none\n'); // the switcher shows its maintenance page
      log('Nothing was live before: the site shows its maintenance page.');
    }
    await record(transport, { action: 'deploy', id: pkg.id, commit: pkg.commit, result: 'failed', reason: result.reason, by: settings.by, previous: previous || null, restored });
    return { ok: false, id: pkg.id, previous, reason: result.reason, restored };
  } finally {
    saved.cleanup();
    await unlock(transport, token).catch(() => {});
  }
}

/** Releases that were live at some point, newest first, without repeats. */
export function liveReleases(history) {
  const seen = new Set();
  const out = [];
  for (const entry of [...history].reverse()) {
    if (entry.result !== 'live' || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}

/** Switch back to `to`, or to the release that was live before the current one. */
export async function rollback({ transport, settings, to = null, force = false, fetchImpl = fetch, log = console.log }) {
  if (!settings.siteUrl) throw new Error('SITE_URL is missing');
  const state = await readState(transport);
  const target = to ?? liveReleases(state.history).find((e) => e.id !== state.current)?.id;
  if (!target) throw new Error('no earlier release to roll back to (see npm run deploy:status)');
  if (target === state.current) throw new Error(`${target} is already the live release`);
  const token = await lock(transport, settings.by, force, settings.lockSettleMs);
  try {
    log(`Rolling back ${state.current || '(nothing)'} → ${target}`);
    const result = await switchTo(transport, settings, target, { fetchImpl, log });
    if (result.ok) {
      await transport.write('GOOD', `${target}\n`);
      await record(transport, { action: 'rollback', id: target, result: 'live', from: state.current || null, by: settings.by });
      log(`✔ ${target} is live on ${settings.siteUrl}`);
      return { ok: true, id: target };
    }
    log(`✘ ${target} did not start: ${result.reason}`);
    const tail = await bootstrapTail(transport);
    if (tail) log(`  server log:\n${tail.replace(/^/gmu, '    ')}`);
    if (state.current) {
      log(`Putting ${state.current} back …`);
      const back = await switchTo(transport, settings, state.current, { fetchImpl, log });
      log(back.ok ? `✔ ${state.current} is live again` : `✘ ${state.current} did not come back: ${back.reason}`);
    }
    await record(transport, { action: 'rollback', id: target, result: 'failed', reason: result.reason, from: state.current || null, by: settings.by });
    return { ok: false, id: target, reason: result.reason };
  } finally {
    await unlock(transport, token).catch(() => {});
  }
}

export async function status({ transport, settings, fetchImpl = fetch, log = console.log }) {
  const state = await readState(transport);
  const health = settings.siteUrl ? await probe(settings.siteUrl, fetchImpl) : null;
  log(`Host:     ${transport.describe}`);
  log(`Site:     ${settings.siteUrl || '(SITE_URL not set)'}`);
  log(`CURRENT:  ${state.current || '(none)'}`);
  log(`GOOD:     ${state.good || '(none)'}`);
  if (health) log(`Live:     ${health.ok ? `release ${health.release ?? '?'}, photos ${health.images ?? '?'}${health.fallback ? ' (FALLBACK)' : ''}` : `not healthy (${health.error ?? `HTTP ${health.status}`})`}`);
  if (state.lock?.at) log(`Lock:     held since ${state.lock.at} by ${state.lock.by}`);
  const live = liveReleases(state.history);
  log('Releases you can roll back to (newest first; the host keeps the last 5):');
  for (const entry of live.slice(0, 8)) log(`  ${entry.id === state.current ? '→' : ' '} ${entry.id}  ${entry.action} ${entry.at}${entry.by ? ` by ${entry.by}` : ''}`);
  const failed = state.history.filter((e) => e.result === 'failed').slice(-3);
  for (const entry of failed) log(`  ✘ ${entry.id} failed ${entry.at}: ${entry.reason}`);
  return { state, health };
}

/** Everything a first deploy needs, without changing the live site. */
export async function check({ transport, settings, fetchImpl = fetch, log = console.log }) {
  const problems = [];
  log(`Host: ${transport.describe}`);
  try {
    const probeText = `deploy check ${new Date().toISOString()}`;
    await transport.write('.deploy-check', probeText);
    const back = await transport.read('.deploy-check');
    if (back?.trim() !== probeText) problems.push('wrote a test file in the application root but read back something else');
    else log('✔ can write and read files in the application root');
  } catch (error) {
    problems.push(`files: ${error.message}`);
  }
  if (!settings.siteUrl) problems.push('SITE_URL is missing');
  else {
    const health = await probe(settings.siteUrl, fetchImpl);
    if (health.ok) log(`✔ ${settings.siteUrl}/health answers: release ${health.release ?? '(not deployed with this tool yet)'}`);
    else if (health.status === 503) log(`✔ ${settings.siteUrl} reaches the switcher (no release yet: ${health.error ?? 'maintenance'})`);
    else log(`• ${settings.siteUrl}/health does not answer yet (${health.error ?? `HTTP ${health.status}`}) — normal before the first deploy if the Node.js app is not created`);
  }
  for (const problem of problems) log(`✘ ${problem}`);
  return { ok: problems.length === 0, problems };
}
