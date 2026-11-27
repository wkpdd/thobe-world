/**
 * The dashboard's door. One account, set in cPanel (ADMIN_USER / ADMIN_PASSWORD).
 *
 * - The session is a signed cookie (HttpOnly, SameSite=Strict, Secure on https),
 *   valid 12 hours at most. Its signature covers a digest of the password and a
 *   session generation: changing the password, or pressing « Déconnexion »,
 *   signs every open session out.
 * - 8 wrong attempts from one address (IPv6: one /64) lock it for 15 minutes.
 *   The counters are bounded and evicted one by one, so flooding them cannot
 *   wipe a lock. When the address is unknown, every unknown caller shares one
 *   lock: safer than none.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { WindowCounter } from '../client-ip.js';

const COOKIE = 'tw_admin';
const SESSION_MS = 12 * 3_600_000;
export const MIN_PASSWORD = 12;

const digest = (value) => createHash('sha256').update(String(value)).digest();
const same = (a, b) => timingSafeEqual(digest(a), digest(b));

export class AdminAuth {
  /**
   * `generation()` / `revoke()`: the session generation, kept by the caller
   * (site-content.json), so a logout survives a restart.
   */
  constructor({ user, password, secret, secure, now = () => Date.now(), generation = () => 0, revoke = () => {} }) {
    Object.assign(this, { user, password, secret, secure, now, generation, revoke });
    this.tries = new WindowCounter({ windowMs: 15 * 60_000, max: 8, now });
  }

  get enabled() {
    return typeof this.password === 'string' && this.password.length >= MIN_PASSWORD;
  }

  #sign(expires) {
    const passwordTag = digest(this.password).toString('hex').slice(0, 16);
    return createHmac('sha256', this.secret).update(`admin:${this.user}:${expires}:${passwordTag}:${this.generation()}`).digest('hex');
  }

  locked(ip) {
    return this.tries.full(ip ?? 'unknown');
  }

  /** Check a login. Returns the Set-Cookie value, or null. */
  login(ip, user, password) {
    const key = ip ?? 'unknown';
    if (!this.enabled || this.tries.full(key)) return null;
    const ok = same(user ?? '', this.user) & same(password ?? '', this.password);
    if (!ok) {
      this.tries.hit(key);
      return null;
    }
    this.tries.clear(key);
    const expires = this.now() + SESSION_MS;
    return this.#cookie(`${expires}.${this.#sign(expires)}`, SESSION_MS / 1000);
  }

  /** « Déconnexion »: every session, on every device, ends now. */
  logout() {
    this.revoke();
    return this.#cookie('', 0);
  }

  #cookie(value, maxAge) {
    return `${COOKIE}=${value}; Path=/admin; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${this.secure ? '; Secure' : ''}`;
  }

  /** Is this request signed in? */
  check(req) {
    if (!this.enabled) return false;
    const raw = new RegExp(`(?:^|;\\s*)${COOKIE}=([0-9]{1,16})\\.([a-f0-9]{64})`, 'u').exec(req.headers.cookie ?? '');
    if (!raw) return false;
    const expires = Number(raw[1]);
    const now = this.now();
    if (!(expires > now) || expires > now + SESSION_MS) return false; // never longer than one session
    return timingSafeEqual(Buffer.from(raw[2]), Buffer.from(this.#sign(expires)));
  }
}
