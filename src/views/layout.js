import { html, raw, jsonForScript } from '../html.js';
import { t, clientStrings } from '../i18n.js';
import { categoryName } from '../catalogue.js';
import { announceHtml } from '../settings.js';

const ICONS = {
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  whatsapp: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3a13 13 0 0 0-11.2 19.6L3 29l6.6-1.7A13 13 0 1 0 16 3Zm0 23.6c-2 0-4-.6-5.7-1.6l-.4-.2-3.9 1 1-3.8-.3-.4A10.6 10.6 0 1 1 16 26.6Zm5.8-7.9c-.3-.2-1.9-.9-2.2-1-.3-.1-.5-.2-.7.2l-1 1.2c-.2.2-.4.2-.7.1a8.7 8.7 0 0 1-4.3-3.8c-.3-.6.3-.5.9-1.7.1-.2 0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6a1.2 1.2 0 0 0-.9.4 3.6 3.6 0 0 0-1.1 2.7c0 1.6 1.2 3.1 1.3 3.3.2.2 2.3 3.5 5.5 4.9 2 .9 2.8 1 3.8.8.6-.1 1.9-.8 2.2-1.5.3-.7.3-1.4.2-1.5-.1-.2-.3-.3-.6-.4Z"/></svg>',
};

export const icon = (name) => raw(ICONS[name]);

/** The page around every view. */
export function layout(ctx, { title, description, body, canonical, image, jsonLd, pageScripts = [], bodyClass = '', noindex = false, pixelEvents = [] }) {
  const { lang, config, assets, catalogue, path } = ctx;
  const s = t(lang);
  const shop = config.shop;
  const shopName = lang === 'fr' ? shop.nameFr : shop.nameAr;
  const fullTitle = title ? `${title} · ${shopName}` : `${shopName} · ${lang === 'fr' ? shop.sloganFr : shop.sloganAr}`;
  const desc = description || (lang === 'fr' ? shop.taglineFr : shop.taglineAr);
  const url = `${config.siteUrl}${canonical ?? path}`;
  const ogImage = image ? `${config.siteUrl}${image}` : `${config.siteUrl}/img/og.jpg`;
  const cats = catalogue.snapshot().categories;
  const other = lang === 'fr' ? 'ar' : 'fr';
  const switchHref = `${path}${path.includes('?') ? '&' : '?'}lang=${other}`;
  const pixels = config.pixels;

  return html`<!doctype html>
<html lang="${lang}" dir="${s.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${fullTitle}</title>
<meta name="description" content="${desc}">
${noindex ? raw('<meta name="robots" content="noindex">') : ''}
<link rel="canonical" href="${url}">
<meta name="theme-color" content="#FBF8F2">
<meta property="og:type" content="${jsonLd?.['@type'] === 'Product' ? 'product' : 'website'}">
<meta property="og:site_name" content="${shopName}">
<meta property="og:title" content="${fullTitle}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${ogImage}">
<meta property="og:locale" content="${lang === 'fr' ? 'fr_DZ' : 'ar_DZ'}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" sizes="32x32" href="/img/favicon-32.png">
<link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
<link rel="preload" href="${assets.url(`fonts/Tajawal-400-${lang === 'fr' ? 'latin' : 'arabic'}.woff2`)}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${assets.url('fonts/fonts.css')}">
<link rel="stylesheet" href="${assets.url('css/site.css')}">
${jsonLd ? html`<script type="application/ld+json">${jsonForScript(jsonLd)}</script>` : ''}
${pixels.meta ? raw(`<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${JSON.stringify(pixels.meta)});fbq('track','PageView');</script>`) : ''}
${pixels.tiktok ? raw(`<script>!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.load=function(e){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load(${JSON.stringify(pixels.tiktok)});ttq.page();}(window,document,'ttq');</script>`) : ''}
${pixels.ga ? raw(`<script async src="https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(pixels.ga)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config',${JSON.stringify(pixels.ga)});</script>`) : ''}
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">${lang === 'fr' ? 'Aller au contenu' : 'انتقل إلى المحتوى'}</a>
${ctx.settings.announce[lang] ? html`<div class="announce">${announceHtml(ctx.settings.announce[lang])}</div>` : ''}
<header class="site">
  <div class="wrap">
    <div class="hbar">
      <div class="start">
        <button class="icon menu-btn" type="button" data-open-drawer aria-label="${s.menu}">${icon('menu')}</button>
        <button class="icon" type="button" data-toggle-search aria-label="${s.search}">${icon('search')}</button>
      </div>
      <a class="logo" href="/" aria-label="${shopName}"><img src="/img/logo-ink.webp" alt="${shop.nameAr} · ${shop.nameFr}" width="46" height="52"></a>
      <div class="end">
        <a class="icon" href="${switchHref}" hreflang="${other}" lang="${other}" data-lang-switch>${other === 'fr' ? 'FR' : 'ع'}</a>
        <a class="icon" href="/panier" aria-label="${s.cart}">${icon('bag')}<span class="dot" data-cart-count data-count="0">0</span></a>
      </div>
    </div>
    <div class="searchbar" data-searchbar>
      <form action="/recherche" role="search"><input class="in" type="search" name="q" placeholder="${s.searchPlaceholder}" aria-label="${s.search}"><button class="btn btn-ink" type="submit">${s.search}</button></form>
    </div>
    <nav class="nav" aria-label="${s.categories}">
      <a href="/boutique"${path.startsWith('/boutique') ? raw(' aria-current="page"') : ''}>${s.shopAll}</a>
      ${cats.map((c) => html`<a href="/c/${encodeURIComponent(c.slug)}"${path.startsWith(`/c/${c.slug}`) ? raw(' aria-current="page"') : ''}>${categoryName(c, lang)}</a>`)}
      <a href="/suivi">${s.track}</a>
    </nav>
  </div>
