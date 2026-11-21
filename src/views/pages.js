import { html, raw, jsonForScript } from '../html.js';
import { t } from '../i18n.js';
import { categoryName, colorLabel } from '../catalogue.js';
import { layout } from './layout.js';
import { crumbs, grid, money, photo } from './parts.js';
import { POLICIES } from './policies.js';

export function homePage(ctx) {
  const { lang, config, catalogue } = ctx;
  const s = t(lang);
  const shop = config.shop;
  const { products, categories } = catalogue.snapshot();
  const featured = products.filter((p) => p.stock > 0).sort((a, b) => b.id - a.id).slice(0, 8);
  const body = html`
<section class="hero">
  <div class="wrap">
    <div>
      <span class="eyebrow">${shop.nameAr} · ${shop.nameFr}</span>
      <h1>${lang === 'fr' ? html`Élégant<br><em>comme un roi</em>` : html`تأنق<br><em>كأنك ملك</em>`}</h1>
      <p>${lang === 'fr' ? shop.taglineFr : shop.taglineAr}</p>
      <div class="ctas">
        <a class="btn btn-ink" href="/boutique">${s.shopAll}</a>
        ${categories[0] ? html`<a class="btn btn-line" href="/c/${encodeURIComponent(categories[0].slug)}">${categoryName(categories[0], lang)}</a>` : ''}
      </div>
      <div class="trust">${s.features.map(([i, b]) => html`<div><i aria-hidden="true">${i}</i>${b}</div>`)}</div>
    </div>
    <div class="hero-art"><img src="/img/logo-gold.webp" alt="" width="440" height="498" fetchpriority="high"></div>
  </div>
</section>
${categories.length ? html`<section class="block"><div class="wrap">
  <div class="sec-head"><div class="rule">◆</div><h2>${s.categories}</h2></div>
  <div class="cats">${categories.map((c) => {
    const cover = products.find((p) => p.category === c.slug && p.cover)?.cover;
    return html`<a class="cat" href="/c/${encodeURIComponent(c.slug)}">${cover ? photo(cover, '', { sizes: '(min-width:900px) 25vw, 50vw', max: 720 }) : html`<span class="ph-logo"><img src="/img/logo-gold.webp" alt="" width="440" height="498" loading="lazy"></span>`}<span class="lbl"><b>${categoryName(c, lang)}</b><span>${s.products(c.count)}</span></span></a>`;
  })}</div>
</div></section>` : ''}
<section class="block"><div class="wrap">
  <div class="sec-head"><div class="rule">◆</div><h2>${s.featured}</h2></div>
  ${featured.length ? grid(featured, lang, 2) : html`<p class="empty">${lang === 'fr' ? 'Le catalogue arrive bientôt.' : 'المنتجات قادمة قريباً.'}</p>`}
  ${products.length > featured.length ? html`<div class="sec-more"><a class="btn btn-line" href="/boutique">${s.viewAll}</a></div>` : ''}
</div></section>
<section class="block"><div class="wrap">
  <div class="band">
    <h2>${lang === 'fr' ? shop.sloganFr : shop.sloganAr}</h2>
    <p>${lang === 'fr' ? 'Une question sur une taille ou un parfum ? Écrivez-nous, nous répondons vite.' : 'سؤال عن مقاس أو عطر؟ راسلنا وسنرد عليك بسرعة.'}</p>
    <a class="btn btn-gold" href="https://wa.me/${shop.whatsapp}" target="_blank" rel="noopener">${s.whatsappUs}</a>
  </div>
</div></section>`;
  return layout(ctx, {
    body,
    canonical: '/',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'ClothingStore',
      name: `${shop.nameAr} · ${shop.nameFr}`,
      url: config.siteUrl,
      telephone: shop.phone,
      image: `${config.siteUrl}/img/og.jpg`,
      address: { '@type': 'PostalAddress', streetAddress: shop.addressFr, addressCountry: 'DZ' },
      sameAs: shop.instagram ? [`https://instagram.com/${shop.instagram}`] : [],
    },
  });
}

