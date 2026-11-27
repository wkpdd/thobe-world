/**
 * The store. H47 Pay (NewStore) is the source of truth for EVERYTHING the shop
 * sells: it pushes the catalogue, photos, stock, delivery prices, order statuses
 * and parcels to `/api/sync.php`, and pulls the web orders from there. The site
 * keeps only that projection (data/store.json + data/uploads) and never writes
 * stock: `@h47io/sync-receiver` enforces the contract.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import { SyncReceiver, JsonFileSyncStorage, fixedKeyring, DELIVERY_CHECKOUT_JS } from '@h47io/sync-receiver';
import { createExpressHandler } from '@h47io/sync-receiver/express';
import { assetVersions } from './assets.js';
import { Catalogue, filterProducts, search, categoryName, productPath } from './catalogue.js';
import { ImageOptimizer, imagesEnabled, uploadName } from './images.js';
import { LANGS, t } from './i18n.js';
import { OrderDesk, validateOrder } from './orders.js';
import { homePage, listingPage, cartPage, checkoutPage, thanksPage, trackPage, staticPage, notFoundPage } from './views/pages.js';
import { productPage } from './views/product.js';
import { POLICIES } from './views/policies.js';
import { ContentStore } from './content.js';
import { launchRefusal, whenText } from './launches.js';
import { adminRouter } from './admin/routes.js';
import { launchPage } from './views/launch.js';
import { normalizePhone } from './orders.js';
import { clientIp, WindowCounter } from './client-ip.js';
import { SyncError } from '@h47io/sync-receiver';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PUBLIC = join(ROOT, 'public');
const YEAR = 31_536_000;

/** APP_SECRET when it is long enough, else a random secret created once in the data folder. */
function resolveSecret(config) {
  if (config.secret.length >= 32) return config.secret;
  if (config.secret) console.warn('APP_SECRET fait moins de 32 caractères : un secret aléatoire conservé dans DATA_DIR est utilisé à la place.');
  const file = join(config.dataDir, '.app-secret');
  if (existsSync(file)) {
    const kept = readFileSync(file, 'utf8').trim();
    if (kept.length >= 32) return kept;
  }
  mkdirSync(config.dataDir, { recursive: true });
  const fresh = randomBytes(32).toString('hex');
  writeFileSync(file, `${fresh}\n`, { mode: 0o600 });
  return fresh;
}

