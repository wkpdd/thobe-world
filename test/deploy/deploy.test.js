// Deploy, automatic rollback, manual rollback and pruning, against the real
// switcher (deploy/bootstrap.cjs) run the way Passenger runs it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { pack } from '../../deploy/build.js';
import { deploy, rollback, readState, status, check } from '../../deploy/ops.js';
import { cpanelTransport, ftpTransport, localTransport } from '../../deploy/transports.js';
import { spawn, spawnSync } from 'node:child_process';
import { fakeCpanel, fakeRelease, freePort, passenger, settingsFor, tempDir } from './helpers.js';

process.env.TW_BOOTSTRAP_LIBRARY = '1';
const bootstrap = createRequire(import.meta.url)('../../deploy/bootstrap.cjs');
const quiet = () => {};

test('a package unpacks to the same files, modes and names (Arabic included)', () => {
  const src = tempDir('pack-src');
  mkdirSync(join(src, 'a', 'b'), { recursive: true });
  writeFileSync(join(src, 'a', 'b', 'deep.js'), 'x'.repeat(70_000));
  writeFileSync(join(src, 'empty.txt'), '');
  writeFileSync(join(src, 'قميص.txt'), 'عالم الثوب');
  writeFileSync(join(src, 'run.sh'), '#!/bin/sh\n', { mode: 0o755 });
  const { buffer } = pack(src);
  const out = tempDir('pack-out');
  assert.equal(bootstrap.unpack(buffer, out), 4);
  assert.equal(readFileSync(join(out, 'a', 'b', 'deep.js'), 'utf8').length, 70_000);
  assert.equal(readFileSync(join(out, 'قميص.txt'), 'utf8'), 'عالم الثوب');
  assert.equal(readFileSync(join(out, 'empty.txt'), 'utf8'), '');
});

test('a package cannot write outside its release folder', () => {
  const header = Buffer.from(JSON.stringify({ p: '../escape.txt', m: 0o644, s: 2 }));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  const evil = gzipSync(Buffer.concat([Buffer.from(bootstrap.MAGIC, 'latin1'), length, header, Buffer.from('hi')]));
  const out = tempDir('evil');
  assert.throws(() => bootstrap.unpack(evil, join(out, 'release')), /unsafe path/u);
  assert.equal(existsSync(join(out, 'escape.txt')), false);
});

test('deploy → live; broken deploy → automatic rollback; manual rollback; history and pruning', async () => {
  const root = tempDir('app-root');
  const port = await freePort();
  const site = `http://127.0.0.1:${port}`;
  const host = passenger(root, port);
  const transport = localTransport({ dir: root });
  const settings = settingsFor(site);
  try {
    // 1. First deploy: nothing was live.
    const a = fakeRelease({ id: '20261126-100000-aaaaaaaa' });
    const first = await deploy({ transport, settings, release: a, log: quiet });
    assert.equal(first.ok, true);
    let health = await (await fetch(`${site}/health`)).json();
    assert.equal(health.release, a.id);
    assert.equal(health.dataDir, join(root, 'data'), 'H47 Pay data lives outside the releases');
    assert.equal(health.cwd, join(root, 'releases', a.id));
    assert.equal(existsSync(join(root, `release-${a.id}.twpkg`)), false, 'the uploaded package is removed once unpacked');

    // 2. A second good deploy.
    const b = fakeRelease({ id: '20261126-110000-bbbbbbbb' });
    assert.equal((await deploy({ transport, settings, release: b, log: quiet })).ok, true);
    assert.equal((await (await fetch(`${site}/health`)).json()).release, b.id);

    // 3. A broken release: the switcher falls back at once, the tool puts B back.
    const c = fakeRelease({ id: '20261126-120000-cccccccc', broken: true });
    const lines = [];
    const failed = await deploy({ transport, settings, release: c, log: (m) => lines.push(m) });
    assert.equal(failed.ok, false);
    assert.equal(failed.restored, true);
    assert.match(failed.reason, /fell back to 20261126-110000-bbbbbbbb/u);
    assert.match(lines.join('\n'), /boom: this release is broken/u, 'the server log is shown');
    health = await (await fetch(`${site}/health`)).json();
    assert.equal(health.release, b.id);
    assert.equal(health.fallback, false, 'B runs normally again, not as a fallback');
    let state = await readState(transport);
    assert.equal(state.current, b.id);
    assert.equal(state.good, b.id);
    assert.deepEqual(state.history.map((e) => `${e.id.slice(-8)}:${e.result}`), ['aaaaaaaa:live', 'bbbbbbbb:live', 'cccccccc:failed']);

    // 4. Roll back by hand: to A (the release before B).
    const back = await rollback({ transport, settings, log: quiet });
    assert.equal(back.ok, true);
    assert.equal(back.id, a.id);
    assert.equal((await (await fetch(`${site}/health`)).json()).release, a.id);
    // and forward again to a named release
    assert.equal((await rollback({ transport, settings, to: b.id, log: quiet })).ok, true);
    assert.equal((await (await fetch(`${site}/health`)).json()).release, b.id);
    // rolling back to a release the host no longer has fails safely
    const missing = await rollback({ transport, settings, to: '20250101-000000-gone', log: quiet });
    assert.equal(missing.ok, false);
    assert.equal((await (await fetch(`${site}/health`)).json()).release, b.id, 'the live release stays');

    // 5. Status prints what can be rolled back to.
    const out = [];
    await status({ transport, settings, log: (m) => out.push(m) });
    assert.match(out.join('\n'), /→ 20261126-110000-bbbbbbbb/u);
    assert.match(out.join('\n'), /✘ 20261126-120000-cccccccc failed/u);

    // 6. Deploy four more: the host keeps the five newest (plus CURRENT and GOOD).
    for (const n of [1, 2, 3, 4]) {
      assert.equal((await deploy({ transport, settings, release: fakeRelease({ id: `20261126-13000${n}-dddddddd` }), log: quiet })).ok, true);
    }
    await new Promise((done) => setTimeout(done, 6000)); // pruning runs 5 s after a start
    const kept = readdirSync(join(root, 'releases')).sort();
    assert.equal(kept.length, 5, kept.join(', '));
    assert.equal(kept.includes(a.id), false, 'the oldest release was removed');
    assert.equal(kept.includes(c.id), false, 'the broken release was removed');
  } finally {
    await host.stop();
  }
});

