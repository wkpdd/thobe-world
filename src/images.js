/**
 * Fast photos. NewStore's photographs are stored VERBATIM in data/uploads (the
 * contract requires it: NewStore compares their sha256). What the browser
 * downloads is a resized WebP made from them once, kept in data/cache, and
 * served with a one-year immutable cache (upload names are unique per photo).
 *
 * Sizes are generated in the background as soon as a photo arrives from
 * H47 Pay, so the first customer never waits for the resize.
 */
import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * sharp ships native code. If the host cannot load it (very old glibc), the
 * shop keeps working: /img/… redirects to the original photo instead.
 */
const sharp = await import('sharp').then((m) => m.default).catch((error) => {
  console.error(`sharp unavailable, photos are served unresized: ${error.message.split('\n')[0]}`);
  return null;
});
export const imagesEnabled = sharp !== null;

export const WIDTHS = [160, 320, 480, 720, 960, 1280];
const WARM_WIDTHS = [320, 480, 720, 960];
const NAME = /^[A-Za-z0-9._-]{1,120}$/u;

sharp?.cache(false);
sharp?.concurrency(1); // shared hosting: one libvips thread per resize is plenty

export class ImageOptimizer {
  constructor({ uploadsDir, cacheDir }) {
    this.uploadsDir = uploadsDir;
    this.cacheDir = cacheDir;
    this.pending = new Map();
    this.queue = Promise.resolve();
    mkdirSync(cacheDir, { recursive: true });
  }

  cachedPath(width, name) {
    return join(this.cacheDir, String(width), `${name}.webp`);
  }

  /** The WebP for `name` at `width`, generated if missing. Null when the source does not exist. */
  async get(width, name) {
    if (!WIDTHS.includes(width) || !NAME.test(name) || name.startsWith('.')) return null;
    const source = join(this.uploadsDir, name);
    if (!existsSync(source)) return null;
    const target = this.cachedPath(width, name);
    if (existsSync(target) && statSync(target).mtimeMs >= statSync(source).mtimeMs) return target;
    const key = `${width}/${name}`;
    if (!this.pending.has(key)) {
      const job = this.#render(source, target, width).finally(() => this.pending.delete(key));
      this.pending.set(key, job);
    }
    await this.pending.get(key);
    return target;
  }

  async #render(source, target, width) {
    mkdirSync(join(this.cacheDir, String(width)), { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    await sharp(source, { failOn: 'none' })
      .rotate() // honour the phone's EXIF orientation
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: width <= 320 ? 72 : 78, effort: 4, smartSubsample: true })
      .toFile(temp);
    renameSync(temp, target);
  }

  /** Queue the usual sizes for a new upload, one at a time, after the sync answered. */
  warm(name) {
    if (!imagesEnabled || !NAME.test(name)) return;
    for (const width of WARM_WIDTHS) {
      this.queue = this.queue.then(() => this.get(width, name)).catch(() => {});
    }
  }

  /** Wait until every queued resize is done (tests). */
  idle() {
    return this.queue;
  }
}

/** The basename an `image_path` (/uploads/x.jpg) refers to. */
export const uploadName = (imagePath) => String(imagePath ?? '').split('/').pop() ?? '';

/** `<img>` attributes for a stored photo: srcset of WebP sizes. */
export function imageSet(imagePath, { sizes = '(min-width:1000px) 25vw, 50vw', max = 960 } = {}) {
  if (!imagePath) return null;
  if (/^https?:\/\//u.test(imagePath)) return { src: imagePath, srcset: '', sizes: '' };
  const name = uploadName(imagePath);
  const widths = WIDTHS.filter((w) => w <= max && w >= 320);
  return {
    src: `/img/${widths.includes(720) && max >= 720 ? 720 : widths.at(-1)}/${encodeURIComponent(name)}`,
    srcset: widths.map((w) => `/img/${w}/${encodeURIComponent(name)} ${w}w`).join(', '),
    sizes,
  };
}