export function createApp(baseConfig) {
  const config = { ...baseConfig, secret: resolveSecret(baseConfig) };
  const storage = new JsonFileSyncStorage({ dir: config.dataDir, uploadsUrl: '/uploads/' });
  const catalogue = new Catalogue(storage);
  const images = new ImageOptimizer({ uploadsDir: storage.uploadsDir, cacheDir: join(config.dataDir, 'cache') });
  // What the shop manages on the website itself (/admin): carousel, launches, « prévenez-moi ».
  const content = new ContentStore({ dir: config.dataDir });
  const mediaImages = new ImageOptimizer({ uploadsDir: content.mediaDir, cacheDir: join(config.dataDir, 'cache', 'media') });

  // A new photo from H47 Pay → its WebP sizes are prepared right after the sync answers.
  const putBytes = storage.images.putBytes;
  storage.images.putBytes = (shop, file) => {
    const path = putBytes(shop, file);
    setImmediate(() => images.warm(uploadName(path)));
    return path;
  };

  const receiver = new SyncReceiver({
    exposeInternalDetail: false, // an unexpected error is logged here, never described to the caller
    onInternalError: (error) => console.error('sync:', error),
    keyring: fixedKeyring({ key: config.syncKey, site: new URL(config.siteUrl).host }),
    storage,
  });
  const desk = new OrderDesk({ storage, catalogue, secret: config.secret, limits: config.orders });
  const assets = assetVersions(PUBLIC, { 'delivery-checkout.js': DELIVERY_CHECKOUT_JS });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('etag', 'weak');

  // 1. The NewStore endpoint, BEFORE any body parser (the package reads the raw body).
  const sync = createExpressHandler(receiver);
  app.all('/api/sync.php', async (req, res, next) => {
    // The key is checked BEFORE the body is read: a caller without it costs nothing
    // (the package would otherwise read and parse up to 8 MB first).
    try {
      await receiver.authenticate({ headers: req.headers });
    } catch (error) {
      if (!(error instanceof SyncError)) return next(error);
      res.setHeader('Connection', 'close');
      return res.status(error.status).json(error.toBody());
    }
    // RFC 2046: a multipart boundary is at most 70 characters; longer ones only make parsing slow.
    const boundary = /boundary=(?:"([^"]*)"|([^;\s]*))/iu.exec(String(req.headers['content-type'] ?? ''));
    if (boundary && (boundary[1] ?? boundary[2] ?? '').length > 70) {
      res.setHeader('Connection', 'close');
      return res.status(400).json(new SyncError('VALIDATION', 'Limite multipart trop longue (70 caractères au plus).', 400).toBody());
    }
    res.on('finish', () => catalogue.invalidate());
    return sync(req, res, next);
  });

  app.use(compression({ threshold: 1024 }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    // A light policy that cannot break the pixels: no plugins, no <base> hijack, no framing, forms stay here.
    res.setHeader('Content-Security-Policy', "object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'");
    if (config.siteUrl.startsWith('https://')) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
  });

  // 2. Static files: versioned (?v=) and fonts for a year, the rest for a day.
  const staticOptions = (defaultAge) => ({
    index: false,
    setHeaders(res, path) {
      const versioned = res.req?.query?.v !== undefined || path.includes(`${join('public', 'data')}`);
      res.setHeader('Cache-Control', versioned ? `public, max-age=${YEAR}, immutable` : `public, max-age=${defaultAge}`);
    },
  });
  // fonts.css with every font URL versioned by content, so a changed font reaches returning visitors.
  const fontsCss = readFileSync(join(PUBLIC, 'fonts', 'fonts.css'), 'utf8').replace(/url\(\/(fonts\/[^)?]+\.woff2)\)/gu, (_m, file) => `url(${assets.url(file)})`);
  assets.register('fonts/fonts.css', fontsCss); // its version now changes whenever a font does
  app.get('/fonts/fonts.css', (req, res) => {
    res.type('text/css');
    res.setHeader('Cache-Control', req.query.v ? `public, max-age=${YEAR}, immutable` : 'public, max-age=3600');
    res.send(fontsCss);
  });
  app.use(express.static(PUBLIC, staticOptions(86_400)));
  app.get('/delivery-checkout.js', (req, res) => {
    res.type('application/javascript');
    res.setHeader('Cache-Control', req.query.v ? `public, max-age=${YEAR}, immutable` : 'public, max-age=3600');
    res.send(DELIVERY_CHECKOUT_JS);
  });
  // Originals (unique names per photo): a year.
  app.use('/uploads', express.static(storage.uploadsDir, { index: false, maxAge: YEAR * 1000, immutable: true }));
  // Optimised WebP sizes.
  app.get('/img/:width/:name', async (req, res, next) => {
    if (!imagesEnabled) return res.redirect(302, `/uploads/${encodeURIComponent(req.params.name)}`);
    try {
      const file = await images.get(Number(req.params.width), req.params.name);
      if (!file) return next();
      res.setHeader('Cache-Control', `public, max-age=${YEAR}, immutable`);
      res.type('image/webp');
      return res.sendFile(file);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/mimg/:width/:name', async (req, res, next) => {
    if (!imagesEnabled) {
      const original = content.mediaPath(req.params.name);
      return original ? res.sendFile(original) : next();
    }
    try {
      const file = await mediaImages.get(Number(req.params.width), req.params.name);
      if (!file) return next();
      res.setHeader('Cache-Control', `public, max-age=${YEAR}, immutable`);
      res.type('image/webp');
      return res.sendFile(file);
    } catch (error) {
      return next(error);
    }
  });

  // The website dashboard. Its own pages, its own login; never cached, never indexed.
  app.use('/admin', adminRouter({ config, content, catalogue, assets, images: mediaImages }));

  // 3. Language: ?lang=fr|ar sets a cookie; Arabic by default.
  app.use((req, res, next) => {
    const asked = typeof req.query.lang === 'string' && LANGS.includes(req.query.lang) ? req.query.lang : null;
    const cookie = /(?:^|;\s*)lang=(ar|fr)/u.exec(req.headers.cookie ?? '')?.[1];
    const lang = asked ?? cookie ?? 'ar';
    if (asked && asked !== cookie) res.setHeader('Set-Cookie', `lang=${asked}; Path=/; Max-Age=31536000; SameSite=Lax`);
    // The address without ?lang, kept as sent (no « /./ » folding into « //host ») and with one leading slash.
    const [rawPath, rawQuery = ''] = req.originalUrl.split('?');
    const query = new URLSearchParams(rawQuery);
    query.delete('lang');
    const url = { pathname: `/${rawPath.replace(/^[/\\]+/u, '')}`, search: query.size ? `?${query}` : '' };
    res.locals.ctx = { lang, config, assets, catalogue, content, pixels: content.pixels(config.pixels), path: `${url.pathname}${url.search}`, deliveryOptions: storage.shopData().deliveryOptions };
    res.setHeader('Vary', 'Cookie');
    next();
  });
  const page = (res, view, status = 200) => {
    res.status(status);
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(String(view));
  };

  // 4. Pages.
  app.get('/', (_req, res) => page(res, homePage(res.locals.ctx)));

  const listQuery = (req) => ({
    couleur: typeof req.query.couleur === 'string' ? req.query.couleur : '',
    taille: typeof req.query.taille === 'string' ? req.query.taille : '',
    tri: typeof req.query.tri === 'string' ? req.query.tri : '',
    stock: req.query.stock === '1' ? '1' : '',
  });
  const applyFilters = (list, q) => filterProducts(list, { color: q.couleur, size: q.taille, sort: q.tri, stock: q.stock });

  app.get('/boutique', (req, res) => {
    const { ctx } = res.locals;
    const s = t(ctx.lang);
    const q = listQuery(req);
    const all = catalogue.snapshot().products;
    page(res, listingPage(ctx, { title: s.shopAll, heading: s.shopAll, items: applyFilters(all, q), all, query: q, canonical: '/boutique', crumbsItems: [{ href: '/', label: s.home }, { label: s.shopAll }] }));
  });

  app.get('/c/:slug', (req, res, next) => {
    const { ctx } = res.locals;
    const s = t(ctx.lang);
    const cat = catalogue.snapshot().categories.find((c) => c.slug === req.params.slug);
    if (!cat) return next();
    const q = listQuery(req);
    const all = catalogue.snapshot().products.filter((p) => p.category === cat.slug);
    const label = categoryName(cat, ctx.lang);
    return page(res, listingPage(ctx, { title: label, heading: label, items: applyFilters(all, q), all, query: q, canonical: `/c/${cat.slug}`, crumbsItems: [{ href: '/', label: s.home }, { label }] }));
  });

  app.get('/recherche', (req, res) => {
    const { ctx } = res.locals;
    const s = t(ctx.lang);
    const query = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '';
    const items = search(catalogue.snapshot().products, query);
    page(res, listingPage(ctx, { title: s.searchResults, heading: query ? `${s.searchResults} : « ${query} »` : s.search, items, all: items, canonical: '/recherche', showFilters: false, searchQuery: query, crumbsItems: [{ href: '/', label: s.home }, { label: s.search }] }));
  });

  app.get('/p/:slugId', (req, res, next) => {
    const id = Number(/(\d+)$/u.exec(req.params.slugId)?.[1]);
    const snap = catalogue.snapshot();
    const product = snap.byId.get(id);
    if (!product) return next();
    const canonical = productPath(product);
    if (`/p/${req.params.slugId}` !== canonical) return res.redirect(301, canonical + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''));
    const inStock = snap.products.filter((p) => p.id !== product.id && p.stock > 0);
    const others = inStock.filter((p) => p.category !== product.category).slice(0, 2);
    const same = inStock.filter((p) => p.category === product.category).slice(0, 4 - others.length);
    return page(res, productPage(res.locals.ctx, product, [...same, ...others]));
  });

  app.get('/panier', (_req, res) => page(res, cartPage(res.locals.ctx)));
  app.get('/commande', (_req, res) => page(res, checkoutPage(res.locals.ctx, { deliveryOptions: storage.shopData().deliveryOptions })));

  // The « merci » token travels in a cookie for that page only, not in the address:
  // the ad pixels report page addresses to Meta, TikTok and Google.
  const merciCookie = (ref) => `tw_m_${ref.replace(/[^A-Za-z0-9-]/gu, '')}`;
  app.get('/merci/:ref', (req, res, next) => {
    const ref = String(req.params.ref);
    const fromCookie = new RegExp(`(?:^|;\\s*)${merciCookie(ref)}=([a-f0-9]{20})`, 'u').exec(req.headers.cookie ?? '')?.[1];
    if (!desk.verify(ref, typeof req.query.t === 'string' ? req.query.t : fromCookie)) return next();
    const summary = desk.summary(ref);
    if (!summary) return next();
    return page(res, thanksPage(res.locals.ctx, summary, { duplicate: req.query.d === '1' }));
  });

  // Order tracking needs the reference AND the phone; tries are limited per device and per reference.
  const trackTries = new WindowCounter({ windowMs: 10 * 60_000, max: 20 });
  const trackMisses = new WindowCounter({ windowMs: 60 * 60_000, max: 8 });
  const track = (req, res) => {
    const source = req.method === 'POST' ? req.body ?? {} : req.query;
    const reference = typeof source.ref === 'string' ? source.ref.slice(0, 40) : '';
    const phone = typeof source.phone === 'string' ? source.phone.slice(0, 20) : '';
    const searched = Boolean(reference && phone);
    const ip = clientIp(req);
    const refKey = reference.trim().toUpperCase();
    let summary = null;
    let limited = false;
    if (searched) {
      limited = (ip && trackTries.full(ip)) || trackMisses.full(refKey);
      if (!limited) {
        if (ip) trackTries.hit(ip);
        summary = desk.track(reference, phone);
        if (!summary) trackMisses.hit(refKey);
      }
    }
    res.setHeader('Referrer-Policy', 'no-referrer');
    page(res, trackPage(res.locals.ctx, { reference, phone, summary, searched, limited }), limited ? 429 : 200);
  };
  app.get('/suivi', track);
  app.post('/suivi', express.urlencoded({ extended: false, limit: '2kb' }), track);

  app.get('/page/:slug', (req, res, next) => {
    const view = staticPage(res.locals.ctx, req.params.slug);
    return view ? page(res, view) : next();
  });

  app.get('/lancement/:slug', (req, res, next) => {
    const launch = content.launchBySlug(req.params.slug);
    return launch ? page(res, launchPage(res.locals.ctx, launch)) : next();
  });

  // 5. JSON for the browser scripts.
  app.post('/api/cart', express.json({ limit: '20kb' }), (req, res) => {
    const { byExternalId } = catalogue.snapshot();
    const lang = res.locals.ctx.lang;
    const lines = (Array.isArray(req.body?.lines) ? req.body.lines.slice(0, 30) : []).map((line) => {
      const p = byExternalId.get(String(line?.externalId ?? ''));
      if (!p) return { externalId: line?.externalId, missing: true };
      const colour = p.colors.find((c) => c.value === line.color);
      const locked = content.launchFor(p.externalId)?.state === 'upcoming';
      const available = locked ? 0 : p.isModel ? Number(p.grid[`${line.color ?? ''}||${line.size ?? ''}`] ?? 0) : p.stock;
      const photoPath = colour?.photos[0] ?? p.cover;
      return {
        externalId: p.externalId,
        name: lang === 'fr' ? p.nameFr : p.nameAr,
        url: productPath(p),
        price: p.price,
        priceNumber: p.priceNumber,
        color: line.color ?? null,
        colorLabel: colour ? (lang === 'fr' ? colour.labelFr : colour.labelAr) : null,
        size: line.size ?? null,
        available,
        image: photoPath ? `/img/320/${encodeURIComponent(uploadName(photoPath))}` : null,
      };
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ lines });
  });

  app.post('/api/order', express.json({ limit: '20kb' }), (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const { lang } = res.locals.ctx;
    const s = t(lang);
    if (req.body?.website) return res.status(400).json({ ok: false, message: s.errors.generic });
    const valid = validateOrder(req.body);
    if (!valid.ok) return res.status(400).json({ ok: false, field: valid.field, message: s.errors[valid.code] });
    // Exclusive launches: nothing before the hour, and the per-customer cap (a basket sent twice is not counted twice).
    if (!desk.findDuplicate(valid.order, valid.order.lines)) {
      const refusal = launchRefusal(valid.order, { content, storage, catalogue });
      if (refusal?.code === 'launchLocked') {
        const productName = refusal.product ? (lang === 'fr' ? refusal.product.nameFr : refusal.product.nameAr) : '';
        return res.status(409).json({ ok: false, code: refusal.code, message: s.errors.launchLocked(productName, whenText(refusal.launch.launchAt, lang)) });
      }
      if (refusal?.code === 'launchMax') return res.status(409).json({ ok: false, code: refusal.code, message: s.errors.launchMax(refusal.max) });
    }
    // Counted after the launch rules: trying before the opening hour is not a suspicious order.
    if (!desk.allow(clientIp(req))) return res.status(429).json({ ok: false, message: s.errors.rate });
    const result = desk.place(valid.order);
    if (!result.ok) {
      const refusal = result.refusal ?? { code: result.code };
      let message = s.errors[refusal.code] ?? s.errors.generic;
      if (refusal.code === 'stock') message = s.errors.stock(refusal.product ? (lang === 'fr' ? refusal.product.nameFr : refusal.product.nameAr) : '', refusal.available);
      return res.status(result.status).json({ ok: false, field: refusal.code === 'delivery' ? 'delivery' : undefined, code: refusal.code, message });
    }
    const token = desk.sign(result.orderGroup);
    const ref = encodeURIComponent(result.orderGroup);
    // The same basket from the same phone, sent again: only the browser that placed it (it holds
    // that page's cookie) is taken to the summary; anyone else just learns it is already received.
    if (result.duplicate && !new RegExp(`(?:^|;\\s*)${merciCookie(result.orderGroup)}=${token}`, 'u').test(req.headers.cookie ?? '')) {
      return res.status(200).json({ ok: true, duplicate: true, message: s.duplicate });
    }
    res.setHeader('Set-Cookie', `${merciCookie(result.orderGroup)}=${token}; Path=/merci/${ref}; Max-Age=2592000; HttpOnly; SameSite=Lax${config.siteUrl.startsWith('https://') ? '; Secure' : ''}`);
    return res.status(result.status).json({
      ok: true,
      orderGroup: result.orderGroup,
      duplicate: Boolean(result.duplicate),
      redirect: `/merci/${ref}${result.duplicate ? '?d=1' : ''}`,
    });
  });

  // « Prévenez-moi » on a launch that has not opened yet.
  const notifyHits = new WindowCounter({ windowMs: 10 * 60_000, max: 10 });
  app.post('/api/notify', express.json({ limit: '4kb' }), (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const s = t(res.locals.ctx.lang);
    if (req.body?.website) return res.status(400).json({ ok: false, message: s.errors.generic });
    const ip = clientIp(req);
    if (ip && notifyHits.full(ip)) return res.status(429).json({ ok: false, message: s.errors.rate });
    if (ip) notifyHits.hit(ip);
    if (!normalizePhone(req.body?.phone)) return res.status(400).json({ ok: false, field: 'phone', message: s.errors.phone });
    const result = content.subscribe(String(req.body?.launch ?? ''), { phone: req.body?.phone, name: req.body?.name });
    if (!result.ok) return res.status(result.code === 'gone' ? 404 : 400).json({ ok: false, message: result.code === 'gone' ? s.errors.gone : s.errors.generic });
    return res.json({ ok: true, message: result.already ? s.launch.notifyAlready : s.launch.notifyDone });
  });

  // 6. Search engines and health.
  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /panier\nDisallow: /commande\nDisallow: /merci/\nDisallow: /admin\nSitemap: ${config.siteUrl}/sitemap.xml\n`);
  });
  app.get('/sitemap.xml', (_req, res) => {
    const snap = catalogue.snapshot();
    const urls = ['/', '/boutique', ...snap.categories.map((c) => `/c/${encodeURIComponent(c.slug)}`), ...snap.products.map(productPath), ...Object.keys(POLICIES).map((p) => `/page/${p}`), ...content.launches().filter((l) => l.active).map((l) => `/lancement/${l.slug}`)];
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${config.siteUrl}${u}</loc></url>`).join('\n')}\n</urlset>\n`);
  });
  app.get('/health', (_req, res) => {
    // Public: what a deploy needs to know, nothing about the business (no order or product counts).
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, syncKey: config.syncKey !== '', release: process.env.TW_RELEASE ?? null, fallback: process.env.TW_RELEASE_FALLBACK === '1', images: imagesEnabled ? 'webp' : 'original' });
  });

  // 7. 404 and errors.
  app.use((req, res) => {
    if (!res.locals.ctx) return res.status(404).end();
    if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false });
    return page(res, notFoundPage(res.locals.ctx), 404);
  });
  app.use((error, req, res, _next) => {
    if (!(error.status >= 400 && error.status < 500)) console.error(error);
    if (res.headersSent) return;
    if (req.path.startsWith('/api/')) {
      res.status(error.status ?? 500).json({ ok: false, message: t(res.locals.ctx?.lang).errors.generic });
      return;
    }
    const status = error.status >= 400 && error.status < 500 ? error.status : 500; // e.g. a malformed %-encoding is the client's
    res.status(status).type('text/plain').send(status === 500 ? 'Erreur interne. Réessayez dans un instant.' : 'Requête invalide.');
  });

  return { app, storage, catalogue, images, desk, receiver, content };
}

