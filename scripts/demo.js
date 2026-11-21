/**
 * Local preview: starts the store on a throw-away data folder and plays H47 Pay
 * once, with H47 Pay's own website client, to fill it with the demo catalogue.
 *
 *   npm run demo            → http://localhost:8080
 *   PORT=3000 npm run demo
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { SiteClient } from '../test/newstore/site.ts';
import { pushDemo } from './fixtures.js';

const port = Number(process.env.PORT ?? 8080);
const key = process.env.NEWSTORE_SYNC_KEY || 'demo-cle-de-synchronisation-0123456789';
const dataDir = process.env.DATA_DIR || mkdtempSync(join(tmpdir(), 'thobe-demo-'));
const config = loadConfig({ PORT: String(port), NEWSTORE_SYNC_KEY: key, DATA_DIR: dataDir, SITE_URL: process.env.SITE_URL ?? `http://localhost:${port}` });
const { app, images } = createApp(config);
const server = app.listen(port, '0.0.0.0', async () => {
  console.log(`Store on http://localhost:${port} (data: ${dataDir})`);
  const client = new SiteClient({ siteUrl: `http://127.0.0.1:${port}`, apiKey: key, requestTimeoutMs: 60_000 });
  await pushDemo(client, { log: (m) => console.log(`H47 Pay → site: ${m}`) });
  await images.idle();
  console.log('Demo catalogue pushed. Ready.');
});
process.on('SIGINT', () => server.close(() => process.exit(0)));
