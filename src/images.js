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
export function imageSet(imagePath, { sizes = '(min-width:1000px) 25vw, 50vw', max = 960, base = '/img' } = {}) {
  if (!imagePath) return null;
  if (/^https?:\/\//u.test(imagePath)) return { src: imagePath, srcset: '', sizes: '' };
  const name = uploadName(imagePath);
  const widths = WIDTHS.filter((w) => w <= max && w >= 320);
  return {
    src: `${base}/${widths.includes(720) && max >= 720 ? 720 : widths.at(-1)}/${encodeURIComponent(name)}`,
    srcset: widths.map((w) => `${base}/${w}/${encodeURIComponent(name)} ${w}w`).join(', '),
    sizes,
  };
}

/** Pictures uploaded in the website dashboard (carousel, launches): same sizes, served from /mimg/. */
export const mediaSet = (name, options = {}) => imageSet(name, { ...options, base: '/mimg' });

/**
 * A picture uploaded in the dashboard → a clean JPEG in data/media (turned the
 * right way up, at most 2400 px). Returns its name, or null when it is not a picture.
 */
export async function storeUpload(buffer, mediaDir) {
  const { createHash } = await import('node:crypto');
  const { writeFileSync } = await import('node:fs');
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
  const isPng = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) return null;
  let out = buffer;
  let ext = isJpeg ? 'jpg' : isPng ? 'png' : 'webp';
  if (sharp) {
    try {
      out = await sharp(buffer, { failOn: 'error' }).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
      ext = 'jpg';
    } catch {
      return null;
    }
  }
  const name = `m-${createHash('sha256').update(out).digest('hex').slice(0, 16)}.${ext}`;
  writeFileSync(join(mediaDir, name), out);
  return name;
}
