/**
 * The shop front's own words that the owner edits from /admin: the announcement
 * bar and the home page banner (eyebrow, title, text, buttons, trust badges,
 * picture). They are not catalogue data, so they live here and not in H47 Pay.
 *
 * Stored as one JSON file in DATA_DIR (site-settings.json), next to H47 Pay's
 * projection, and the banner picture in DATA_DIR/site/.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import sharp from 'sharp';
import { escapeHtml, raw } from './html.js';

export const TRUST_SLOTS = 4;
const MAX_TEXT = 300;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const pair = (ar, fr) => ({ ar, fr });

export function defaultSettings(config) {
  const shop = config.shop;
  return {
    announce: pair('توصيل إلى **58 ولاية** · الدفع عند الاستلام', 'Livraison vers **58 wilayas** · Paiement à la livraison'),
    hero: {
      eyebrow: pair(`${shop.nameAr} · ${shop.nameFr}`, `${shop.nameAr} · ${shop.nameFr}`),
      title1: pair('تأنق', 'Élégant'),
      title2: pair('كأنك ملك', 'comme un roi'),
      text: pair(shop.taglineAr, shop.taglineFr),
      primary: { label: pair('كل المنتجات', 'Tous les produits'), href: '/boutique' },
      // Empty: the first category of the catalogue, as before.
      secondary: { label: pair('', ''), href: '' },
      trust: [
        { icon: '🚚', label: pair('توصيل لـ 58 ولاية', 'Livraison 58 wilayas') },
        { icon: '💵', label: pair('الدفع عند الاستلام', 'Paiement à la livraison') },
        { icon: '🔁', label: pair('استبدال سهل', 'Échange facile') },
        { icon: '✨', label: pair('جودة مضمونة', 'Qualité garantie') },
      ],
      image: '', // empty: the gold logo
      imageFit: 'logo', // 'logo' (centred, smaller) or 'photo' (fills the arch)
    },
  };
}

const text = (value, fallback = '') => (typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim().slice(0, MAX_TEXT) : fallback);
const textPair = (value, fallback) => ({ ar: text(value?.ar, fallback.ar), fr: text(value?.fr, fallback.fr) });

/** A button link: a path on this site, or an https:// / wa.me address. Anything else is dropped. */
export function safeHref(value) {
  const v = text(value);
  if (v === '') return '';
  if (/^\/(?!\/)[^\s]*$/u.test(v)) return v;
  if (/^https:\/\/[^\s]+$/iu.test(v)) return v;
  return null;
}

/**
 * Validates a whole settings object (from the form or from disk) against the
 * defaults. Unknown keys are dropped; a refused link is reported and keeps its
 * previous value.
 */
export function cleanSettings(input, defaults, previous = defaults) {
  const errors = [];
  const h = input?.hero ?? {};
  const d = defaults.hero;
  const link = (value, fallback, field) => {
    if (value === undefined) return fallback;
    const href = safeHref(value);
    if (href === null) {
      errors.push(field);
      return fallback;
    }
    return href;
  };
  const trustIn = Array.isArray(h.trust) ? h.trust : d.trust;
  const settings = {
    announce: textPair(input?.announce, defaults.announce),
    hero: {
      eyebrow: textPair(h.eyebrow, d.eyebrow),
      title1: textPair(h.title1, d.title1),
      title2: textPair(h.title2, d.title2),
      text: textPair(h.text, d.text),
      primary: { label: textPair(h.primary?.label, d.primary.label), href: link(h.primary?.href, previous.hero.primary.href, 'primary') },
      secondary: { label: textPair(h.secondary?.label, d.secondary.label), href: link(h.secondary?.href, previous.hero.secondary.href, 'secondary') },
      trust: Array.from({ length: TRUST_SLOTS }, (_v, i) => {
        const fallback = d.trust[i] ?? { icon: '', label: pair('', '') };
        const row = trustIn[i] ?? {};
        return { icon: text(row.icon, fallback.icon).slice(0, 8), label: textPair(row.label, fallback.label) };
      }),
      image: typeof h.image === 'string' && /^hero-[a-f0-9]{16}\.webp$/u.test(h.image) ? h.image : '',
      imageFit: h.imageFit === 'photo' ? 'photo' : 'logo',
    },
  };
  return { settings, errors };
}

/** Announcement text → HTML: escaped, with **bold** shown in gold. */
export const announceHtml = (value) => raw(escapeHtml(value).replace(/\*\*(.+?)\*\*/gu, '<b>$1</b>'));

export class SiteSettings {
  constructor({ dataDir, config }) {
    this.file = join(dataDir, 'site-settings.json');
    this.mediaDir = join(dataDir, 'site');
    this.defaults = defaultSettings(config);
    mkdirSync(this.mediaDir, { recursive: true });
    this.current = this.#load();
  }

  #load() {
    if (!existsSync(this.file)) return structuredClone(this.defaults);
    try {
      return cleanSettings(JSON.parse(readFileSync(this.file, 'utf8')), this.defaults).settings;
    } catch (error) {
      console.error(`site-settings.json unreadable, using defaults: ${error.message}`);
      return structuredClone(this.defaults);
    }
  }

  get() {
    return this.current;
  }

  /** Saves the form; keeps the current picture. Returns the fields that were refused. */
  save(input) {
    const { settings, errors } = cleanSettings({ ...input, hero: { ...input?.hero, image: this.current.hero.image } }, this.defaults, this.current);
    this.#write(settings);
    return errors;
  }

  reset() {
    const image = this.current.hero.image;
    this.#write({ ...structuredClone(this.defaults), hero: { ...structuredClone(this.defaults.hero), image, imageFit: this.current.hero.imageFit } });
  }

  /** A new banner picture (JPEG, PNG or WebP bytes) → one WebP of at most 1000 px wide. */
  async setImage(bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw Object.assign(new Error('empty'), { code: 'image' });
    if (bytes.length > MAX_IMAGE_BYTES) throw Object.assign(new Error('too big'), { code: 'size' });
    let webp;
    try {
      webp = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 1000, height: 1250, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    } catch {
      throw Object.assign(new Error('not an image'), { code: 'image' });
    }
    const name = `hero-${createHash('sha256').update(webp).digest('hex').slice(0, 16)}.webp`;
    writeFileSync(join(this.mediaDir, name), webp);
    const fit = this.current.hero.image ? this.current.hero.imageFit : 'photo';
    this.#write({ ...this.current, hero: { ...this.current.hero, image: name, imageFit: fit } });
    this.#prune();
    return name;
  }

  clearImage() {
    this.#write({ ...this.current, hero: { ...this.current.hero, image: '', imageFit: 'logo' } });
    this.#prune();
  }

  /** The banner picture's public URL, or the gold logo. */
  imageUrl() {
    return this.current.hero.image ? `/site/${this.current.hero.image}` : '/img/logo-gold.webp';
  }

  #prune() {
    for (const name of readdirSync(this.mediaDir)) {
      if (name.startsWith('hero-') && name !== this.current.hero.image) {
        try {
          unlinkSync(join(this.mediaDir, name));
        } catch {
          /* already gone */
        }
      }
    }
  }

  #write(settings) {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(settings, null, 2));
    renameSync(tmp, this.file);
    this.current = settings;
  }
}
