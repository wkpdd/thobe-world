/** Exclusive launches and the home carousel, as the customer sees them. */
import { html, raw } from '../html.js';
import { t } from '../i18n.js';
import { pick } from '../catalogue.js';
import { mediaSet } from '../images.js';
import { whenText } from '../launches.js';
import { layout } from './layout.js';
import { crumbs, grid, photo } from './parts.js';

const title = (launch, lang) => pick(lang, launch.titleAr, launch.titleFr);
const text = (launch, lang) => pick(lang, launch.descriptionAr, launch.descriptionFr);

/** Days / hours / minutes / seconds until `iso`; public/js/launch.js keeps it moving and reloads at zero. */
export function countdown(iso, lang) {
  const s = t(lang).launch;
  const left = Math.max(0, Date.parse(iso) - Date.now());
  const parts = [[Math.floor(left / 86_400_000), s.days, 'd'], [Math.floor(left / 3_600_000) % 24, s.hours, 'h'], [Math.floor(left / 60_000) % 60, s.minutes, 'm'], [Math.floor(left / 1000) % 60, s.seconds, 's']];
  return html`<div class="countdown" data-countdown="${iso}" role="timer">${parts.map(([n, label, key]) => html`<span><b data-unit="${key}">${String(n).padStart(2, '0')}</b><small>${label}</small></span>`)}</div>`;
}

export function notifyForm(launch, lang) {
  const s = t(lang);
  return html`<form class="notify" id="notify" data-notify novalidate>
  <h3>${s.launch.notifyTitle}</h3>
  <p class="muted">${s.launch.notifySub}</p>
  <input type="hidden" name="launch" value="${launch.id}">
  <div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
  <div class="row">
    <input class="in" name="name" autocomplete="given-name" maxlength="60" placeholder="${s.launch.notifyName}" aria-label="${s.launch.notifyName}">
    <input class="in" name="phone" type="tel" inputmode="tel" autocomplete="tel" required placeholder="${s.phoneHint}" aria-label="${s.phone}" dir="ltr">
    <button class="btn btn-gold" type="submit">${s.launch.notifyButton}</button>
  </div>
  <p class="notify-msg" data-notify-msg role="status" aria-live="polite"></p>
</form>`;
}

/** On a product page, in place of the order form, while its launch has not opened. */
export function launchBox(ctx, launch) {
  const { lang } = ctx;
  const s = t(lang);
  return html`<div class="launch-box">
  <span class="eyebrow">${s.launch.exclusive} · <a href="/lancement/${launch.slug}">${title(launch, lang)}</a></span>
  <p class="lb-when">${s.launch.opensIn}</p>
  ${countdown(launch.launchAt, lang)}
  <p class="muted">${s.launch.opensOn(whenText(launch.launchAt, lang))}</p>
  ${notifyForm(launch, lang)}
</div>`;
}

/** The home page's strip for the launch being promoted. */
export function launchBanner(ctx, launch) {
  const { lang } = ctx;
  const s = t(lang);
  const upcoming = Date.parse(launch.launchAt) > Date.now();
  const cover = launch.cover ? mediaSet(launch.cover, { max: 1280, sizes: '(min-width:900px) 50vw, 100vw' }) : null;
  return html`<section class="block launch-strip"><div class="wrap">
  <a class="ls" href="/lancement/${launch.slug}">
    ${cover ? html`<img src="${cover.src}" srcset="${cover.srcset}" sizes="${cover.sizes}" alt="" width="1280" height="800" loading="lazy">` : html`<span class="ls-art"><img src="/img/emblem-on-dark.svg" alt="" width="640" height="497" loading="lazy"></span>`}
    <div class="ls-text">
      <span class="eyebrow">${launch.limited ? s.launch.limited : s.launch.exclusive}</span>
      <h2>${title(launch, lang)}</h2>
      ${upcoming ? html`<p>${s.launch.opensIn}</p>${countdown(launch.launchAt, lang)}` : html`<p class="open-now">● ${s.launch.openNow}</p>`}
      <span class="btn btn-gold">${s.launch.seeLaunch}</span>
    </div>
  </a>
</div></section>`;
}

