/**
 * Everything the owner may change without touching code. Read from the
 * environment (cPanel « Setup Node.js App » → Environment variables, or a
 * `.env` file next to package.json).
 *
 * The catalogue, prices, photos, stock, delivery prices and order statuses are
 * NOT here: they come from H47 Pay (NewStore). This file is only the shop's
 * identity, its contacts and its tracking pixels.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Minimal `.env` reader: KEY=value lines, # comments. Real environment variables win. */
function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/u)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/u.exec(line);
    if (!match || line.trim().startsWith('#')) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^(['"])(.*)\1$/u, '$2');
  }
}

export function loadConfig(overrides = {}) {
  loadDotEnv(resolve(process.cwd(), '.env'));
  const env = { ...process.env, ...overrides };
  const config = {
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    /** The site's public address, used for canonical links, sitemap and share cards. */
    siteUrl: (env.SITE_URL ?? 'http://localhost:8080').replace(/\/+$/u, ''),
    /** Where the NewStore projection (store.json + photos) and the image cache live. */
    dataDir: resolve(env.DATA_DIR ?? './data'),
    /** The key typed in H47 Pay « Mon site web ». Empty: the sync endpoint answers « non configuré ». */
    syncKey: env.NEWSTORE_SYNC_KEY ?? '',
    /** Signs the « merci » links so an order summary is only shown to the person who placed it. */
    secret: env.APP_SECRET ?? env.NEWSTORE_SYNC_KEY ?? 'dev-secret-change-me',
    shop: {
      nameAr: env.SHOP_NAME_AR ?? 'عالم الثوب',
      nameFr: env.SHOP_NAME_FR ?? 'Thobe World',
      sloganAr: env.SHOP_SLOGAN_AR ?? 'تأنق كأنك ملك',
      sloganFr: env.SHOP_SLOGAN_FR ?? 'Élégant comme un roi',
      taglineAr: env.SHOP_TAGLINE_AR ?? 'دع كل قطعة من ملابسنا تنطق بالفخامة، واجعل حضورك لا يُنسى في كل مناسبة',
      taglineFr: env.SHOP_TAGLINE_FR ?? 'Que chaque pièce parle de raffinement, et que votre présence ne s’oublie pas.',
      phone: env.SHOP_PHONE ?? '+213659118569',
      phoneDisplay: env.SHOP_PHONE_DISPLAY ?? '0659 11 85 69',
      whatsapp: env.SHOP_WHATSAPP ?? '213659118569',
      instagram: env.SHOP_INSTAGRAM ?? 'thobe_world_',
      facebook: env.SHOP_FACEBOOK ?? '',
      facebookName: env.SHOP_FACEBOOK_NAME ?? 'عالم الثوب',
      addressAr: env.SHOP_ADDRESS_AR ?? 'حي العربي بن مهيدي، أمام السونلغاز القديمة',
      addressFr: env.SHOP_ADDRESS_FR ?? 'Cité Larbi Ben M’hidi, en face de l’ancienne Sonelgaz',
      /** Law 18-05: the seller's commercial register number and tax id, shown in the footer. */
      rc: env.SHOP_RC ?? '',
      nif: env.SHOP_NIF ?? '',
    },
    pixels: {
      meta: env.META_PIXEL_ID ?? '',
      tiktok: env.TIKTOK_PIXEL_ID ?? '',
      ga: env.GA_MEASUREMENT_ID ?? '',
    },
    /** Anti-fake-order limits. */
    orders: {
      perIpWindowMin: Number(env.ORDER_IP_WINDOW_MIN ?? 10),
      perIpMax: Number(env.ORDER_IP_MAX ?? 6),
      duplicateWindowMin: Number(env.ORDER_DUPLICATE_WINDOW_MIN ?? 30),
    },
    trustProxy: env.TRUST_PROXY ?? 'loopback',
  };
  return config;
}
