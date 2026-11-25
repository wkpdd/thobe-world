/**
 * /admin: the owner's dashboard for the shop front's own words (announcement
 * bar and home page banner). Catalogue, stock, prices and orders stay in H47 Pay.
 *
 * One account, set with ADMIN_USER / ADMIN_PASSWORD. Without ADMIN_PASSWORD a
 * random one is generated once and kept in DATA_DIR/admin-password.txt.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import { html, raw } from './html.js';
import { TRUST_SLOTS, announceHtml } from './settings.js';

const COOKIE = 'tw_admin';
const SESSION_HOURS = 12;
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_MAX_FAILS = 10;

/** The dashboard login: from the environment, or generated once and kept in the data folder. */
export function adminCredentials(config) {
  const user = config.admin.user || 'admin';
  if (config.admin.password) return { user, password: config.admin.password, generated: null };
  const file = join(config.dataDir, 'admin-password.txt');
  if (existsSync(file)) {
    const saved = readFileSync(file, 'utf8').trim();
    if (saved) return { user, password: saved, generated: file };
  }
  const password = randomBytes(12).toString('base64url');
  writeFileSync(file, `${password}\n`, { mode: 0o600 });
  return { user, password, generated: file };
}

const same = (a, b) => {
  const x = createHash('sha256').update(String(a)).digest();
  const y = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(x, y);
};

