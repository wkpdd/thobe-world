/** Versioned asset URLs: `/css/site.css?v=<hash>` so browsers may cache them for a year. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function assetVersions(publicDir, extra = {}) {
  const cache = new Map();
  const url = (path) => {
    if (!cache.has(path)) {
      const bytes = extra[path] ?? readFileSync(join(publicDir, path));
      cache.set(path, `/${path}?v=${createHash('sha256').update(bytes).digest('hex').slice(0, 10)}`);
    }
    return cache.get(path);
  };
  /** A file served from memory (rewritten or generated): versioned by what is actually sent. */
  const register = (path, bytes) => {
    extra[path] = bytes;
    cache.delete(path);
  };
  return { url, register };
}
