/**
 * The website dashboard (/admin), in French like H47 Pay. Server-rendered, no
 * framework; public/js/admin.js only uploads pictures and filters the product list.
 */
import { html, raw } from '../html.js';
import { mediaSet, imageSet } from '../images.js';
import { productPath, categoryName, formatMoney } from '../catalogue.js';
import { toAlgiersInput } from '../content.js';
import { whenText } from '../launches.js';

const thumb = (name, w = 320) => (name ? mediaSet(name, { max: w })?.src : null);

function page({ title, body, nav = true, active = '', notice = '', error = '', assets }) {
  return html`<!doctype html>
<html lang="fr" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${title} · Tableau de bord · Thobe World</title>
<link rel="icon" type="image/svg+xml" href="/img/favicon.svg">
<link rel="stylesheet" href="${assets.url('css/admin.css')}">
</head>
<body>
${nav ? html`<header class="top">
  <a class="brand" href="/admin"><img src="/img/favicon.svg" alt="" width="28" height="28"><span>Tableau de bord</span></a>
  <nav>
    <a href="/admin/statistiques"${active === 'stats' ? raw(' aria-current="page"') : ''}>Statistiques</a>
    <a href="/admin/carrousel"${active === 'slides' ? raw(' aria-current="page"') : ''}>Carrousel</a>
    <a href="/admin/lancements"${active === 'launches' ? raw(' aria-current="page"') : ''}>Lancements</a>
    <a href="/admin/publicite"${active === 'ads' ? raw(' aria-current="page"') : ''}>Publicité</a>
    <a href="/" target="_blank" rel="noopener">Voir le site ↗</a>
    <form method="post" action="/admin/logout"><button class="link" type="submit">Déconnexion</button></form>
  </nav>
</header>` : ''}
<main class="wrap">
${notice ? html`<p class="notice ok" role="status">${notice}</p>` : ''}
${error ? html`<p class="notice err" role="alert">${error}</p>` : ''}
${body}
</main>
<script src="${assets.url('js/admin.js')}" defer></script>
</body>
</html>`;
}

export function loginPage({ assets, error = '', closed = false }) {
  const body = closed
    ? html`<div class="card login"><h1>Tableau de bord fermé</h1>
      <p>Pour l’ouvrir, ajoutez dans cPanel → <b>Setup Node.js App</b> → <i>Environment variables</i> :</p>
      <pre>ADMIN_USER=admin
ADMIN_PASSWORD=un mot de passe d’au moins 12 caractères</pre>
      <p>puis cliquez sur <b>Restart</b>.</p></div>`
    : html`<form class="card login" method="post" action="/admin/login">
      <img src="/img/logo.svg" alt="عالم الثوب · Thobe World" width="172" height="60">
      <h1>Tableau de bord</h1>
      <label>Identifiant<input name="user" autocomplete="username" required autofocus></label>
      <label>Mot de passe<input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn" type="submit">Se connecter</button>
    </form>`;
  return page({ title: 'Connexion', body, nav: false, error, assets });
}

const slideState = (s, now) => {
  if (!s.active) return ['off', 'Masquée'];
  if (s.startsAt && Date.parse(s.startsAt) > now) return ['soon', `Programmée · ${whenText(s.startsAt, 'fr')}`];
  if (s.endsAt && Date.parse(s.endsAt) <= now) return ['off', 'Terminée'];
  return ['on', s.endsAt ? `Visible jusqu’au ${whenText(s.endsAt, 'fr')}` : 'Visible'];
};

export function slidesPage({ assets, slides, now, notice, error }) {
  const body = html`<div class="head"><h1>Carrousel de l’accueil</h1><a class="btn" href="/admin/carrousel/nouvelle">+ Ajouter une diapositive</a></div>
  <p class="muted">Les diapositives visibles défilent en haut de la page d’accueil, dans cet ordre. Sans diapositive visible, l’accueil garde sa bannière habituelle.</p>
  ${slides.length ? html`<ol class="rows">${slides.map((s, i) => {
    const [state, label] = slideState(s, now);
    return html`<li class="row">
      <img class="thumb wide" src="${thumb(s.image)}" alt="" loading="lazy">
      <div class="grow"><b>${s.titleFr || s.titleAr || '(sans titre)'}</b>${s.titleAr ? html`<span class="ar" dir="rtl">${s.titleAr}</span>` : ''}<span class="pill ${state}">${label}</span>${s.link ? html`<span class="muted small">→ ${s.link}</span>` : ''}</div>
      <div class="actions">
        <form method="post" action="/admin/carrousel/${s.id}/monter"><button class="icon" type="submit" aria-label="Monter"${i === 0 ? raw(' disabled') : ''}>↑</button></form>
        <form method="post" action="/admin/carrousel/${s.id}/descendre"><button class="icon" type="submit" aria-label="Descendre"${i === slides.length - 1 ? raw(' disabled') : ''}>↓</button></form>
        <a class="btn line" href="/admin/carrousel/${s.id}">Modifier</a>
        <form method="post" action="/admin/carrousel/${s.id}/supprimer" data-confirm="Supprimer cette diapositive ?"><button class="btn danger" type="submit">Supprimer</button></form>
      </div>
    </li>`;
  })}</ol>` : html`<div class="card empty">Aucune diapositive. L’accueil affiche sa bannière habituelle.</div>`}`;
  return page({ title: 'Carrousel', body, active: 'slides', notice, error, assets });
}