</header>
<div class="drawer" data-drawer>
  <div class="scrim" data-close-drawer></div>
  <nav aria-label="${s.menu}">
    <a href="/">${s.home}</a>
    <a href="/boutique">${s.shopAll}</a>
    ${cats.map((c) => html`<a href="/c/${encodeURIComponent(c.slug)}">${categoryName(c, lang)}</a>`)}
    <a href="/suivi">${s.track}</a>
    <a href="/page/contact">${s.contact}</a>
  </nav>
</div>
<main id="main">
${body}
</main>
${footer(ctx)}
<a class="wa-float" href="https://wa.me/${shop.whatsapp}" target="_blank" rel="noopener" aria-label="${s.whatsappUs}">${icon('whatsapp')}</a>
<div class="toast" role="status" aria-live="polite" data-toast></div>
<script>window.TW=${jsonForScript({ lang, s: clientStrings(lang), pixels: { meta: !!pixels.meta, tiktok: !!pixels.tiktok, ga: !!pixels.ga }, events: pixelEvents })};</script>
<script src="${assets.url('js/site.js')}" defer></script>
${pageScripts.map((src) => html`<script src="${assets.url(src)}" defer></script>`)}
</body>
</html>`;
}

function footer(ctx) {
  const { lang, config } = ctx;
  const s = t(lang);
  const shop = config.shop;
  const year = new Date().getFullYear();
  return html`<footer class="site">
  <div class="wrap">
    <div class="cols">
      <div class="brand">
        <img src="/img/logo-ink.webp" alt="" width="46" height="52" loading="lazy" style="height:52px;width:auto;margin-bottom:8px">
        <b class="display" style="color:var(--ink);font-size:1.2rem">${shop.nameAr} · <span class="latin" style="font-size:.85rem">${shop.nameFr}</span></b>
        <p style="margin:6px 0">${lang === 'fr' ? shop.sloganFr : shop.sloganAr} — ${s.footerAbout}</p>
        <p>📍 ${lang === 'fr' ? shop.addressFr : shop.addressAr}</p>
        <div class="carriers"><span class="carrier-pill">Noest</span><span class="carrier-pill">Yalidine</span><span class="carrier-pill">${lang === 'fr' ? 'Paiement à la livraison' : 'الدفع عند الاستلام'}</span></div>
      </div>
      <div>
        <h4>${s.help}</h4>
        <ul>
          <li><a href="/suivi">${s.track}</a></li>
          <li><a href="/page/livraison">${s.shippingPolicy}</a></li>
          <li><a href="/page/echanges">${s.returns}</a></li>
          <li><a href="/page/contact">${s.contact}</a></li>
        </ul>
      </div>
      <div>
        <h4>${s.about}</h4>
        <ul>
          <li><a href="/page/a-propos">${s.about}</a></li>
          <li><a href="/page/conditions">${s.terms}</a></li>
          <li><a href="/page/confidentialite">${s.privacy}</a></li>
        </ul>
      </div>
      <div>
        <h4>${s.followUs}</h4>
        <ul>
          <li><a href="tel:${shop.phone}" dir="ltr">📞 ${shop.phoneDisplay}</a></li>
          <li><a href="https://wa.me/${shop.whatsapp}" target="_blank" rel="noopener">WhatsApp</a></li>
          ${shop.instagram ? html`<li><a href="https://instagram.com/${shop.instagram}" target="_blank" rel="noopener" dir="ltr">Instagram @${shop.instagram}</a></li>` : ''}
          <li>${shop.facebook ? html`<a href="${shop.facebook}" target="_blank" rel="noopener">Facebook · ${shop.facebookName}</a>` : html`Facebook · ${shop.facebookName}`}</li>
        </ul>
      </div>
    </div>
    <div class="legal">
      <span>© ${year} ${shop.nameAr} · ${shop.nameFr} — ${s.rights}</span>
      ${shop.rc || shop.nif ? html`<span>${shop.rc ? `RC : ${shop.rc}` : ''}${shop.rc && shop.nif ? ' · ' : ''}${shop.nif ? `NIF : ${shop.nif}` : ''}</span>` : ''}
    </div>
  </div>
</footer>`;
}
