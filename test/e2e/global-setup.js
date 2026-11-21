/**
 * Starts the store on a fresh data folder and plays H47 Pay once: catalogue,
 * photos and delivery list, through NewStore's own website client.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../src/config.js';
import { createApp } from '../../src/app.js';
import { SiteClient } from '../newstore/site.ts';
import { pushDemo } from '../../scripts/fixtures.js';

export const PORT = 8099;
export const KEY = 'e2e-cle-de-synchronisation-0123456789abcdef';

export default async function globalSetup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'thobe-e2e-'));
  const config = loadConfig({ PORT: String(PORT), NEWSTORE_SYNC_KEY: KEY, DATA_DIR: dataDir, SITE_URL: `http://127.0.0.1:${PORT}`, APP_SECRET: 'e2e-secret' });
  const { app, images } = createApp(config);
  const server = await new Promise((resolve) => {
    const s = app.listen(PORT, '127.0.0.1', () => resolve(s));
  });
  const client = new SiteClient({ siteUrl: `http://127.0.0.1:${PORT}`, apiKey: KEY, requestTimeoutMs: 60_000 });
  await pushDemo(client);
  await images.idle();
  process.env.E2E_SYNC_KEY = KEY;
  process.env.E2E_DATA_DIR = dataDir;
  return async () => {
    await new Promise((resolve) => server.close(resolve));
  };
}
