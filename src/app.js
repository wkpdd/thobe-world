/**
 * The store. H47 Pay (NewStore) is the source of truth for EVERYTHING the shop
 * sells: it pushes the catalogue, photos, stock, delivery prices, order statuses
 * and parcels to `/api/sync.php`, and pulls the web orders from there. The site
 * keeps only that projection (data/store.json + data/uploads) and never writes
 * stock: `@h47io/sync-receiver` enforces the contract.
 */
import { readFileSync } from 'node:fs';
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

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PUBLIC = join(ROOT, 'public');
const YEAR = 31_536_000;

export function createApp(config) {
  const storage = new JsonFileSyncStorage({ dir: config.dataDir, uploadsUrl: '/uploads/' });
  const catalogue = new Catalogue(storage);
  const images = new ImageOptimizer({ uploadsDir: storage.uploadsDir, cacheDir: join(config.dataDir, 'cache') });

  // A new photo from H47 Pay → its WebP sizes are prepared right after the sync answers.
  const putBytes = storage.images.putBytes;
  storage.images.putBytes = (shop, file) => {
    const path = putBytes(shop, file);
    setImmediate(() => images.warm(uploadName(path)));
    return path;
  };

  const receiver = new SyncReceiver({
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
  app.all('/api/sync.php', (req, res, next) => {
    res.on('finish', () => catalogue.invalidate());
    sync(req, res, next);
  });

  app.use(compression({ threshold: 1024 }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
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

  // 3. Language: ?lang=fr|ar sets a cookie; Arabic by default.
  app.use((req, res, next) => {
    const asked = typeof req.query.lang === 'string' && LANGS.includes(req.query.lang) ? req.query.lang : null;
    const cookie = /(?:^|;\s*)lang=(ar|fr)/u.exec(req.headers.cookie ?? '')?.[1];
    const lang = asked ?? cookie ?? 'ar';
    if (asked && asked !== cookie) res.setHeader('Set-Cookie', `lang=${asked}; Path=/; Max-Age=31536000; SameSite=Lax`);
    const url = new URL(req.originalUrl, 'http://x');
    url.searchParams.delete('lang');
    res.locals.ctx = { lang, config, assets, catalogue, path: `${url.pathname}${url.search}`, deliveryOptions: storage.shopData().deliveryOptions };
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

  app.get('/merci/:ref', (req, res, next) => {
    const ref = String(req.params.ref);
    if (!desk.verify(ref, req.query.t)) return next();
    const summary = desk.summary(ref);
    if (!summary) return next();
    return page(res, thanksPage(res.locals.ctx, summary, { duplicate: req.query.d === '1' }));
  });

  app.get('/suivi', (req, res) => {
    const reference = typeof req.query.ref === 'string' ? req.query.ref.slice(0, 40) : '';
    const phone = typeof req.query.phone === 'string' ? req.query.phone.slice(0, 20) : '';
    const searched = Boolean(reference && phone);
    const summary = searched ? desk.track(reference, phone) : null;
    page(res, trackPage(res.locals.ctx, { reference, phone, summary, searched }));
  });

  app.get('/page/:slug', (req, res, next) => {
    const view = staticPage(res.locals.ctx, req.params.slug);
    return view ? page(res, view) : next();
  });

  // 5. JSON for the browser scripts.
  app.post('/api/cart', express.json({ limit: '20kb' }), (req, res) => {
    const { byExternalId } = catalogue.snapshot();
    const lang = res.locals.ctx.lang;
    const lines = (Array.isArray(req.body?.lines) ? req.body.lines.slice(0, 30) : []).map((line) => {
      const p = byExternalId.get(String(line?.externalId ?? ''));
      if (!p) return { externalId: line?.externalId, missing: true };
      const colour = p.colors.find((c) => c.value === line.color);
      const available = p.isModel ? Number(p.grid[`${line.color ?? ''}||${line.size ?? ''}`] ?? 0) : p.stock;
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
    if (!desk.allow(req.ip ?? 'unknown')) return res.status(429).json({ ok: false, message: s.errors.rate });
    const result = desk.place(valid.order);
    if (!result.ok) {
      const refusal = result.refusal ?? { code: result.code };
      let message = s.errors[refusal.code] ?? s.errors.generic;
      if (refusal.code === 'stock') message = s.errors.stock(refusal.product ? (lang === 'fr' ? refusal.product.nameFr : refusal.product.nameAr) : '', refusal.available);
      return res.status(result.status).json({ ok: false, field: refusal.code === 'delivery' ? 'delivery' : undefined, code: refusal.code, message });
    }
    const token = desk.sign(result.orderGroup);
    return res.status(result.status).json({
      ok: true,
      orderGroup: result.orderGroup,
      duplicate: Boolean(result.duplicate),
      redirect: `/merci/${encodeURIComponent(result.orderGroup)}?t=${token}${result.duplicate ? '&d=1' : ''}`,
    });
  });

  // 6. Search engines and health.
  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /panier\nDisallow: /commande\nDisallow: /merci/\nSitemap: ${config.siteUrl}/sitemap.xml\n`);
  });
  app.get('/sitemap.xml', (_req, res) => {
    const snap = catalogue.snapshot();
    const urls = ['/', '/boutique', ...snap.categories.map((c) => `/c/${encodeURIComponent(c.slug)}`), ...snap.products.map(productPath), ...Object.keys(POLICIES).map((p) => `/page/${p}`)];
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${config.siteUrl}${u}</loc></url>`).join('\n')}\n</urlset>\n`);
  });
  app.get('/health', (_req, res) => {
    const data = storage.shopData();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, products: data.products.length, orders: data.orders.length, deliveryOptions: data.deliveryOptions?.length ?? null, syncKey: config.syncKey !== '',
      // Set by deploy/bootstrap.cjs on cPanel: which release answers, and whether it is a fallback.
      release: process.env.TW_RELEASE ?? null, fallback: process.env.TW_RELEASE_FALLBACK === '1', images: imagesEnabled ? 'webp' : 'original' });
  });

  // 7. 404 and errors.
  app.use((req, res) => {
    if (!res.locals.ctx) return res.status(404).end();
    if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false });
    return page(res, notFoundPage(res.locals.ctx), 404);
  });
  app.use((error, req, res, _next) => {
    console.error(error);
    if (res.headersSent) return;
    if (req.path.startsWith('/api/')) {
      res.status(error.status ?? 500).json({ ok: false, message: t(res.locals.ctx?.lang).errors.generic });
      return;
    }
    res.status(500).type('text/plain').send('Erreur interne. Réessayez dans un instant.');
  });

  return { app, storage, catalogue, images, desk, receiver };
}

