/** /admin: the website dashboard (carousel, exclusive launches, their subscribers). */
import express from 'express';
import { storeUpload, mediaSet } from '../images.js';
import { AdminAuth } from './auth.js';
import { parseAlgiers } from '../content.js';
import { clientIp } from '../client-ip.js';
import { launchForm, launchesPage, loginPage, slideForm, slidesPage, subscribersCsv, subscribersPage, trackingPage } from './views.js';

export function adminRouter({ config, content, catalogue, assets, images }) {
  const auth = new AdminAuth({
    user: config.admin.user,
    password: config.admin.password,
    secret: config.secret,
    secure: config.siteUrl.startsWith('https://'),
    generation: () => content.adminGeneration(),
    revoke: () => content.revokeAdminSessions(),
  });
  const siteHost = new URL(config.siteUrl).host;
  const router = express.Router();
  const form = express.urlencoded({ extended: false, limit: '64kb', parameterLimit: 200 });
  const send = (res, view, status = 200) => {
    res.status(status);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; form-action 'self'");
    res.type('html').send(String(view));
  };
  // Only these messages: a link cannot make the dashboard display text of its own.
  const NOTICES = {
    'slide-saved': 'Diapositive enregistrée.',
    'slide-deleted': 'Diapositive supprimée.',
    'launch-saved': 'Lancement enregistré.',
    'launch-deleted': 'Lancement supprimé.',
    'pixels-saved': 'Pixels enregistrés : actifs sur le site dès maintenant.',
  };
  const flash = (req) => ({ notice: NOTICES[req.query.ok] ?? '' });

  // Every POST must come from a page of this site (on top of the SameSite cookie).
  router.use((req, res, next) => {
    if (req.method !== 'POST') return next();
    const from = req.headers.origin ?? req.headers.referer;
    let host = '';
    try {
      host = new URL(from).host;
    } catch {
      // no or bad origin
    }
    if (host && (host === req.headers.host || host === siteHost)) return next();
    return res.status(403).type('text').send('Requête refusée : elle ne vient pas du tableau de bord.');
  });

  router.get('/login', (_req, res) => send(res, loginPage({ assets, closed: !auth.enabled })));
  router.post('/login', form, (req, res) => {
    const ip = clientIp(req);
    if (!auth.enabled) return send(res, loginPage({ assets, closed: true }), 403);
    if (auth.locked(ip)) return send(res, loginPage({ assets, error: 'Trop de tentatives. Réessayez dans 15 minutes.' }), 429);
    const cookie = auth.login(ip, req.body?.user, req.body?.password);
    if (!cookie) return send(res, loginPage({ assets, error: 'Identifiant ou mot de passe incorrect.' }), 401);
    res.setHeader('Set-Cookie', cookie);
    return res.redirect(303, '/admin/carrousel');
  });
  router.post('/logout', (_req, res) => {
    res.setHeader('Set-Cookie', auth.logout());
    res.redirect(303, '/admin/login');
  });

  // Everything below needs a session.
  router.use((req, res, next) => {
    if (auth.check(req)) return next();
    if (req.method === 'GET' && req.accepts('html')) return res.redirect(303, '/admin/login');
    return res.status(401).json({ ok: false, message: 'Session expirée : reconnectez-vous.' });
  });

  router.get('/', (_req, res) => res.redirect(303, '/admin/carrousel'));

  // Pictures: the browser sends the file as the request body.
  router.post('/media', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '15mb' }), async (req, res) => {
    const name = await storeUpload(req.body, content.mediaDir);
    if (!name) return res.status(400).json({ ok: false, message: 'Ce fichier n’est pas une image JPEG, PNG ou WebP.' });
    images?.warm(name); // the usual sizes are ready before the first visitor
    return res.json({ ok: true, name, src: mediaSet(name, { max: 720 }).src });
  });

  // ---- Carousel ----------------------------------------------------------------
  const allLaunches = () => content.launches().filter((l) => l.active);
  router.get('/carrousel', (req, res) => send(res, slidesPage({ assets, slides: content.slides(), now: Date.now(), ...flash(req) })));
  router.get('/carrousel/nouvelle', (_req, res) => send(res, slideForm({ assets, slide: null, catalogue, launches: allLaunches() })));
  router.get('/carrousel/:id', (req, res, next) => {
    const slide = content.slide(req.params.id);
    return slide ? send(res, slideForm({ assets, slide, catalogue, launches: allLaunches() })) : next();
  });
  const saveSlide = (req, res) => {
    const result = content.saveSlide(req.body ?? {}, req.params.id ?? null);
    if (!result.ok) return send(res, slideForm({ assets, slide: { ...req.body, id: req.params.id, startsAt: parseAlgiers(req.body?.startsAt), endsAt: parseAlgiers(req.body?.endsAt), active: Boolean(req.body?.active) }, catalogue, launches: allLaunches(), error: result.error }), 422);
    return res.redirect(303, `/admin/carrousel?ok=slide-saved`);
  };
  router.post('/carrousel', form, saveSlide);
  router.post('/carrousel/:id', form, saveSlide);
  router.post('/carrousel/:id/monter', (req, res) => {
    content.moveSlide(req.params.id, -1);
    res.redirect(303, '/admin/carrousel');
  });
  router.post('/carrousel/:id/descendre', (req, res) => {
    content.moveSlide(req.params.id, 1);
    res.redirect(303, '/admin/carrousel');
  });
  router.post('/carrousel/:id/supprimer', (req, res) => {
    content.deleteSlide(req.params.id);
    res.redirect(303, `/admin/carrousel?ok=slide-deleted`);
  });

  // ---- Launches ------------------------------------------------------------------
  router.get('/lancements', (req, res) => send(res, launchesPage({ assets, launches: content.launches(), content, now: Date.now(), ...flash(req) })));
  router.get('/lancements/nouveau', (_req, res) => send(res, launchForm({ assets, launch: null, catalogue })));
  router.get('/lancements/:id', (req, res, next) => {
    const launch = content.launch(req.params.id);
    return launch ? send(res, launchForm({ assets, launch, catalogue })) : next();
  });
  const saveLaunch = (req, res) => {
    const result = content.saveLaunch(req.body ?? {}, req.params.id ?? null);
    if (!result.ok) {
      const body = req.body ?? {};
      const products = Array.isArray(body.products) ? body.products : body.products ? [body.products] : [];
      return send(res, launchForm({ assets, launch: { ...body, id: req.params.id, products, launchAt: parseAlgiers(body.launchAt), active: Boolean(body.active), featured: Boolean(body.featured), limited: Boolean(body.limited) }, catalogue, error: result.error }), 422);
    }
    return res.redirect(303, `/admin/lancements?ok=launch-saved`);
  };
  router.post('/lancements', form, saveLaunch);
  router.post('/lancements/:id', form, saveLaunch);
  router.post('/lancements/:id/supprimer', (req, res) => {
    content.deleteLaunch(req.params.id);
    res.redirect(303, `/admin/lancements?ok=launch-deleted`);
  });
  router.get('/lancements/:id/inscrits', (req, res, next) => {
    const launch = content.launch(req.params.id);
    if (!launch) return next();
    return send(res, subscribersPage({ assets, launch, subscribers: content.subscribers(launch.id), siteUrl: config.siteUrl, shopName: config.shop.nameAr }));
  });
  router.get('/lancements/:id/inscrits.csv', (req, res, next) => {
    const launch = content.launch(req.params.id);
    if (!launch) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="inscrits-${launch.slug}.csv"`);
    return res.type('text/csv; charset=utf-8').send(subscribersCsv(content.subscribers(launch.id)));
  });

  // ---- Ad pixels ----------------------------------------------------------------------
  router.get('/publicite', (req, res) => send(res, trackingPage({ assets, tracking: content.tracking(), pixels: content.pixels(config.pixels), ...flash(req) })));
  router.post('/publicite', express.urlencoded({ extended: false, limit: '256kb' }), (req, res) => {
    const result = content.saveTracking(req.body ?? {});
    if (!result.ok) return send(res, trackingPage({ assets, tracking: result.tracking, pixels: content.pixels(config.pixels), errors: result.errors }), 422);
    return res.redirect(303, `/admin/publicite?ok=pixels-saved`);
  });

  return router;
}