test('a second deploy while one is running is refused', async () => {
  const root = tempDir('lock-root');
  const transport = localTransport({ dir: root });
  await transport.write('DEPLOY_LOCK', JSON.stringify({ at: new Date().toISOString(), by: 'someone' }));
  await assert.rejects(deploy({ transport, settings: settingsFor('http://127.0.0.1:9'), release: fakeRelease({ id: 'x-1' }), log: quiet }), /another deploy is running/u);
});

test('through cPanel UAPI: token auth, check, deploy and rollback', async () => {
  const home = tempDir('cpanel-home');
  const root = join(home, 'thobe-world');
  mkdirSync(root); // cPanel « Setup Node.js App » creates the application root
  const cpanel = await fakeCpanel(home);
  const port = await freePort();
  const site = `http://127.0.0.1:${port}`;
  const host = passenger(root, port);
  try {
    const wrong = cpanelTransport({ url: cpanel.url, user: cpanel.user, token: 'WRONG', appDir: 'thobe-world' });
    await assert.rejects(wrong.read('CURRENT'), /refused the login/u);

    const transport = cpanelTransport({ url: cpanel.url, user: cpanel.user, token: cpanel.token, appDir: 'thobe-world' });
    const settings = settingsFor(site);
    const checked = await check({ transport, settings, log: quiet });
    assert.equal(checked.ok, true, checked.problems.join('; '));

    const a = fakeRelease({ id: '20261126-140000-aaaa0001' });
    const b = fakeRelease({ id: '20261126-150000-bbbb0002' });
    assert.equal((await deploy({ transport, settings, release: a, log: quiet })).ok, true);
    assert.equal((await deploy({ transport, settings, release: b, log: quiet })).ok, true);
    assert.equal((await (await fetch(`${site}/health`)).json()).release, b.id);
    assert.ok(cpanel.calls.includes(`upload_files thobe-world/release-${b.id}.twpkg`));
    assert.ok(cpanel.calls.includes('save_file_content thobe-world/CURRENT'));

    assert.equal((await rollback({ transport, settings, log: quiet })).id, a.id);
    assert.equal((await (await fetch(`${site}/health`)).json()).release, a.id);
  } finally {
    await host.stop();
    await cpanel.close();
  }
});

// FTP needs an FTP server: pyftpdlib (pip install pyftpdlib). Set FTP_TEST_PYTHON to its python.
const python = process.env.FTP_TEST_PYTHON ?? 'python3';
const hasFtpServer = spawnSync(python, ['-c', 'import pyftpdlib'], { stdio: 'ignore' }).status === 0;

test('through FTP: deploy and rollback', { skip: hasFtpServer ? false : 'pyftpdlib not installed' }, async () => {
  const home = tempDir('ftp-home');
  const root = join(home, 'thobe-world');
  mkdirSync(root);
  const ftpPort = await freePort();
  const ftpd = spawn(python, ['-m', 'pyftpdlib', '-i', '127.0.0.1', '-p', String(ftpPort), '-w', '-d', home, '-u', 'shop', '-P', 'secret'], { stdio: 'ignore' });
  const port = await freePort();
  const site = `http://127.0.0.1:${port}`;
  const host = passenger(root, port);
  let transport;
  try {
    for (let i = 0; i < 50 && !transport; i += 1) {
      transport = await ftpTransport({ host: '127.0.0.1', port: ftpPort, user: 'shop', password: 'secret', secure: false, appDir: 'thobe-world' }).catch(() => null);
      if (!transport) await new Promise((done) => setTimeout(done, 200));
    }
    assert.ok(transport, 'FTP server answered');
    const settings = settingsFor(site);
    assert.equal(await transport.read('CURRENT'), null);
    const a = fakeRelease({ id: '20261126-160000-ftp00001' });
    const b = fakeRelease({ id: '20261126-170000-ftp00002' });
    assert.equal((await deploy({ transport, settings, release: a, log: quiet })).ok, true);
    assert.equal((await deploy({ transport, settings, release: b, log: quiet })).ok, true);
    assert.equal((await (await fetch(`${site}/health`)).json()).release, b.id);
    assert.equal((await rollback({ transport, settings, log: quiet })).id, a.id);
    assert.equal((await (await fetch(`${site}/health`)).json()).release, a.id);
  } finally {
    await transport?.close();
    await host.stop();
    ftpd.kill();
  }
});