function imageField({ name, label, hint, value, required = false }) {
  return html`<div class="field upload" data-upload>
    <span class="label">${label}${required ? ' *' : ''}</span>
    <div class="drop">
      <img data-preview alt=""${value ? html` src="${thumb(value, 720)}"` : raw(' hidden')}>
      <input type="file" accept="image/jpeg,image/png,image/webp" data-file>
      <input type="hidden" name="${name}" value="${value ?? ''}" data-value${required ? raw(' data-required') : ''}>
      <span class="muted small" data-status>${hint}</span>
      ${value && !required ? html`<button class="link small" type="button" data-clear>Retirer l’image</button>` : ''}
    </div>
  </div>`;
}

const linkOptions = (catalogue, launches) => {
  const snap = catalogue.snapshot();
  return [
    ['/boutique', 'Tous les produits'],
    ...snap.categories.map((c) => [`/c/${c.slug}`, `Catégorie · ${categoryName(c, 'fr')}`]),
    ...launches.map((l) => [`/lancement/${l.slug}`, `Lancement · ${l.titleFr || l.titleAr}`]),
    ...snap.products.slice(0, 200).map((p) => [productPath(p), `Article · ${p.nameFr || p.nameAr}`]),
  ];
};

export function slideForm({ assets, slide, catalogue, launches, error }) {
  const s = slide ?? { active: true };
  const body = html`<div class="head"><h1>${slide?.id ? 'Modifier la diapositive' : 'Nouvelle diapositive'}</h1><a class="link" href="/admin/carrousel">← Carrousel</a></div>
  <form class="card form" method="post" action="/admin/carrousel${slide?.id ? `/${slide.id}` : ''}">
    <div class="cols">
      ${imageField({ name: 'image', label: 'Image (ordinateur)', hint: 'Format large : 1920 × 800 conseillé. JPEG, PNG ou WebP.', value: s.image, required: true })}
      ${imageField({ name: 'imageMobile', label: 'Image pour téléphone (facultatif)', hint: 'Format portrait : 1080 × 1350 conseillé. Sinon l’image ordinateur est recadrée.', value: s.imageMobile })}
    </div>
    <div class="cols">
      <label>Titre (arabe)<input name="titleAr" dir="rtl" maxlength="90" value="${s.titleAr ?? ''}"></label>
      <label>Titre (français)<input name="titleFr" maxlength="90" value="${s.titleFr ?? ''}"></label>
      <label>Sous-titre (arabe)<input name="subtitleAr" dir="rtl" maxlength="160" value="${s.subtitleAr ?? ''}"></label>
      <label>Sous-titre (français)<input name="subtitleFr" maxlength="160" value="${s.subtitleFr ?? ''}"></label>
      <label>Bouton (arabe)<input name="buttonAr" dir="rtl" maxlength="30" placeholder="اكتشف" value="${s.buttonAr ?? ''}"></label>
      <label>Bouton (français)<input name="buttonFr" maxlength="30" placeholder="Découvrir" value="${s.buttonFr ?? ''}"></label>
    </div>
    <label>Lien (où mène un clic)<input name="link" list="links" placeholder="/boutique, /c/qamis, /lancement/… ou https://…" value="${s.link ?? ''}"></label>
    <datalist id="links">${linkOptions(catalogue, launches).map(([v, l]) => html`<option value="${v}">${l}</option>`)}</datalist>
    <div class="cols">
      <label>Afficher à partir du (facultatif)<input type="datetime-local" name="startsAt" value="${toAlgiersInput(s.startsAt)}"></label>
      <label>Jusqu’au (facultatif)<input type="datetime-local" name="endsAt" value="${toAlgiersInput(s.endsAt)}"></label>
    </div>
    <p class="muted small">Heures d’Alger. Sans dates, la diapositive est visible tant qu’elle est cochée.</p>
    <label class="check"><input type="checkbox" name="active"${s.active ? raw(' checked') : ''}> Visible sur le site</label>
    <div class="bar"><button class="btn" type="submit">Enregistrer</button><a class="link" href="/admin/carrousel">Annuler</a></div>
  </form>`;
  return page({ title: 'Diapositive', body, active: 'slides', error, assets });
}

