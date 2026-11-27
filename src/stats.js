/**
 * The shop's own statistics: first-party, cookieless, nothing sent to anyone.
 *
 * What is kept: one small JSON file per day in DATA_DIR/stats/, with COUNTS only
 * (pages, products, sources, devices, hours, searches, funnel events). No IP
 * address and no identifier is ever written: a visitor is counted once a day
 * through a hash of (a random salt for that day + address + browser), the salt
 * lives in memory and in that day's file only, and both the salt and the list of
 * hashes are dropped when the day ends. Nobody can be followed from one day to
 * the next, or found again from the files.
 *
 * Sales figures are not copied here: they are computed from the orders H47 Pay
 * already holds (storage.shopData()), so there is one truth.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_KEYS = 300;
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|facebookexternalhit|whatsapp\/|telegrambot|preview|curl|wget|python|node-fetch|axios|go-http|monitor|uptime|scan|httpclient|java\//iu;
const ALGIERS_MS = 3_600_000; // UTC+1 all year

export const WILAYAS = ['Adrar', 'Chlef', 'Laghouat', 'Oum El Bouaghi', 'Batna', 'Béjaïa', 'Biskra', 'Béchar', 'Blida', 'Bouira', 'Tamanrasset', 'Tébessa', 'Tlemcen', 'Tiaret', 'Tizi Ouzou', 'Alger', 'Djelfa', 'Jijel', 'Sétif', 'Saïda', 'Skikda', 'Sidi Bel Abbès', 'Annaba', 'Guelma', 'Constantine', 'Médéa', 'Mostaganem', "M'Sila", 'Mascara', 'Ouargla', 'Oran', 'El Bayadh', 'Illizi', 'Bordj Bou Arréridj', 'Boumerdès', 'El Tarf', 'Tindouf', 'Tissemsilt', 'El Oued', 'Khenchela', 'Souk Ahras', 'Tipaza', 'Mila', 'Aïn Defla', 'Naâma', 'Aïn Témouchent', 'Ghardaïa', 'Relizane', 'Timimoun', 'Bordj Badji Mokhtar', 'Ouled Djellal', 'Béni Abbès', 'In Salah', 'In Guezzam', 'Touggourt', 'Djanet', "El M'Ghair", 'El Meniaa'];

/** "2026-11-27" in Algiers time. */
export const dayOf = (date) => new Date(date.getTime() + ALGIERS_MS).toISOString().slice(0, 10);
export const hourOf = (date) => new Date(date.getTime() + ALGIERS_MS).getUTCHours();
/** Order rows carry « YYYY-MM-DD HH:MM:SS » in UTC. */
export const orderDate = (row) => new Date(`${String(row.created_at).replace(' ', 'T')}Z`);

export const isBot = (ua) => !ua || BOT.test(ua);