export function launchPage(ctx, launch) {
  const { lang, catalogue, config } = ctx;
  const s = t(lang);
  const { byExternalId } = catalogue.snapshot();
  const items = launch.products.map((id) => byExternalId.get(id)).filter(Boolean);
  const upcoming = Date.parse(launch.launchAt) > Date.now();
  const name = title(launch, lang);
  const about = text(launch, lang);
  const body = html`<section class="launch-hero">
  ${launch.cover ? html`<div class="lh-img">${photo(launch.cover, '', { sizes: '100vw', max: 1280, eager: true, base: '/mimg' })}</div>` : ''}
  <div class="wrap lh-text">
    ${crumbs([{ href: '/', label: s.home }, { label: name }])}
    <span class="eyebrow">${launch.limited ? s.launch.limited : s.launch.exclusive}</span>
    <h1>${name}</h1>
    ${about ? html`<p class="lh-about">${about}</p>` : ''}
    ${upcoming
      ? html`<p class="lb-when">${s.launch.opensIn}</p>${countdown(launch.launchAt, lang)}<p class="muted">${s.launch.opensOn(whenText(launch.launchAt, lang))}</p>${notifyForm(launch, lang)}`
      : html`<p class="open-now">● ${s.launch.openNow}</p>`}
    ${launch.maxPerCustomer ? html`<p class="muted small">${s.launch.maxPer(launch.maxPerCustomer)}</p>` : ''}
  </div>
</section>
<section class="block"><div class="wrap">
  <div class="sec-head"><div class="rule">◆</div><h2>${s.launch.pieces}</h2></div>
  ${items.length ? grid(items, lang, 4, ctx.content) : html`<p class="empty">${s.noResults}</p>`}
</div></section>`;
  const cover = launch.cover ? `${config.siteUrl}${mediaSet(launch.cover, { max: 1280 }).src}` : null;
  return layout(ctx, {
    title: name,
    description: (about || `${name} — ${config.shop.nameAr}`).slice(0, 160),
    body,
    canonical: `/lancement/${launch.slug}`,
    image: cover,
    bodyClass: 'is-launch',
    pageScripts: ['js/launch.js'],
  });
}

/** The home carousel. The first slide is the page's main picture: loaded first, the others lazily. */
export function carousel(ctx, slides) {
  const { lang } = ctx;
  return html`<section class="carousel" data-carousel aria-roledescription="carousel" aria-label="${lang === 'fr' ? 'À la une' : 'الواجهة'}">
  <div class="track" data-track tabindex="0">
    ${slides.map((slide, i) => {
      const desktop = mediaSet(slide.image, { max: 1280, sizes: '100vw' });
      const mobile = slide.imageMobile ? mediaSet(slide.imageMobile, { max: 960, sizes: '100vw' }) : null;
      const heading = pick(lang, slide.titleAr, slide.titleFr);
      const sub = pick(lang, slide.subtitleAr, slide.subtitleFr);
      const button = pick(lang, slide.buttonAr, slide.buttonFr);
      const inner = html`<picture>
        ${mobile ? html`<source media="(max-width:700px)" srcset="${mobile.srcset}" sizes="100vw">` : ''}
        <img src="${desktop.src}" srcset="${desktop.srcset}" sizes="100vw" alt="${heading}" width="1920" height="800"${i === 0 ? raw(' fetchpriority="high"') : raw(' loading="lazy"')} decoding="async">
      </picture>
      ${heading || sub || button ? html`<div class="cap"><div class="wrap">${heading ? html`<h2>${heading}</h2>` : ''}${sub ? html`<p>${sub}</p>` : ''}${button && slide.link ? html`<span class="btn btn-gold">${button}</span>` : ''}</div></div>` : ''}`;
      return html`<div class="slide${mobile ? ' has-mobile' : ''}" role="group" aria-roledescription="slide" aria-label="${i + 1} / ${slides.length}">${slide.link ? html`<a href="${slide.link}">${inner}</a>` : inner}</div>`;
    })}
  </div>
  ${slides.length > 1 ? html`<button class="nav prev" type="button" data-prev aria-label="${lang === 'fr' ? 'Précédent' : 'السابق'}">‹</button><button class="nav next" type="button" data-next aria-label="${lang === 'fr' ? 'Suivant' : 'التالي'}">›</button>
  <div class="dots" data-dots>${slides.map((_s, i) => html`<button type="button" aria-label="${i + 1}" aria-current="${i === 0}"></button>`)}</div>` : ''}
</section>`;
}