export function launchesPage({ assets, launches, content, now, notice, error }) {
  const body = html`<div class="head"><h1>Lancements exclusifs</h1><a class="btn" href="/admin/lancements/nouveau">+ Nouveau lancement</a></div>
  <p class="muted">Avant l’heure d’ouverture, les articles d’un lancement sont visibles avec un compte à rebours mais ne peuvent pas être commandés, et les clients peuvent laisser leur numéro pour être prévenus. Les articles, prix, photos et stocks viennent de H47 Pay.</p>
  ${launches.length ? html`<ul class="rows">${launches.map((l) => {
    const upcoming = Date.parse(l.launchAt) > now;
    const subs = content.subscribers(l.id).length;
    return html`<li class="row">
      ${l.cover ? html`<img class="thumb" src="${thumb(l.cover)}" alt="" loading="lazy">` : html`<span class="thumb none">◆</span>`}
      <div class="grow"><b>${l.titleFr || l.titleAr}</b>${l.titleAr ? html`<span class="ar" dir="rtl">${l.titleAr}</span>` : ''}
        <span class="pill ${!l.active ? 'off' : upcoming ? 'soon' : 'on'}">${!l.active ? 'Masqué' : upcoming ? `À venir · ${whenText(l.launchAt, 'fr')}` : `Ouvert depuis ${whenText(l.launchAt, 'fr')}`}</span>
        <span class="muted small">${l.products.length} article(s)${l.limited ? ' · édition limitée' : ''}${l.maxPerCustomer ? ` · ${l.maxPerCustomer} max par client` : ''}${l.featured ? ' · sur l’accueil' : ''}</span></div>
      <div class="actions">
        <a class="btn line" href="/admin/lancements/${l.id}/inscrits">Inscrits (${subs})</a>
        <a class="btn line" href="/lancement/${l.slug}" target="_blank" rel="noopener">Voir ↗</a>
        <a class="btn line" href="/admin/lancements/${l.id}">Modifier</a>
        <form method="post" action="/admin/lancements/${l.id}/supprimer" data-confirm="Supprimer ce lancement et ses ${subs} inscrit(s) ?"><button class="btn danger" type="submit">Supprimer</button></form>
      </div>
    </li>`;
  })}</ul>` : html`<div class="card empty">Aucun lancement pour l’instant.</div>`}`;
  return page({ title: 'Lancements', body, active: 'launches', notice, error, assets });
}