export function device(ua) {
  if (/iPad|Tablet|Tab\b|SM-T/iu.test(ua)) return 'tablette';
  if (/Mobi|Android|iPhone|iPod/iu.test(ua)) return 'mobile';
  return 'ordinateur';
}
export function browser(ua) {
  if (/FBAN|FBAV|FB_IAB/u.test(ua)) return 'Facebook (in-app)';
  if (/Instagram/u.test(ua)) return 'Instagram (in-app)';
  if (/musical_ly|TikTok|BytedanceWebview/iu.test(ua)) return 'TikTok (in-app)';
  if (/Snapchat/u.test(ua)) return 'Snapchat (in-app)';
  if (/SamsungBrowser/u.test(ua)) return 'Samsung Internet';
  if (/OPR\/|Opera/u.test(ua)) return 'Opera';
  if (/Edg\//u.test(ua)) return 'Edge';
  if (/Firefox|FxiOS/u.test(ua)) return 'Firefox';
  if (/Chrome|CriOS/u.test(ua)) return 'Chrome';
  if (/Safari/u.test(ua)) return 'Safari';
  return 'Autre';
}
export function os(ua) {
  if (/Android/u.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/u.test(ua)) return 'iOS';
  if (/Windows/u.test(ua)) return 'Windows';
  if (/Mac OS X/u.test(ua)) return 'macOS';
  if (/Linux/u.test(ua)) return 'Linux';
  return 'Autre';
}

/** Where a visit comes from: utm_source first, else the referring site, else « direct ». */
export function source(referrer, utmSource, ownHost) {
  const utm = String(utmSource ?? '').toLowerCase().trim();
  const known = (text) => {
    if (/instagram|\big\b/u.test(text)) return 'Instagram';
    if (/facebook|\bfb\b|messenger/u.test(text)) return 'Facebook';
    if (/tiktok/u.test(text)) return 'TikTok';
    if (/whatsapp|wa\.me/u.test(text)) return 'WhatsApp';
    if (/google/u.test(text)) return 'Google';
    if (/youtube|youtu\.be/u.test(text)) return 'YouTube';
    if (/snapchat/u.test(text)) return 'Snapchat';
    if (/bing|yahoo|duckduckgo|yandex/u.test(text)) return 'Autres moteurs';
    return null;
  };
  if (utm) return known(utm) ?? utm.slice(0, 40);
  let host = '';
  try {
    host = new URL(referrer).hostname.replace(/^www\./u, '');
  } catch {
    return 'Direct';
  }
  if (!host || host === ownHost) return 'Direct';
  return known(host) ?? host.slice(0, 60);
}

const emptyDay = (date) => ({
  date,
  views: 0,
  visitors: 0,
  productVisitors: 0,
  pages: {},
  products: {},
  soldOutViews: {},
  launches: {},
  sources: {},
  campaigns: {},
  referrers: {},
  devices: {},
  browsers: {},
  systems: {},
  languages: {},
  hours: Array(24).fill(0),
  events: { add_to_cart: 0, begin_checkout: 0, slide_click: 0, notify: 0 },
  cartProducts: {},
  slides: {},
  searches: {},
  notFound: {},
});

/** +1 on a capped map: past MAX_KEYS new keys go to « (autres) ». */
function bump(map, key, by = 1) {
  const k = String(key);
  if (!(k in map) && Object.keys(map).length >= MAX_KEYS) {
    map['(autres)'] = (map['(autres)'] ?? 0) + by;
    return;
  }
  map[k] = (map[k] ?? 0) + by;
}

export class Stats {
  constructor({ dir, ownHost = '', now = () => new Date(), flushMs = 30_000 }) {
    this.dir = join(dir, 'stats');
    this.ownHost = ownHost.replace(/^www\./u, '');
    this.now = now;
    mkdirSync(this.dir, { recursive: true });
    this.current = null;
    this.dirty = false;
    if (flushMs) {
      this.timer = setInterval(() => this.flush(), flushMs);
      this.timer.unref?.();
    }
  }

  #file(date) {
    return join(this.dir, `${date}.json`);
  }

  #read(date) {
    try {
      return JSON.parse(readFileSync(this.#file(date), 'utf8'));
    } catch {
      return null;
    }
  }

  /** Today's counters, rolling over at midnight (Algiers): yesterday loses its salt and visitor list. */
  #today() {
    const date = dayOf(this.now());
    if (this.current?.day.date === date) return this.current;
    if (this.current) {
      this.flush();
      const done = this.#read(this.current.day.date);
      if (done) this.#write({ ...done, _salt: undefined, _seen: undefined, _seenProduct: undefined });
    }
    const { _salt: storedSalt, _seen: storedSeen, _seenProduct: storedSeenProduct, ...stored } = this.#read(date) ?? {};
    const day = { ...emptyDay(date), ...stored };
    const salt = storedSalt ?? randomBytes(16).toString('hex');
    this.current = { day, salt, seen: new Set(storedSeen ?? []), seenProduct: new Set(storedSeenProduct ?? []) };
    return this.current;
  }

  #write(day) {
    const clean = JSON.stringify(day, (k, v) => (v === undefined ? undefined : v));
    const temp = `${this.#file(day.date)}.${process.pid}.tmp`;
    writeFileSync(temp, clean);
    renameSync(temp, this.#file(day.date));
  }

  flush() {
    if (!this.current || !this.dirty) return;
    const { day, salt, seen, seenProduct } = this.current;
    this.#write({ ...day, _salt: salt, _seen: [...seen], _seenProduct: [...seenProduct] });
    this.dirty = false;
  }

  /** A page seen by a person. `info`: {path, referrer, utm:{source,medium,campaign}, lang, product, soldOut, launch}. */
  pageView(info, { ip, ua }) {
    if (isBot(ua)) return false;
    const { day, salt, seen, seenProduct } = this.#today();
    const visitor = createHash('sha256').update(`${salt}|${ip ?? ''}|${ua}`).digest('hex').slice(0, 16);
    const newVisitor = !seen.has(visitor);
    if (newVisitor) {
      seen.add(visitor);
      day.visitors += 1;
      bump(day.devices, device(ua));
      bump(day.browsers, browser(ua));
      bump(day.systems, os(ua));
      const from = source(info.referrer, info.utm?.source, this.ownHost);
      bump(day.sources, from);
      if (info.utm?.campaign) bump(day.campaigns, `${info.utm.source || '?'} / ${info.utm.medium || '?'} / ${info.utm.campaign}`.slice(0, 120));
      if (from !== 'Direct' && !info.utm?.source) {
        try {
          bump(day.referrers, new URL(info.referrer).hostname.replace(/^www\./u, ''));
        } catch {
          // no referrer
        }
      }
    }
    day.views += 1;
    day.hours[hourOf(this.now())] += 1;
    bump(day.pages, info.path);
    if (info.lang) bump(day.languages, info.lang);
    if (info.product) bump(day.products, info.product);
    if (info.product && !seenProduct.has(visitor)) {
      seenProduct.add(visitor);
      day.productVisitors += 1;
    }
    if (info.product && info.soldOut) bump(day.soldOutViews, info.product);
    if (info.launch) bump(day.launches, info.launch);
    this.dirty = true;
    return true;
  }

  /** add_to_cart (with product), begin_checkout, slide_click (with slide), notify. */
  event(name, data, { ua }) {
    if (isBot(ua)) return false;
    const { day } = this.#today();
    if (!(name in day.events)) return false;
    day.events[name] += 1;
    if (name === 'add_to_cart' && data.product) bump(day.cartProducts, data.product);
    if (name === 'slide_click' && data.slide) bump(day.slides, data.slide);
    this.dirty = true;
    return true;
  }

  search(term, found, { ua }) {
    if (isBot(ua)) return;
    const q = String(term ?? '').toLowerCase().replace(/\s+/gu, ' ').trim().slice(0, 60);
    if (q.length < 2) return;
    const { day } = this.#today();
    const entry = day.searches[q] ?? (Object.keys(day.searches).length < MAX_KEYS ? { n: 0, zero: 0 } : null);
    if (!entry) return;
    entry.n += 1;
    if (!found) entry.zero += 1;
    day.searches[q] = entry;
    this.dirty = true;
  }

  notFound(path, { ua }) {
    if (isBot(ua)) return;
    bump(this.#today().day.notFound, String(path).slice(0, 120));
    this.dirty = true;
  }

  /** The days between two dates (Algiers, inclusive), today from memory. */
  days(from, to) {
    const out = [];
    const today = dayOf(this.now());
    for (let t = Date.parse(`${from}T00:00:00Z`); new Date(t).toISOString().slice(0, 10) <= to; t += 86_400_000) {
      const date = new Date(t).toISOString().slice(0, 10);
      if (date === today) {
        out.push(structuredClone(this.#today().day));
      } else {
        const { _salt, _seen, _seenProduct, ...stored } = this.#read(date) ?? {};
        out.push({ ...emptyDay(date), ...stored });
      }
    }
    return out;
  }

  /** The first day with any statistics, to show « depuis le … ». */
  firstDay() {
    const files = existsSync(this.dir) ? readdirSync(this.dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/u.test(f)).sort() : [];
    return files[0]?.slice(0, 10) ?? dayOf(this.now());
  }
}