/** /boutique, /c/:slug and /recherche share one listing. */
export function listingPage(ctx, { title, heading, items, crumbsItems, query = {}, canonical, showFilters = true, searchQuery = null, all = [] }) {
  const { lang, catalogue } = ctx;
  const s = t(lang);
  const { categories } = catalogue.snapshot();
  const colours = [...new Map(all.flatMap((p) => p.colors).map((c) => [c.labelFr, c])).values()];
  const sizes = [...new Set(all.flatMap((p) => p.sizes))];
  const body = html`<div class="wrap">
  ${crumbs(crumbsItems)}
  <div class="list-head"><h1>${heading}</h1><span class="muted">${s.products(items.length)}</span></div>
  ${searchQuery !== null ? html`<form class="filters" action="/recherche" role="search"><input class="in" style="flex:1" type="search" name="q" value="${searchQuery}" placeholder="${s.searchPlaceholder}" aria-label="${s.search}"><button class="btn btn-ink" type="submit">${s.search}</button></form>` : ''}
  ${showFilters ? html`<div class="chips"><a class="chip" href="/boutique"${canonical === '/boutique' ? raw(' aria-current="page"') : ''}>${s.all}</a>${categories.map((c) => html`<a class="chip" href="/c/${encodeURIComponent(c.slug)}"${canonical === `/c/${c.slug}` ? raw(' aria-current="page"') : ''}>${categoryName(c, lang)}</a>`)}</div>
  <form class="filters" method="get">
    ${colours.length ? html`<select class="in" name="couleur" aria-label="${s.color}"><option value="">${s.color}</option>${colours.map((c) => html`<option value="${c.labelFr}"${query.couleur === c.labelFr ? raw(' selected') : ''}>${colorLabel(c, lang)}</option>`)}</select>` : ''}
    ${sizes.length ? html`<select class="in" name="taille" aria-label="${s.size}"><option value="">${s.size}</option>${sizes.map((z) => html`<option${query.taille === z ? raw(' selected') : ''}>${z}</option>`)}</select>` : ''}
    <select class="in" name="tri" aria-label="${s.sort}">
      <option value="">${s.sortNew}</option>
      <option value="price_asc"${query.tri === 'price_asc' ? raw(' selected') : ''}>${s.sortPriceAsc}</option>
      <option value="price_desc"${query.tri === 'price_desc' ? raw(' selected') : ''}>${s.sortPriceDesc}</option>
    </select>
    <label><input type="checkbox" name="stock" value="1"${query.stock === '1' ? raw(' checked') : ''}> ${s.onlyInStock}</label>
    <button class="btn btn-ink" type="submit" style="padding:8px 18px;min-height:40px">${s.apply}</button>
  </form>` : ''}
  ${items.length ? grid(items, lang, 4) : html`<p class="empty">${s.noResults}</p>`}
</div>`;
  return layout(ctx, { title, body, canonical, noindex: searchQuery !== null || Object.values(query).some(Boolean) });
}

export function cartPage(ctx) {
  const { lang } = ctx;
  const s = t(lang);
  const body = html`<div class="wrap narrow">
  ${crumbs([{ href: '/', label: s.home }, { label: s.cartTitle }])}
  <h1 class="page-title">${s.cartTitle}</h1>
  <div class="panel" data-cart-view><p class="muted">…</p></div>
  <div class="sum panel" style="margin-top:14px" data-cart-sum hidden>
    <div class="tot"><span>${s.subtotal}</span><b data-cart-subtotal></b></div>
    <p class="muted" style="font-size:.86rem">${s.shipping}: ${lang === 'fr' ? 'calculée à l’étape suivante' : 'يُحسب في الخطوة التالية'}</p>
    <a class="btn btn-gold btn-block" href="/commande" style="margin-top:12px" data-cart-checkout>${s.checkout}</a>
  </div>
  <p style="margin-top:14px;text-align:center"><a href="/boutique">${s.continueShopping}</a></p>
</div>`;
  return layout(ctx, { title: s.cartTitle, body, noindex: true, pageScripts: ['js/cart.js'] });
}

