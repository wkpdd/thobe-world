import { landingPageFrame, hasLandingPage } from '@h47io/sync-receiver';
import { launchBox } from './launch.js';
import { html, raw, jsonForScript } from '../html.js';
import { t } from '../i18n.js';
import { categoryName, colorLabel, description, highlights, name, productPath } from '../catalogue.js';
import { imageSet } from '../images.js';
import { layout } from './layout.js';
import { crumbs, grid, money, photo, savePercent } from './parts.js';
import { orderForm } from './pages.js';

/** Default size guide for numbered qamis sizes. THE OWNER MUST CONFIRM THESE MEASUREMENTS. */
const QAMIS_GUIDE = {
  52: ['165–170', '140', '52'],
  54: ['170–175', '145', '54'],
  56: ['175–180', '150', '56'],
  58: ['180–185', '155', '58'],
  60: ['185–190', '160', '60'],
  62: ['190–195', '165', '62'],
};

export function productPage(ctx, product, related) {
  const { lang, config } = ctx;
  const s = t(lang);
  const title = name(product, lang);
  const desc = description(product, lang);
  const points = highlights(product, lang);
  const save = savePercent(product);
  const firstColour = product.colors.find((c) => c.stock > 0) ?? product.colors[0] ?? null;
  const startPhotos = (firstColour?.photos.length ? firstColour.photos : product.gallery).slice(0, 8);
  const guideRows = product.sizes.filter((z) => QAMIS_GUIDE[z]);
  // An exclusive launch: before its hour the order form gives way to a countdown and « notify me ».
  const found = ctx.content?.launchFor(product.externalId) ?? null;
  const locked = found?.state === 'upcoming';
  const live = found?.state === 'live' ? found.launch : null;
  const landing = hasLandingPage(product.landingHtml) ? landingPageFrame(product.landingHtml, { title: product.nameFr, height: '120vh' }) : '';

  // Everything the browser needs to draw the selector: no stock is trusted from here, the server re-checks.
  const model = {
    externalId: product.externalId,
    name: title,
    price: product.price,
    priceNumber: product.priceNumber,
    isModel: product.isModel,
    stock: product.stock,
    limited: Boolean(live?.limited),
    maxPerCustomer: live?.maxPerCustomer ?? null,
    sizes: product.sizes,
    grid: product.grid,
    url: productPath(product),
    cover: product.cover,
    gallery: product.gallery.map((p) => imageSet(p, { max: 1280, sizes: '(min-width:960px) 560px, 100vw' })),
    colors: product.colors.map((c) => ({
      value: c.value,
      label: colorLabel(c, lang),
      hex: c.hex,
      stock: c.stock,
      photos: c.photos.map((p) => imageSet(p, { max: 1280, sizes: '(min-width:960px) 560px, 100vw' })),
    })),
  };

  const body = html`<div class="wrap">
  ${crumbs([{ href: '/', label: s.home }, product.category ? { href: `/c/${encodeURIComponent(product.category)}`, label: categoryName(product, lang) } : null, { label: title }].filter(Boolean))}
  <div class="pd" data-product>
    <div class="gallery">
      <div class="main">${product.badges.length || save > 0 || locked || live?.limited ? html`<div class="badges">${locked ? html`<span class="badge launch">${s.launch.soon}</span>` : live?.limited ? html`<span class="badge launch">${s.launch.limited}</span>` : ''}${save > 0 ? html`<span class="badge gold" dir="ltr">−${save}%</span>` : ''}${product.badges.slice(0, 3).map((b) => html`<span class="badge">${b}</span>`)}</div>` : ''}<span data-main-photo>${photo(startPhotos[0], title, { sizes: '(min-width:960px) 560px, 100vw', max: 1280, eager: true })}</span></div>
      <div class="thumbs" data-thumbs>${startPhotos.length > 1 ? startPhotos.map((p, i) => html`<button type="button" aria-pressed="${i === 0}" data-thumb="${i}" aria-label="${title} ${i + 1}">${photo(p, '', { max: 320, sizes: '72px' })}</button>`) : ''}</div>
    </div>
    <div class="buy">
      <span class="eyebrow">${categoryName(product, lang)}</span>
      <h1>${title}</h1>
      ${product.sku ? html`<p class="sub" dir="ltr" style="text-align:start">${product.sku}</p>` : ''}
      <div class="pprice"><b data-price>${money(product.price, lang)}</b>${product.compareAt ? html`<s>${money(product.compareAt, lang)}</s><span class="save">${s.save} ${money(String(Number(product.compareAt) - product.priceNumber), lang)}</span>` : ''}</div>
      ${product.colors.length ? html`<fieldset class="opt"><legend>${s.color} <span data-color-name>${firstColour ? colorLabel(firstColour, lang) : ''}</span></legend>
        <div class="swatches" role="group" aria-label="${s.chooseColor}">${product.colors.map((c) => html`<button type="button" class="sw${c.stock > 0 ? '' : ' out'}" data-color="${c.value}" aria-pressed="${c === firstColour}" aria-label="${colorLabel(c, lang)}${c.stock > 0 ? '' : ` — ${s.soldOut}`}" title="${colorLabel(c, lang)}"><span class="fill${c.hex ? '' : ' none'}"${c.hex ? html` style="background:${c.hex}"` : ''}></span></button>`)}</div>
      </fieldset>` : ''}
      ${product.sizes.length ? html`<fieldset class="opt"><legend>${s.size} ${guideRows.length ? html`<a href="#guide">${s.sizeGuide}</a>` : ''}</legend>
        <div class="sizes" role="group" aria-label="${s.chooseSize}">${product.sizes.map((z) => html`<button type="button" class="sz" data-size="${z}" aria-pressed="false">${z}</button>`)}</div>
      </fieldset>` : ''}
      ${locked ? launchBox(ctx, found.launch) : html`<div class="stock" data-stock aria-live="polite"></div>
      ${live?.maxPerCustomer ? html`<p class="muted small">${s.launch.maxPer(live.maxPerCustomer)}</p>` : ''}
      <div class="qty-row" style="margin-top:14px">
        <span>${s.quantity}</span>
        <div class="qty"><button type="button" data-qty="-1" aria-label="−">−</button><output data-qty-value>1</output><button type="button" data-qty="1" aria-label="+">+</button></div>
      </div>
      <div class="buy-row">
        <button class="btn btn-ink" type="button" data-add-to-cart>${s.addToCart}</button>
        <a class="btn btn-gold" href="#orderForm" data-scroll-order>${s.orderNow}</a>
      </div>
      ${orderForm(ctx, { submitLabel: s.buyNowCod })}`}
      <div class="feat">${s.features.map(([i, b, small]) => html`<div><i aria-hidden="true">${i}</i><span><b>${b}</b><small>${small}</small></span></div>`)}</div>
    </div>
  </div>
</div>
${desc || points.length ? html`<section class="block"><div class="wrap story${product.gallery[1] ? '' : ' no-img'}">
  ${product.allPhotos[1] ? html`<div class="img">${photo(product.allPhotos[1], title, { sizes: '(min-width:900px) 50vw, 100vw', max: 960 })}</div>` : ''}
  <div>
    <span class="eyebrow">${s.description}</span>
    <h2>${title}</h2>
    ${desc ? html`<p>${desc}</p>` : ''}
    ${points.length ? html`<ul>${points.map((p) => html`<li>${p}</li>`)}</ul>` : ''}
  </div>
</div></section>` : ''}
${product.specs.length ? html`<section class="block" style="padding-top:0"><div class="wrap narrow"><h2 class="display" style="font-size:1.5rem;margin-bottom:10px">${s.details}</h2><table class="specs"><tbody>${product.specs.map(([k, v]) => html`<tr><th scope="row">${k}</th><td>${v}</td></tr>`)}</tbody></table></div></section>` : ''}
${landing ? html`<section class="block" style="padding-top:0"><div class="wrap">${raw(landing)}</div></section>` : ''}
${guideRows.length ? html`<section class="block" id="guide" style="padding-top:0"><div class="wrap narrow">
  <h2 class="display" style="font-size:1.5rem;margin-bottom:10px">${s.sizeGuide}</h2>
  <div class="table-scroll"><table class="guide"><thead><tr><th>${s.size}</th><th>${lang === 'fr' ? 'Votre taille (cm)' : 'طولك (سم)'}</th><th>${lang === 'fr' ? 'Longueur (cm)' : 'طول القميص (سم)'}</th></tr></thead>
  <tbody>${guideRows.map((z) => html`<tr><td><b>${z}</b></td><td dir="ltr">${QAMIS_GUIDE[z][0]}</td><td>${QAMIS_GUIDE[z][1]}</td></tr>`)}</tbody></table></div>
</div></section>` : ''}
${related.length ? html`<section class="block" style="padding-top:0"><div class="wrap"><div class="sec-head"><div class="rule">◆</div><h2>${related.some((p) => p.category !== product.category) ? s.completeLook : s.youMayLike}</h2></div>${grid(related, lang, 0, ctx.content)}</div></section>` : ''}
<section class="block" style="padding-top:0"><div class="wrap narrow">
  <h2 class="display" style="font-size:1.5rem;margin-bottom:10px">${s.faq}</h2>
  ${s.faqs.map(([q, a]) => html`<details class="faq"><summary>${q}</summary><p>${a}</p></details>`)}
</div></section>
<div class="sticky-cta">
  <div class="p"><b>${money(product.price, lang)}</b>${product.compareAt ? html`<small><s>${money(product.compareAt, lang)}</s></small>` : ''}</div>
  ${locked ? html`<a class="btn btn-gold" href="#notify" data-scroll-order>${s.launch.notifyButton}</a>` : html`<a class="btn btn-gold" href="#orderForm" data-scroll-order>${s.orderNow}</a>`}
</div>
<script>window.TW_PRODUCT=${jsonForScript(model)};window.TW_DELIVERY=${jsonForScript(ctx.deliveryOptions)};window.TW_MODE="product";</script>`;

  const url = `${config.siteUrl}${productPath(product)}`;
  const imageUrl = product.cover ? (imageSet(product.cover, { max: 1280 })?.src ?? null) : null;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: title,
    sku: product.sku || undefined,
    description: desc || undefined,
    image: product.allPhotos.slice(0, 5).map((p) => `${config.siteUrl}${imageSet(p, { max: 1280 }).src}`),
    brand: { '@type': 'Brand', name: config.shop.nameFr },
    category: categoryName(product, lang) || undefined,
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: 'DZD',
      price: String(product.priceNumber),
      availability: locked ? 'https://schema.org/PreOrder' : product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
    },
  };
  return layout(ctx, {
    title,
    description: (desc || `${title} — ${config.shop.nameAr}`).slice(0, 160),
    body,
    canonical: productPath(product),
    image: imageUrl,
    jsonLd,
    bodyClass: 'is-product',
    pageScripts: locked ? ['js/product.js', 'js/launch.js'] : ['delivery-checkout.js', 'js/order.js', 'js/product.js'],
    pixelEvents: [{ name: 'ViewContent', value: product.priceNumber, currency: 'DZD', id: product.externalId, contentName: product.nameFr }],
  });
}
