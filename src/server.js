import { loadConfig } from './config.js';
import { createApp } from './app.js';

const config = loadConfig();
if (config.syncKey && config.syncKey.length < 24) {
  console.warn('NEWSTORE_SYNC_KEY est courte (moins de 24 caractères) : choisissez une clé longue et aléatoire.');
}
if (!config.syncKey) {
  console.warn('NEWSTORE_SYNC_KEY est vide : /api/sync.php répondra « non configuré » tant qu’aucune clé n’est définie.');
}
const { app } = createApp(config);
// cPanel / Passenger may pass a socket path in PORT instead of a number.
const socket = process.env.PORT && !/^\d+$/u.test(process.env.PORT) ? process.env.PORT : null;
const ready = () => console.log(`Thobe World — ${config.siteUrl} (${socket ?? `port ${server.address()?.port}`})`);
const server = socket ? app.listen(socket, ready) : app.listen(config.port, config.host, ready);
const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