/** The order form, shared by the product page (one line) and /commande (the cart). */
export function orderForm(ctx, { id = 'orderForm', heading = true, submitLabel } = {}) {
  const { lang } = ctx;
  const s = t(lang);
  return html`<form class="order f" id="${id}" data-order-form novalidate>
  ${heading ? html`<h2>${s.orderFormTitle}</h2><p class="hint">${s.orderFormSub}</p>` : ''}
  <div class="form-error" role="alert" data-form-error></div>
  <label class="fld">${s.fullName}<input class="in" name="fullName" autocomplete="name" required minlength="3" maxlength="80"><span class="ferr" data-err="fullName"></span></label>
  <label class="fld">${s.phone}<input class="in" name="phone" type="tel" inputmode="tel" autocomplete="tel" dir="ltr" placeholder="${s.phoneHint}" required maxlength="20"><span class="ferr" data-err="phone"></span></label>
  <div class="h47d" data-delivery></div>
  <span class="ferr" data-err="wilaya"></span>
  <label class="fld">${s.commune}<select class="in" name="commune" required disabled data-commune><option value="">${s.chooseCommune}</option></select><span class="ferr" data-err="commune"></span></label>
  <label class="fld">${s.address}<input class="in" name="address" autocomplete="street-address" maxlength="200"></label>
  <label class="fld">${s.notes}<input class="in" name="notes" maxlength="300"></label>
  <span class="ferr" data-err="delivery"></span>
  <div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
  <div class="sum" data-summary>
    <div><span>${s.subtotal}</span><span data-sum-sub>—</span></div>
    <div><span>${s.shipping}</span><span data-sum-ship>—</span></div>
    <div class="tot"><span>${s.total}</span><span data-sum-total>—</span></div>
  </div>
  <button class="btn btn-gold btn-block" type="submit" data-submit>${submitLabel ?? s.confirmOrder}</button>
  <p class="cod">🔒 ${s.secureNote}</p>
</form>`;
}

export function checkoutPage(ctx, { deliveryOptions }) {
  const { lang } = ctx;
  const s = t(lang);
  const body = html`<div class="wrap">
  ${crumbs([{ href: '/', label: s.home }, { href: '/panier', label: s.cartTitle }, { label: s.checkoutTitle }])}
  <h1 class="page-title">${s.checkoutTitle}</h1>
  <div class="co">
    <div>${orderForm(ctx, { heading: false })}</div>
    <aside class="panel"><h2 class="display" style="font-size:1.3rem;margin-bottom:6px">${s.yourOrder}</h2><div data-cart-view data-readonly><p class="muted">…</p></div></aside>
  </div>
</div>
<script>window.TW_DELIVERY=${jsonForScript(deliveryOptions)};window.TW_MODE="cart";</script>`;
  return layout(ctx, { title: s.checkoutTitle, body, noindex: true, pageScripts: ['delivery-checkout.js', 'js/order.js', 'js/cart.js'] });
}

function orderLines(summary, lang) {
  return summary.lines.map((l) => html`<div class="line">
    <div class="th">${photo(l.product?.cover, '', { max: 320, sizes: '72px' })}</div>
    <div><h3>${lang === 'fr' ? l.nameFr : l.nameAr}</h3><small>${[lang === 'fr' ? l.colorFr : l.colorAr, l.size].filter(Boolean).join(' · ')} × ${l.quantity}</small></div>
    <b>${money(l.total, lang)}</b>
  </div>`);
}

function totals(summary, lang) {
  const s = t(lang);
  return html`<div class="sum">
    <div><span>${s.subtotal}</span><span>${money(summary.subtotal, lang)}</span></div>
    <div><span>${s.shipping}${summary.carrierLabel ? ` (${summary.carrierLabel})` : ''}</span><span>${summary.fee === null ? s.shippingTbd : Number(summary.fee) === 0 ? (lang === 'fr' ? 'Gratuite' : 'مجاني') : money(summary.fee, lang)}</span></div>
    <div class="tot"><span>${s.total}</span><span>${money(summary.total, lang)}</span></div>
  </div>`;
}

export function thanksPage(ctx, summary, { duplicate = false } = {}) {
  const { lang } = ctx;
  const s = t(lang);
  const body = html`<div class="wrap narrow">
  <div class="done">
    <div class="ok" aria-hidden="true">✓</div>
    <h1 class="page-title">${s.thanksTitle}</h1>
    ${duplicate ? html`<p class="pill">${s.duplicate}</p>` : ''}
    <p class="muted">${s.thanksSub}</p>
    <div>${s.orderRef}</div><div class="ref" data-order-ref>${summary.orderGroup}</div>
    <p class="muted" style="font-size:.88rem">${s.keepRef}</p>
  </div>
  <div class="panel">${orderLines(summary, lang)}${totals(summary, lang)}</div>
  <p style="text-align:center;margin-top:18px"><a class="btn btn-line" href="/suivi?ref=${encodeURIComponent(summary.orderGroup)}">${s.track}</a></p>
</div>
<script>try{localStorage.removeItem('tw_cart')}catch(e){}</script>`;
  const value = Number(summary.total);
  return layout(ctx, {
    title: s.thanksTitle,
    body,
    noindex: true,
    pixelEvents: duplicate ? [] : [{ name: 'Purchase', value, currency: 'DZD', id: summary.orderGroup }],
  });
}

