/**
 * The visitor's address, for the per-device limits (orders, « notify me »,
 * dashboard logins).
 *
 * On cPanel the app sits behind Passenger / the web server and usually listens
 * on a unix socket. There `req.socket.remoteAddress` is undefined, Express's
 * `req.ip` is undefined too, and every visitor would share one bucket: anyone
 * could then use up the shop's order limit or lock the owner out of /admin.
 * Behind such a socket only the local web server can talk to us, so the LAST
 * X-Forwarded-For entry (the one it appended) is the visitor.
 *
 * IPv6 addresses are grouped by /64, the block one connection usually owns.
 * Null when nothing is known: callers then skip the per-device limit rather
 * than pool every visitor together.
 */
import { isIP } from 'node:net';

function lastForwarded(req) {
  const header = req.headers['x-forwarded-for'];
  const value = Array.isArray(header) ? header.join(',') : String(header ?? '');
  const last = value.split(',').map((s) => s.trim()).filter(Boolean).pop();
  return last && isIP(last.replace(/^\[|\]$/gu, '')) ? last.replace(/^\[|\]$/gu, '') : null;
}

export function clientIp(req) {
  let ip = req.ip ?? null;
  if (!ip && req.socket?.remoteAddress === undefined) ip = lastForwarded(req);
  if (!ip || !isIP(ip)) return null;
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  if (isIP(ip) === 6) return `${ip.split(':').slice(0, 4).join(':')}::/64`;
  return ip;
}

/**
 * A bounded sliding-window counter per key. Old entries are evicted one by one
 * (never all at once), so flooding it with new keys cannot wipe a lock.
 */
export class WindowCounter {
  constructor({ windowMs, max, maxKeys = 10_000, now = () => Date.now() }) {
    Object.assign(this, { windowMs, max, maxKeys, now });
    this.hits = new Map();
  }

  #recent(key) {
    const at = this.now();
    const list = (this.hits.get(key) ?? []).filter((t) => at - t < this.windowMs);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  /** Over the limit already? (does not count) */
  full(key) {
    return this.#recent(key).length >= this.max;
  }

  /** Count one hit. */
  hit(key) {
    const list = this.#recent(key);
    list.push(this.now());
    this.hits.delete(key);
    this.hits.set(key, list); // most recent last
    while (this.hits.size > this.maxKeys) this.hits.delete(this.hits.keys().next().value);
  }

  clear(key) {
    this.hits.delete(key);
  }
}
