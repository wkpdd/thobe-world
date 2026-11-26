/**
 * What the shop manages ON THE WEBSITE (thobeworld.com/admin), next to what
 * H47 Pay sends: the home carousel, exclusive launches and the customers who
 * asked to be told when a launch opens.
 *
 * It lives in data/site-content.json and data/media/, in the shared data folder
 * that deploys and rollbacks never touch. Products are NOT copied here: a launch
 * only names H47 Pay articles by their external id, so prices, photos and stock
 * keep coming from H47 Pay.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { slugify } from './catalogue.js';
import { normalizePhone } from './orders.js';

const MAX_SLIDES = 12;
const MAX_LAUNCHES = 60;
const MAX_SUBSCRIBERS = 20_000;
const MEDIA = /^m-[a-f0-9]{16}\.(?:jpg|png|webp)$/u;

/** Algeria is UTC+1 all year: a « 2026-12-01T20:00 » typed in the dashboard is Algiers time. */
export const ALGIERS_OFFSET = '+01:00';
export function parseAlgiers(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const at = Date.parse(/[zZ]|[+-]\d\d:\d\d$/u.test(text) ? text : `${text.length === 16 ? `${text}:00` : text}${ALGIERS_OFFSET}`);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}
/** ISO → « 2026-12-01T20:00 », Algiers time, for a datetime-local input. */
export function toAlgiersInput(iso) {
  if (!iso) return '';
  const d = new Date(Date.parse(iso) + 3_600_000);
  return d.toISOString().slice(0, 16);
}

