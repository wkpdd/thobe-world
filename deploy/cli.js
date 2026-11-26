#!/usr/bin/env node
/**
 *   npm run deploy                 build, upload, switch, verify (auto rollback on failure)
 *   npm run deploy:rollback [id]   back to the previous release (or to <id>)
 *   npm run deploy:status          what runs, what you can roll back to
 *   npm run deploy:check           test the connection without changing the site
 *
 * Flags: --force (ignore a stale lock), --allow-dirty (deploy uncommitted changes).
 * Settings: environment variables or .deploy.env (see .deploy.env.example and docs/DEPLOY.md).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Node's fetch only uses HTTPS_PROXY when asked to (needed in a Claude cloud session).
if (process.env.HTTPS_PROXY && !process.env.NODE_USE_ENV_PROXY) {
  const child = spawnSync(process.execPath, ['--disable-warning=UNDICI-EHPA', fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  });
  process.exit(child.status ?? 1);
}

const { openTransport } = await import('./transports.js');
const ops = await import('./ops.js');

const [command = 'status', ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const args = rest.filter((a) => !a.startsWith('--'));
const settings = ops.loadSettings();

let transport;
try {
  transport = await openTransport(settings);
  let result;
  if (command === 'deploy') result = await ops.deploy({ transport, settings, force: flags.has('--force'), allowDirty: flags.has('--allow-dirty') });
  else if (command === 'rollback') result = await ops.rollback({ transport, settings, to: args[0] ?? null, force: flags.has('--force') });
  else if (command === 'status') result = { ok: true, ...(await ops.status({ transport, settings })) };
  else if (command === 'check') result = await ops.check({ transport, settings });
  else throw new Error(`unknown command « ${command} »: deploy, rollback, status or check`);
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  console.error(`✘ ${error.message}`);
  process.exitCode = 1;
} finally {
  await transport?.close().catch(() => {});
}