export function trackPage(ctx, { reference = '', phone = '', summary = null, searched = false }) {
  const { lang } = ctx;
  const s = t(lang);
  const parcel = summary?.parcel;
  const body = html`<div class="wrap narrow">
  ${crumbs([{ href: '/', label: s.home }, { label: s.trackTitle }])}
  <h1 class="page-title">${s.trackTitle}</h1>
  <form class="panel f" method="get" action="/suivi">
    <p class="muted">${s.trackSub}</p>
    <div class="two">
      <label class="fld">${s.orderRef}<input class="in" name="ref" value="${reference}" dir="ltr" required placeholder="WEB-123"></label>
      <label class="fld">${s.phone}<input class="in" name="phone" value="${phone}" type="tel" dir="ltr" required></label>
    </div>
    <button class="btn btn-ink" type="submit">${s.trackButton}</button>
  </form>
  ${searched && !summary ? html`<p class="form-error show" style="margin-top:14px" role="alert">${s.trackNotFound}</p>` : ''}
  ${summary ? html`<div class="panel status" style="margin-top:14px" data-track-result>
    <div class="row"><span>${s.orderRef}</span><b dir="ltr">${summary.orderGroup}</b></div>
    <div class="row"><span>${s.orderStatus}</span><span class="pill" data-order-status="${summary.status}">${s.statuses[summary.status] ?? summary.status}</span></div>
    ${parcel ? html`
    <div class="row"><span>${s.carrier}</span><b>${parcel.carrier}</b></div>
    <div class="row"><span>${s.trackingNumber}</span><b dir="ltr" data-tracking-number>${parcel.url ? html`<a href="${parcel.url}" target="_blank" rel="noopener nofollow">${parcel.tracking}</a>` : parcel.tracking}</b></div>
    <div class="row"><span>${s.parcel}</span><span class="pill">${s.parcelStatuses[parcel.status] ?? parcel.status}</span></div>
    ${parcel.amount_due ? html`<div class="row"><span>${s.amountDue}</span><b>${money(parcel.amount_due, lang)}</b></div>` : ''}` : ''}
    ${orderLines(summary, lang)}${parcel?.amount_due ? '' : totals(summary, lang)}
  </div>` : ''}
</div>`;
  return layout(ctx, { title: s.trackTitle, body, noindex: true, canonical: '/suivi' });
}

export function staticPage(ctx, slug) {
  const { lang, config } = ctx;
  const page = POLICIES[slug];
  if (!page) return null;
  const content = page[lang] ?? page.ar;
  const shop = config.shop;
  const fill = (text) =>
    text
      .replaceAll('{phone}', shop.phoneDisplay)
      .replaceAll('{address}', lang === 'fr' ? shop.addressFr : shop.addressAr)
      .replaceAll('{instagram}', shop.instagram)
      .replaceAll('{name}', lang === 'fr' ? shop.nameFr : shop.nameAr);
  const body = html`<div class="wrap">
  ${crumbs([{ href: '/', label: t(lang).home }, { label: content.title }])}
  <article class="prose">
    <h1 class="page-title">${content.title}</h1>
    ${content.blocks.map(([h, ...paras]) => html`${h ? html`<h2>${fill(h)}</h2>` : ''}${paras.map((p) => (Array.isArray(p) ? html`<ul>${p.map((li) => html`<li>${fill(li)}</li>`)}</ul>` : html`<p>${fill(p)}</p>`))}`)}
    ${slug === 'contact' ? html`<p style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap"><a class="btn btn-gold" href="https://wa.me/${shop.whatsapp}" target="_blank" rel="noopener">WhatsApp</a><a class="btn btn-line" href="tel:${shop.phone}" dir="ltr">${shop.phoneDisplay}</a></p>` : ''}
  </article>
</div>`;
  return layout(ctx, { title: content.title, body, canonical: `/page/${slug}` });
}

export function notFoundPage(ctx) {
  const { lang, catalogue } = ctx;
  const s = t(lang);
  const some = catalogue.snapshot().products.filter((p) => p.stock > 0).slice(0, 4);
  const body = html`<div class="wrap" style="text-align:center;padding:50px 16px">
  <h1 class="page-title">${s.notFound}</h1>
  <p class="muted">${s.notFoundSub}</p>
  <p style="margin:20px 0"><a class="btn btn-ink" href="/">${s.backHome}</a></p>
  ${some.length ? grid(some, lang) : ''}
</div>`;
  return layout(ctx, { title: s.notFound, body, noindex: true });
}