export function launchForm({ assets, launch, catalogue, error }) {
  const l = launch ?? { active: true, featured: true, limited: true, products: [] };
  const chosen = new Set(l.products ?? []);
  const products = catalogue.snapshot().products;
  const body = html`<div class="head"><h1>${launch?.id ? 'Modifier le lancement' : 'Nouveau lancement'}</h1><a class="link" href="/admin/lancements">← Lancements</a></div>
  <form class="card form" method="post" action="/admin/lancements${launch?.id ? `/${launch.id}` : ''}">
    <div class="cols">
      <label>Titre (arabe)<input name="titleAr" dir="rtl" maxlength="90" value="${l.titleAr ?? ''}"></label>
      <label>Titre (français)<input name="titleFr" maxlength="90" value="${l.titleFr ?? ''}"></label>
      <label>Présentation (arabe)<textarea name="descriptionAr" dir="rtl" rows="4" maxlength="1200">${l.descriptionAr ?? ''}</textarea></label>
      <label>Présentation (français)<textarea name="descriptionFr" rows="4" maxlength="1200">${l.descriptionFr ?? ''}</textarea></label>
    </div>
    ${imageField({ name: 'cover', label: 'Image du lancement', hint: 'Grande photo de la collection (1600 × 1000 conseillé).', value: l.cover })}
    <div class="cols">
      <label>Ouverture des commandes *<input type="datetime-local" name="launchAt" required value="${toAlgiersInput(l.launchAt)}"></label>
      <label>Maximum par client (facultatif)<input type="number" name="maxPerCustomer" min="1" max="50" value="${l.maxPerCustomer ?? ''}" placeholder="sans limite"></label>
    </div>
    <p class="muted small">Heure d’Alger. Le maximum compte toutes les commandes d’un même numéro de téléphone pour ce lancement.</p>
    <fieldset class="picker" data-picker>
      <legend>Articles du lancement * <span class="muted small" data-picked>${chosen.size} choisi(s)</span></legend>
      <input type="search" placeholder="Rechercher un article…" data-filter>
      <div class="plist">${products.length ? products.map((p) => html`<label class="pitem" data-name="${`${p.nameFr} ${p.nameAr} ${p.sku ?? ''}`.toLowerCase()}">
        <input type="checkbox" name="products" value="${p.externalId}"${chosen.has(p.externalId) ? raw(' checked') : ''}>
        ${p.cover ? html`<img src="${imageSet(p.cover, { max: 320 })?.src}" alt="" loading="lazy">` : html`<span class="noimg">◆</span>`}
        <span><b>${p.nameFr || p.nameAr}</b><span class="muted small">${formatMoney(p.price)} DA · stock ${p.stock}</span></span>
      </label>`) : html`<p class="muted">Aucun article : H47 Pay n’a encore rien envoyé (articles « visibles sur le site »).</p>`}</div>
    </fieldset>
    <label class="check"><input type="checkbox" name="limited"${l.limited ? raw(' checked') : ''}> Édition limitée : badge « Exclusif · édition limitée » et pièces restantes affichées</label>
    <label class="check"><input type="checkbox" name="featured"${l.featured ? raw(' checked') : ''}> Mettre en avant sur l’accueil (compte à rebours)</label>
    <label class="check"><input type="checkbox" name="active"${l.active ? raw(' checked') : ''}> Actif (décoché : le lancement et sa page disparaissent, les articles redeviennent normaux)</label>
    <div class="bar"><button class="btn" type="submit">Enregistrer</button><a class="link" href="/admin/lancements">Annuler</a></div>
  </form>`;
  return page({ title: 'Lancement', body, active: 'launches', error, assets });
}

export function subscribersPage({ assets, launch, subscribers, siteUrl, shopName }) {
  const link = `${siteUrl}/lancement/${launch.slug}`;
  const message = (name) => `السلام عليكم${name ? ` ${name}` : ''}، ${launch.titleAr || launch.titleFr} متوفر الآن في ${shopName} 👑\n${link}`;
  const wa = (s) => `https://wa.me/213${s.phone.slice(1)}?text=${encodeURIComponent(message(s.name))}`;
  const body = html`<div class="head"><h1>Inscrits · ${launch.titleFr || launch.titleAr}</h1><a class="link" href="/admin/lancements">← Lancements</a></div>
  <p class="muted">${subscribers.length} personne(s) veulent être prévenues de l’ouverture (${whenText(launch.launchAt, 'fr')}). Le bouton WhatsApp ouvre la conversation avec un message prêt à envoyer.</p>
  <div class="bar"><a class="btn line" href="/admin/lancements/${launch.id}/inscrits.csv">Télécharger (CSV)</a></div>
  ${subscribers.length ? html`<table class="table"><thead><tr><th>Nom</th><th>Téléphone</th><th>Inscrit le</th><th></th></tr></thead><tbody>
  ${subscribers.map((s) => html`<tr><td>${s.name || '—'}</td><td dir="ltr">${s.phone}</td><td>${whenText(s.at, 'fr')}</td><td><a class="btn wa" href="${wa(s)}" target="_blank" rel="noopener">WhatsApp</a></td></tr>`)}
  </tbody></table>` : html`<div class="card empty">Personne pour l’instant.</div>`}`;
  return page({ title: 'Inscrits', body, active: 'launches', assets });
}

/** A cell a spreadsheet will not run as a formula (= + - @ tab CR at the start get a leading '). */
const csvCell = (value) => {
  const text = String(value ?? '');
  return `"${(/^[=+\-@\t\r]/u.test(text) ? `'${text}` : text).replace(/"/gu, '""')}"`;
};
export const subscribersCsv = (subscribers) =>
  `\uFEFFnom;telephone;inscrit_le\n${subscribers.map((s) => [s.name, s.phone, s.at].map(csvCell).join(';')).join('\n')}\n`;

