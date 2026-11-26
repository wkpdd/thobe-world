import { html, raw } from '../html.js';
import { t } from '../i18n.js';
import { formatMoney, name, productPath, colorLabel } from '../catalogue.js';
import { imageSet } from '../images.js';

/** A responsive <img> for a stored photo, or the logo placeholder. */
export function photo(imagePath, alt, { sizes, max, eager = false, className = '' } = {}) {
  const set = imageSet(imagePath, { sizes, max });
  if (!set) return html`<span class="noimg"><img src="/img/emblem-gold.svg" alt="" width="640" height="497" loading="lazy"></span>`;
  return html`<img src="${set.src}"${set.srcset ? html` srcset="${set.srcset}" sizes="${set.sizes}"` : ''} alt="${alt}" width="720" height="900" ${eager ? raw('fetchpriority="high"') : raw('loading="lazy"')} decoding="async"${className ? html` class="${className}"` : ''}>`;
}

export const money = (value, lang) => html`${formatMoney(value)} ${t(lang).da}`;

export function savePercent(product) {
  if (!product.compareAt) return 0;
  const was = Number(product.compareAt);
  return was > 0 ? Math.round((1 - product.priceNumber / was) * 100) : 0;
}

export function card(product, lang, { eager = false } = {}) {
  const s = t(lang);
  const title = name(product, lang);
  const save = savePercent(product);
  const badges = [];
  if (product.stock <= 0) badges.push(html`<span class="badge out">${s.soldOut}</span>`);
  else if (save > 0) badges.push(html`<span class="badge gold" dir="ltr">−${save}%</span>`);
  for (const b of product.badges.slice(0, 2)) badges.push(html`<span class="badge">${b}</span>`);
  return html`<a class="card" href="${productPath(product)}" data-product-card>
  <div class="ph">${badges.length ? html`<div class="badges">${badges}</div>` : ''}${photo(product.cover, title, { sizes: '(min-width:1000px) 270px, (min-width:700px) 33vw, 50vw', max: 720, eager })}</div>
  <div class="info">
    <h3>${title}</h3>
    <div class="price"><b>${money(product.price, lang)}</b>${product.compareAt ? html`<s>${money(product.compareAt, lang)}</s>` : ''}</div>
    ${product.colors.length ? html`<div class="dots" aria-label="${s.color}">${product.colors.slice(0, 6).map((c) => html`<span title="${colorLabel(c, lang)}" style="background:${c.hex ?? '#E2D4BC'}"></span>`)}</div>` : ''}
  </div>
</a>`;
}

export const grid = (products, lang, eagerCount = 0) =>
  html`<div class="grid">${products.map((p, i) => card(p, lang, { eager: i < eagerCount }))}</div>`;

export function crumbs(items) {
  return html`<nav class="crumbs" aria-label="breadcrumb">${items.map((item, i) =>
    html`${i ? html`<span aria-hidden="true">/</span>` : ''}${item.href ? html`<a href="${item.href}">${item.label}</a>` : html`<span aria-current="page">${item.label}</span>`}`)}</nav>`;
}
