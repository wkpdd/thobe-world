// The real store, packed exactly as `npm run deploy` packs it (production
// node_modules for linux-x64), started by the switcher from a clean application
// root: what the cPanel host will run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildRelease } from '../../deploy/build.js';
import { deploy } from '../../deploy/ops.js';
import { localTransport } from '../../deploy/transports.js';
import { freePort, passenger, settingsFor, tempDir } from './helpers.js';

test('the real store deploys, starts from releases/<id> and keeps its data outside', { timeout: 240_000 }, async () => {
  const id = '20261126-180000-realshop';
  const built = buildRelease({ id, commit: 'realshop' });
  assert.ok(built.buffer.length < 40_000_000, `package is ${(built.buffer.length / 1e6).toFixed(1)} MB`);

  const root = tempDir('real-root');
  const port = await freePort();
  const site = `http://127.0.0.1:${port}`;
  const host = passenger(root, port, { SITE_URL: site, NEWSTORE_SYNC_KEY: 'k'.repeat(40), APP_SECRET: 's'.repeat(40) });
  try {
    const result = await deploy({ transport: localTransport({ dir: root }), settings: settingsFor(site, { healthTimeoutMs: 60_000 }), release: { id, commit: 'realshop', ...built }, log: () => {} });
    assert.equal(result.ok, true, `${result.reason}\n${host.output.join('')}`);
    const health = await (await fetch(`${site}/health`)).json();
    assert.equal(health.release, id);
    assert.equal(health.images, 'webp', 'sharp loads from the shipped linux-x64 binaries');
    assert.equal(health.syncKey, true);
    const home = await fetch(`${site}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /عالم الثوب/u);
    const css = await fetch(`${site}/css/site.css`);
    assert.equal(css.status, 200, 'public files are served from the release');
    assert.ok(existsSync(join(root, 'data', 'uploads')), 'photos go to the shared data folder');
    assert.equal(existsSync(join(root, 'releases', id, 'data')), false, 'nothing is stored inside the release');
    assert.equal(existsSync(join(root, 'releases', id, 'node_modules', '@playwright')), false, 'dev dependencies are not shipped');
    assert.equal(existsSync(join(root, 'releases', id, 'test')), false, 'tests are not shipped');
  } finally {
    await host.stop();
  }
});