const text = (value, max) => String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, max);
const longText = (value, max) => String(value ?? '').replace(/\r\n?/gu, '\n').replace(/[ \t]+/gu, ' ').trim().slice(0, max);
const media = (value) => (MEDIA.test(String(value ?? '')) ? String(value) : null);
/** A link the owner may put on a slide: a path on this site, or an https address. */
export function safeLink(value) {
  const link = text(value, 300);
  if (!link) return '';
  if (link.startsWith('/') && !link.startsWith('//')) return link;
  try {
    const url = new URL(link);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}

export class ContentStore {
  constructor({ dir, now = () => new Date() }) {
    this.file = join(dir, 'site-content.json');
    this.mediaDir = join(dir, 'media');
    this.now = now;
    mkdirSync(this.mediaDir, { recursive: true });
    this.data = this.#load();
  }

  #load() {
    const empty = { version: 1, slides: [], launches: [], subscribers: [] };
    if (!existsSync(this.file)) return empty;
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8'));
      return { ...empty, ...data };
    } catch (error) {
      // A damaged file is kept aside, never silently overwritten.
      renameSync(this.file, `${this.file}.damaged-${Date.now()}`);
      console.error(`site-content.json could not be read (${error.message}); kept aside, starting empty`);
      return empty;
    }
  }

  #save() {
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(this.data, null, 2)}\n`);
    renameSync(temp, this.file);
  }

  // ---- Slides ----------------------------------------------------------------
  slides() {
    return [...this.data.slides].sort((a, b) => a.order - b.order);
  }

  slide(id) {
    return this.data.slides.find((s) => s.id === id) ?? null;
  }

  /** The slides a visitor sees now, in order. */
  liveSlides(at = this.now()) {
    const now = at.getTime();
    return this.slides().filter((s) => s.active && s.image && (!s.startsAt || Date.parse(s.startsAt) <= now) && (!s.endsAt || Date.parse(s.endsAt) > now));
  }

  saveSlide(input, id = null) {
    const existing = id ? this.slide(id) : null;
    if (id && !existing) return { ok: false, error: 'Diapositive introuvable.' };
    if (!existing && this.data.slides.length >= MAX_SLIDES) return { ok: false, error: `${MAX_SLIDES} diapositives au plus.` };
    const slide = {
      id: existing?.id ?? randomUUID().slice(0, 8),
      order: existing?.order ?? (Math.max(0, ...this.data.slides.map((s) => s.order)) + 1),
      image: media(input.image),
      imageMobile: media(input.imageMobile),
      titleAr: text(input.titleAr, 90),
      titleFr: text(input.titleFr, 90),
      subtitleAr: text(input.subtitleAr, 160),
      subtitleFr: text(input.subtitleFr, 160),
      buttonAr: text(input.buttonAr, 30),
      buttonFr: text(input.buttonFr, 30),
      link: safeLink(input.link),
      startsAt: parseAlgiers(input.startsAt),
      endsAt: parseAlgiers(input.endsAt),
      active: input.active === true || input.active === 'on' || input.active === '1',
      updatedAt: this.now().toISOString(),
    };
    if (!slide.image) return { ok: false, error: 'Ajoutez une image (format large, 1920 × 800 conseillé).' };
    if (slide.startsAt && slide.endsAt && slide.endsAt <= slide.startsAt) return { ok: false, error: 'La fin doit être après le début.' };
    this.data.slides = [...this.data.slides.filter((s) => s.id !== slide.id), slide];
    this.#save();
    return { ok: true, slide };
  }

  deleteSlide(id) {
    const before = this.data.slides.length;
    this.data.slides = this.data.slides.filter((s) => s.id !== id);
    if (this.data.slides.length !== before) this.#save();
    return this.data.slides.length !== before;
  }

  /** Move a slide one place up (-1) or down (+1). */
  moveSlide(id, step) {
    const list = this.slides();
    const i = list.findIndex((s) => s.id === id);
    const j = i + step;
    if (i < 0 || j < 0 || j >= list.length) return false;
    [list[i].order, list[j].order] = [list[j].order, list[i].order];
    this.#save();
    return true;
  }

  // ---- Launches ----------------------------------------------------------------
  launches() {
    return [...this.data.launches].sort((a, b) => (b.launchAt ?? '').localeCompare(a.launchAt ?? ''));
  }

  launch(id) {
    return this.data.launches.find((l) => l.id === id) ?? null;
  }

  launchBySlug(slug) {
    return this.data.launches.find((l) => l.slug === slug && l.active) ?? null;
  }

  saveLaunch(input, id = null) {
    const existing = id ? this.launch(id) : null;
    if (id && !existing) return { ok: false, error: 'Lancement introuvable.' };
    if (!existing && this.data.launches.length >= MAX_LAUNCHES) return { ok: false, error: `${MAX_LAUNCHES} lancements au plus.` };
    const titleFr = text(input.titleFr, 90);
    const titleAr = text(input.titleAr, 90);
    if (!titleFr && !titleAr) return { ok: false, error: 'Donnez un titre au lancement.' };
    const launchAt = parseAlgiers(input.launchAt);
    if (!launchAt) return { ok: false, error: 'Indiquez la date et l’heure d’ouverture.' };
    const products = [...new Set((Array.isArray(input.products) ? input.products : [input.products]).map((p) => text(p, 64)).filter(Boolean))].slice(0, 40);
    if (!products.length) return { ok: false, error: 'Choisissez au moins un article (envoyé par H47 Pay).' };
    let slug = existing?.slug;
    if (!slug) {
      const base = slugify(titleFr || titleAr) || 'lancement';
      slug = base;
      for (let n = 2; this.data.launches.some((l) => l.slug === slug); n += 1) slug = `${base}-${n}`;
    }
    const max = Number.parseInt(String(input.maxPerCustomer ?? ''), 10);
    const launch = {
      id: existing?.id ?? randomUUID().slice(0, 8),
      slug,
      titleAr,
      titleFr,
      descriptionAr: longText(input.descriptionAr, 1200),
      descriptionFr: longText(input.descriptionFr, 1200),
      cover: media(input.cover),
      products,
      launchAt,
      limited: input.limited === true || input.limited === 'on' || input.limited === '1',
      maxPerCustomer: Number.isInteger(max) && max > 0 ? Math.min(max, 50) : null,
      featured: input.featured === true || input.featured === 'on' || input.featured === '1',
      active: input.active === true || input.active === 'on' || input.active === '1',
      createdAt: existing?.createdAt ?? this.now().toISOString(),
      updatedAt: this.now().toISOString(),
    };
    this.data.launches = [...this.data.launches.filter((l) => l.id !== launch.id), launch];
    this.#save();
    return { ok: true, launch };
  }

  deleteLaunch(id) {
    const before = this.data.launches.length;
    this.data.launches = this.data.launches.filter((l) => l.id !== id);
    if (before === this.data.launches.length) return false;
    this.data.subscribers = this.data.subscribers.filter((s) => s.launchId !== id);
    this.#save();
    return true;
  }

  /** upcoming (before its hour) or live (open). Inactive launches are invisible. */
  stateOf(launch, at = this.now()) {
    return Date.parse(launch.launchAt) > at.getTime() ? 'upcoming' : 'live';
  }

  /**
   * The launch an article belongs to, for the shop front: an UPCOMING one wins
   * (it locks the article), then the most recent live one (its badge and limit).
   */
  launchFor(externalId, at = this.now()) {
    const mine = this.data.launches.filter((l) => l.active && l.products.includes(externalId));
    if (!mine.length) return null;
    const upcoming = mine.filter((l) => this.stateOf(l, at) === 'upcoming').sort((a, b) => a.launchAt.localeCompare(b.launchAt));
    if (upcoming.length) return { launch: upcoming[0], state: 'upcoming' };
    const live = mine.sort((a, b) => b.launchAt.localeCompare(a.launchAt));
    return { launch: live[0], state: 'live' };
  }

  /** The launch to show on the home page: the next featured upcoming, else the newest featured live one (for 14 days). */
  homeLaunch(at = this.now()) {
    const shown = this.data.launches.filter((l) => l.active && l.featured);
    const upcoming = shown.filter((l) => this.stateOf(l, at) === 'upcoming').sort((a, b) => a.launchAt.localeCompare(b.launchAt));
    if (upcoming.length) return upcoming[0];
    const recent = shown.filter((l) => at.getTime() - Date.parse(l.launchAt) < 14 * 86_400_000).sort((a, b) => b.launchAt.localeCompare(a.launchAt));
    return recent[0] ?? null;
  }

  // ---- « Prévenez-moi » --------------------------------------------------------------
  subscribe(launchId, { phone, name }) {
    const launch = this.launch(launchId);
    if (!launch || !launch.active) return { ok: false, code: 'gone' };
    const normalized = normalizePhone(phone);
    if (!normalized) return { ok: false, code: 'phone' };
    if (this.data.subscribers.some((s) => s.launchId === launchId && s.phone === normalized)) return { ok: true, already: true };
    if (this.data.subscribers.length >= MAX_SUBSCRIBERS) return { ok: false, code: 'full' };
    this.data.subscribers.push({ launchId, phone: normalized, name: text(name, 60), at: this.now().toISOString() });
    this.#save();
    return { ok: true, already: false };
  }

  subscribers(launchId) {
    return this.data.subscribers.filter((s) => s.launchId === launchId).sort((a, b) => a.at.localeCompare(b.at));
  }

  // ---- Media ------------------------------------------------------------------------
  mediaPath(name) {
    return MEDIA.test(name) ? join(this.mediaDir, name) : null;
  }
}