const pixelState = (p) => (p.id
  ? html`<span class="pill on">Actif${p.source === 'cpanel' ? ' · défini dans cPanel' : ''}</span>`
  : html`<span class="pill off">Désactivé</span>`);

export function trackingPage({ assets, tracking, pixels, errors = {}, notice }) {
  const field = ({ name, label, placeholder, help, state }) => html`<div class="pixel">
    <label>${label} ${state ?? ''}<input name="${name}" value="${tracking[name] ?? ''}" placeholder="${placeholder}" autocomplete="off" spellcheck="false" dir="ltr"></label>
    ${errors[name] ? html`<p class="notice err small">${errors[name]}</p>` : ''}
    <p class="muted small">${help}</p>
  </div>`;
  const body = html`<div class="head"><h1>Publicité · pixels de suivi</h1></div>
  <p class="muted">Collez l’identifiant, ou tout le code fourni par Meta, TikTok ou Google : le tableau de bord en extrait l’identifiant. Laissez un champ vide pour désactiver (ou pour garder la valeur de cPanel s’il y en a une). Le changement s’applique immédiatement, sans redéploiement.</p>
  <form class="card form" method="post" action="/admin/publicite">
    ${field({ name: 'meta', label: 'Meta (Facebook & Instagram) · Pixel ID', placeholder: '1234567890123456', state: pixelState(pixels.meta), help: 'Meta Business Suite → Gestionnaire d’événements → Sources de données → votre pixel → Paramètres : « ID du pixel ».' })}
    ${field({ name: 'tiktok', label: 'TikTok · Pixel ID', placeholder: 'C4ABCDEFGHIJKLMNOPQR', state: pixelState(pixels.tiktok), help: 'TikTok Ads Manager → Outils → Événements → Événements web → votre pixel : l’identifiant sous son nom.' })}
    ${field({ name: 'ga', label: 'Google Analytics 4 · ID de mesure', placeholder: 'G-XXXXXXXXXX', state: pixelState(pixels.ga), help: 'Google Analytics → Admin → Flux de données → votre site : « ID de mesure ».' })}
    <div class="cols">
      ${field({ name: 'adsId', label: 'Google Ads · ID de conversion (facultatif)', placeholder: 'AW-123456789', state: pixelState(pixels.ads), help: 'Google Ads → Objectifs → Conversions → votre action « Achat » → Configurer la balise → Google tag : AW-….' })}
      ${field({ name: 'adsLabel', label: 'Google Ads · étiquette de conversion « Achat »', placeholder: 'AbCdEfGhIjKlMnOp', help: 'Dans le même écran : la partie après la barre oblique de « AW-123456789/AbCdEf… ». Vous pouvez aussi coller AW-…/… dans le champ précédent.' })}
    </div>
    <div class="bar"><button class="btn" type="submit">Enregistrer</button></div>
  </form>
  <div class="card events">
    <h2>Ce que le site envoie</h2>
    <table class="table"><thead><tr><th>Quand</th><th>Meta</th><th>TikTok</th><th>Google</th></tr></thead><tbody>
      <tr><td>Chaque page</td><td>PageView</td><td>page</td><td>page_view</td></tr>
      <tr><td>Page d’un article</td><td>ViewContent</td><td>ViewContent</td><td>view_item</td></tr>
      <tr><td>Ajout au panier</td><td>AddToCart</td><td>AddToCart</td><td>add_to_cart</td></tr>
      <tr><td>Envoi du formulaire de commande</td><td>InitiateCheckout</td><td>InitiateCheckout</td><td>begin_checkout</td></tr>
      <tr><td>Commande reçue (page « merci »)</td><td>Purchase</td><td>CompletePayment</td><td>purchase + conversion Google Ads</td></tr>
      <tr><td>« Prévenez-moi » d’un lancement</td><td>Lead</td><td>SubmitForm</td><td>generate_lead</td></tr>
    </tbody></table>
    <p class="muted small">Montants en dinars (DZD). Une commande renvoyée deux fois n’est comptée qu’une fois. Pour vérifier : extensions Chrome « Meta Pixel Helper », « TikTok Pixel Helper » et « Tag Assistant » de Google, puis ouvrez le site.</p>
  </div>`;
  return page({ title: 'Publicité', body, active: 'ads', notice, error: Object.keys(errors).length ? 'Corrigez les champs signalés.' : '', assets });
}

export const statsPage = ({ assets, body }) => page({ title: 'Statistiques', body, active: 'stats', assets });