export function adminRouter({ config, settings, credentials }) {
  const router = express.Router();
  const fails = new Map(); // ip → [timestamps]
  // Changing the password (or the secret) signs every open session out.
  const pwHash = createHash('sha256').update(credentials.password).digest('hex');
  const sign = (exp) => createHmac('sha256', config.secret).update(`admin|${credentials.user}|${exp}|${pwHash}`).digest('base64url');

  const readCookie = (req) => new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`, 'u').exec(req.headers.cookie ?? '')?.[1] ?? '';
  const signedIn = (req) => {
    const [exp, sig] = readCookie(req).split('.');
    if (!exp || !sig || Number(exp) < Date.now()) return false;
    return same(sig, sign(exp));
  };
  const cookie = (req, value, maxAge) =>
    `${COOKIE}=${value}; Path=/admin; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${req.secure ? '; Secure' : ''}`;

  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    // Every form and upload comes from this site's own pages.
    if (req.method === 'POST') {
      const from = req.headers.origin ?? req.headers.referer;
      if (from) {
        let host = '';
        try {
          host = new URL(from).host;
        } catch {
          /* unreadable */
        }
        if (host !== req.headers.host) return res.status(403).type('text/plain').send('Forbidden');
      }
    }
    return next();
  });

  router.get('/login', (req, res) => {
    if (signedIn(req)) return res.redirect(303, '/admin');
    return res.type('html').send(String(loginPage({ error: req.query.e })));
  });

  router.post('/login', express.urlencoded({ extended: false, limit: '4kb' }), (req, res) => {
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    const recent = (fails.get(ip) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
    if (recent.length >= LOGIN_MAX_FAILS) return res.status(429).type('html').send(String(loginPage({ error: 'rate' })));
    const okUser = same(String(req.body?.user ?? '').trim(), credentials.user);
    const okPass = same(String(req.body?.password ?? ''), credentials.password);
    if (!(okUser && okPass)) {
      recent.push(now);
      fails.set(ip, recent);
      return res.redirect(303, '/admin/login?e=1');
    }
    fails.delete(ip);
    const exp = String(now + SESSION_HOURS * 3_600_000);
    res.setHeader('Set-Cookie', cookie(req, `${exp}.${sign(exp)}`, SESSION_HOURS * 3600));
    return res.redirect(303, '/admin');
  });

  router.post('/logout', (req, res) => {
    res.setHeader('Set-Cookie', cookie(req, '', 0));
    res.redirect(303, '/admin/login');
  });

  // Everything below needs a signed-in owner.
  router.use((req, res, next) => {
    if (signedIn(req)) return next();
    if (req.method === 'GET') return res.redirect(303, '/admin/login');
    return res.status(401).json({ ok: false });
  });

  router.get('/', (req, res) => res.type('html').send(String(dashboardPage({ s: settings.get(), imageUrl: settings.imageUrl(), notice: req.query.ok, bad: req.query.bad }))));

  router.post('/', express.urlencoded({ extended: false, limit: '64kb' }), (req, res) => {
    const b = req.body ?? {};
    if (b.action === 'reset') {
      settings.reset();
      return res.redirect(303, '/admin?ok=reset');
    }
    const p = (name) => ({ ar: b[`${name}_ar`], fr: b[`${name}_fr`] });
    const errors = settings.save({
      announce: p('announce'),
      hero: {
        eyebrow: p('eyebrow'),
        title1: p('title1'),
        title2: p('title2'),
        text: p('text'),
        primary: { label: p('primary'), href: b.primary_href },
        secondary: { label: p('secondary'), href: b.secondary_href },
        trust: Array.from({ length: TRUST_SLOTS }, (_v, i) => ({ icon: b[`trust${i}_icon`], label: p(`trust${i}`) })),
        imageFit: b.imageFit,
      },
    });
    return res.redirect(303, errors.length ? `/admin?ok=saved&bad=${errors.join(',')}` : '/admin?ok=saved');
  });

  router.post('/image', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '8mb' }), async (req, res) => {
    try {
      await settings.setImage(req.body);
      res.json({ ok: true, url: settings.imageUrl() });
    } catch (error) {
      res.status(400).json({ ok: false, code: error.code ?? 'image' });
    }
  });

  router.post('/image/remove', (_req, res) => {
    settings.clearImage();
    res.redirect(303, '/admin?ok=image');
  });

  // Upload over the limit, or not an image type.
  router.use((error, _req, res, next) => {
    if (error?.type === 'entity.too.large') return res.status(413).json({ ok: false, code: 'size' });
    return next(error);
  });

  return router;
}

/* ---------------------------------------------------------------- views */

const STYLE = raw(`<style>
:root{--ink:#1F1B16;--gold:#B8893A;--gold-soft:#E6CF9F;--ivory:#FBF8F2;--sand:#F1E8D8;--linen:#E4D8C3;--muted:#6E655A;--red:#A2321F;--green:#2F6B3A}
*{box-sizing:border-box}body{margin:0;font-family:Tajawal,system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--ivory);color:var(--ink);line-height:1.5}
a{color:var(--gold)}
.top{background:var(--ink);color:var(--gold-soft);padding:12px 16px;display:flex;gap:12px;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:5}
.top b{color:#fff}.top form{margin:0}.top a,.top button{color:var(--gold-soft);background:none;border:1px solid #4a4237;border-radius:999px;padding:6px 14px;font:inherit;cursor:pointer;text-decoration:none}
main{max-width:980px;margin:0 auto;padding:20px 16px 120px}
h1{font-size:1.4rem;margin:8px 0 4px}h2{font-size:1.05rem;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 14px;font-size:.92rem}
.card{background:#fff;border:1px solid var(--linen);border-radius:16px;padding:18px;margin:16px 0}
.row{display:grid;gap:12px;grid-template-columns:1fr}@media(min-width:720px){.row{grid-template-columns:1fr 1fr}.row.three{grid-template-columns:90px 1fr 1fr}}
label{display:block;font-size:.85rem;color:var(--muted)}label span{display:block;margin-bottom:4px}
input[type=text],input[type=password],textarea,select{width:100%;font:inherit;color:var(--ink);background:var(--ivory);border:1px solid var(--linen);border-radius:10px;padding:10px 12px}
textarea{min-height:76px;resize:vertical}input:focus,textarea:focus,select:focus{outline:2px solid var(--gold-soft);border-color:var(--gold)}
[dir=rtl]{text-align:right}.icon-in{text-align:center;font-size:1.2rem}
.btn{display:inline-block;font:inherit;font-weight:700;border-radius:999px;padding:11px 22px;border:1px solid var(--ink);background:var(--ink);color:#fff;cursor:pointer;text-decoration:none}
.btn.line{background:#fff;color:var(--ink)}.btn.small{padding:7px 14px;font-weight:400;font-size:.9rem}
.bar{position:fixed;inset:auto 0 0 0;background:rgba(251,248,242,.96);border-top:1px solid var(--linen);padding:12px 16px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.note{border-radius:12px;padding:10px 14px;margin:12px 0}.note.ok{background:#E7F1E5;color:var(--green)}.note.bad{background:#F7E4DF;color:var(--red)}
.preview-bar{background:var(--ink);color:var(--gold-soft);border-radius:10px;padding:8px;text-align:center;font-size:.9rem;margin-top:10px}.preview-bar b{color:var(--gold)}
.pic{display:flex;gap:16px;align-items:center;flex-wrap:wrap}.pic img{width:140px;height:175px;object-fit:contain;background:linear-gradient(180deg,#F4ECDD,#E7DAC2);border-radius:70px 70px 12px 12px;border:1px solid var(--linen)}
.pic.photo img{object-fit:cover}
.login{max-width:380px;margin:10vh auto;padding:0 16px}.login .card{padding:24px}.login img{display:block;margin:0 auto 8px;height:64px}
.hint{font-size:.8rem;color:var(--muted);margin:6px 0 0}
</style>`);

const shell = (title, body) => html`<!doctype html>
<html lang="fr" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${title} · Thobe World</title><link rel="icon" type="image/png" href="/img/favicon-32.png"><link rel="stylesheet" href="/fonts/fonts.css">${STYLE}</head>
<body>${body}</body></html>`;

function loginPage({ error }) {
  const msg = error === 'rate' ? 'Trop d’essais. Réessayez dans 15 minutes.' : error ? 'Identifiant ou mot de passe incorrect.' : '';
  return shell('Connexion', html`<div class="login"><div class="card">
  <img src="/img/logo-ink.webp" alt="عالم الثوب · Thobe World">
  <h1 style="text-align:center">Tableau de bord</h1>
  <p class="sub" style="text-align:center">لوحة التحكم · عالم الثوب</p>
  ${msg ? html`<div class="note bad" role="alert">${msg}</div>` : ''}
  <form method="post" action="/admin/login">
    <label><span>Identifiant</span><input type="text" name="user" autocomplete="username" required autofocus></label>
    <label style="margin-top:12px"><span>Mot de passe</span><input type="password" name="password" autocomplete="current-password" required></label>
    <button class="btn" type="submit" style="width:100%;margin-top:16px">Se connecter</button>
  </form>
</div></div>`);
}

const field = (name, label, value, { dir, area = false, placeholder = '' } = {}) =>
  html`<label><span>${label}</span>${area ? html`<textarea name="${name}" dir="${dir}" placeholder="${placeholder}">${value}</textarea>` : html`<input type="text" name="${name}" dir="${dir}" value="${value}" placeholder="${placeholder}">`}</label>`;

const both = (name, label, value, opts = {}) => html`<div class="row">
  ${field(`${name}_ar`, `${label} — عربي`, value.ar, { ...opts, dir: 'rtl' })}
  ${field(`${name}_fr`, `${label} — Français`, value.fr, { ...opts, dir: 'ltr' })}
</div>`;

const NOTICES = { saved: 'Enregistré. La page d’accueil est à jour.', reset: 'Textes remis par défaut.', image: 'Image retirée : le logo est affiché.' };
const BAD = { primary: 'bouton 1', secondary: 'bouton 2' };

function dashboardPage({ s, imageUrl, notice, bad }) {
  const h = s.hero;
  const badList = String(bad ?? '').split(',').filter((k) => BAD[k]);
  return shell('Tableau de bord', html`
<div class="top"><b>عالم الثوب · Tableau de bord</b><span style="display:flex;gap:8px"><a href="/" target="_blank" rel="noopener">Voir le site ↗</a><form method="post" action="/admin/logout"><button type="submit">Déconnexion</button></form></span></div>
<main>
  <h1>Page d’accueil</h1>
  <p class="sub">Le bandeau du haut et la bannière d’accueil, en arabe et en français. Les produits, prix, stock et commandes restent dans H47 Pay.</p>
  ${NOTICES[notice] ? html`<div class="note ok" role="status">${NOTICES[notice]}</div>` : ''}
  ${badList.length ? html`<div class="note bad" role="alert">Lien refusé pour ${badList.map((k) => BAD[k]).join(', ')} : utilisez une adresse du site (/boutique, /c/qamis…) ou https://…</div>` : ''}

  <section class="card">
    <h2>Image de la bannière</h2>
    <p class="sub">JPEG, PNG ou WebP, 8 Mo maximum. Sans image, le logo doré est affiché.</p>
    <div class="pic${h.image && h.imageFit === 'photo' ? ' photo' : ''}" data-pic>
      <img src="${imageUrl}" alt="" data-pic-img>
      <div>
        <input type="file" accept="image/jpeg,image/png,image/webp" data-upload hidden>
        <button class="btn line small" type="button" data-pick>Changer l’image</button>
        ${h.image ? html`<form method="post" action="/admin/image/remove" style="display:inline"><button class="btn line small" type="submit">Remettre le logo</button></form>` : ''}
        <p class="hint" data-upload-msg></p>
      </div>
    </div>
  </section>

  <form method="post" action="/admin" id="f">
    <section class="card">
      <h2>Bandeau du haut</h2>
      <p class="sub">Entourez un mot de **deux étoiles** pour l’afficher en doré.</p>
      ${both('announce', 'Texte', s.announce)}
      <div class="preview-bar" dir="rtl">${announceHtml(s.announce.ar)}</div>
    </section>

    <section class="card">
      <h2>Bannière d’accueil</h2>
      ${both('eyebrow', 'Petit titre (doré, au-dessus)', h.eyebrow)}
      <div style="height:12px"></div>
      ${both('title1', 'Titre — ligne 1 (noir)', h.title1)}
      <div style="height:12px"></div>
      ${both('title2', 'Titre — ligne 2 (doré)', h.title2)}
      <div style="height:12px"></div>
      ${both('text', 'Texte', h.text, { area: true })}
      <div style="height:12px"></div>
      <label><span>Affichage de l’image</span><select name="imageFit">
        <option value="logo"${h.imageFit === 'logo' ? raw(' selected') : ''}>Logo : centré, plus petit</option>
        <option value="photo"${h.imageFit === 'photo' ? raw(' selected') : ''}>Photo : remplit l’arche</option>
      </select></label>
    </section>

    <section class="card">
      <h2>Boutons</h2>
      <p class="sub">Lien : une page du site (/boutique, /c/qamis, /suivi…) ou une adresse https://. Bouton 2 vide : la première catégorie s’affiche. Libellé vide : le bouton est caché.</p>
      <h2 style="font-size:.95rem;margin-top:10px">Bouton 1 (noir)</h2>
      ${both('primary', 'Libellé', h.primary.label)}
      <div style="height:10px"></div>
      ${field('primary_href', 'Lien', h.primary.href, { dir: 'ltr', placeholder: '/boutique' })}
      <h2 style="font-size:.95rem;margin-top:18px">Bouton 2 (contour)</h2>
      ${both('secondary', 'Libellé', h.secondary.label, { placeholder: 'Automatique : première catégorie' })}
      <div style="height:10px"></div>
      ${field('secondary_href', 'Lien', h.secondary.href, { dir: 'ltr', placeholder: 'Automatique : première catégorie' })}
    </section>

    <section class="card">
      <h2>Avantages (sous les boutons)</h2>
      <p class="sub">Une icône (emoji) et un texte. Texte vide : l’avantage est caché.</p>
      ${h.trust.map((row, i) => html`<div class="row three" style="margin-top:10px">
        <label><span>Icône</span><input type="text" class="icon-in" name="trust${i}_icon" value="${row.icon}" maxlength="8"></label>
        ${field(`trust${i}_ar`, `Avantage ${i + 1} — عربي`, row.label.ar, { dir: 'rtl' })}
        ${field(`trust${i}_fr`, `Avantage ${i + 1} — Français`, row.label.fr, { dir: 'ltr' })}
      </div>`)}
    </section>

    <div class="bar">
      <button class="btn" type="submit">Enregistrer</button>
      <button class="btn line" type="submit" name="action" value="reset" data-reset>Textes par défaut</button>
      <a class="btn line" href="/" target="_blank" rel="noopener">Voir le site ↗</a>
    </div>
  </form>
</main>
<script>
(function(){
  var input=document.querySelector('[data-upload]'),msg=document.querySelector('[data-upload-msg]'),img=document.querySelector('[data-pic-img]');
  document.querySelector('[data-pick]').addEventListener('click',function(){input.click()});
  document.querySelector('[data-reset]').addEventListener('click',function(e){if(!confirm('Remettre tous les textes par défaut ?'))e.preventDefault()});
  input.addEventListener('change',function(){
    var file=input.files[0];if(!file)return;
    if(file.size>8*1024*1024){msg.textContent='Image trop lourde (8 Mo maximum).';return}
    msg.textContent='Envoi…';
    fetch('/admin/image',{method:'POST',headers:{'Content-Type':file.type},body:file,credentials:'same-origin'})
      .then(function(r){return r.json()})
      .then(function(d){if(d.ok){location.href='/admin?ok=saved'}else{msg.textContent=d.code==='size'?'Image trop lourde (8 Mo maximum).':'Format non reconnu : JPEG, PNG ou WebP.'}})
      .catch(function(){msg.textContent='Échec de l’envoi. Réessayez.'});
  });
})();
</script>`);
}
