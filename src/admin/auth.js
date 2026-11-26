/**
 * The dashboard's door. One account, set in cPanel (ADMIN_USER / ADMIN_PASSWORD).
 *
 * - The session is a signed cookie (HttpOnly, SameSite=Strict, Secure on https),
 *   valid 12 hours. Its signature includes a digest of the password, so changing
 *   the password in cPanel signs everyone out.
 * - 8 wrong attempts from one address lock it out for 15 minutes.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'tw_admin';
const SESSION_MS = 12 * 3_600_000;
const MAX_TRIES = 8;
const LOCK_MS = 15 * 60_000;
export const MIN_PASSWORD = 12;

const digest = (value) => createHash('sha256').update(String(value)).digest();
const same = (a, b) => timingSafeEqual(digest(a), digest(b));

export class AdminAuth {
  constructor({ user, password, secret, secure, now = () => Date.now() }) {
    this.user = user;
    this.password = password;
    this.secret = secret;
    this.secure = secure;
    this.now = now;
    this.tries = new Map();
  }

  get enabled() {
    return typeof this.password === 'string' && this.password.length >= MIN_PASSWORD;
  }

  #sign(expires) {
    const passwordTag = digest(this.password).toString('hex').slice(0, 16);
    return createHmac('sha256', this.secret).update(`admin:${this.user}:${expires}:${passwordTag}`).digest('hex');
  }

  locked(ip) {
    const recent = (this.tries.get(ip) ?? []).filter((t) => this.now() - t < LOCK_MS);
    this.tries.set(ip, recent);
    return recent.length >= MAX_TRIES;
  }

  /** Check a login. Returns the Set-Cookie value, or null. */
  login(ip, user, password) {
    if (!this.enabled || this.locked(ip)) return null;
    const ok = same(user ?? '', this.user) & same(password ?? '', this.password);
    if (!ok) {
      this.tries.get(ip).push(this.now());
      if (this.tries.size > 5000) this.tries.clear();
      return null;
    }
    this.tries.delete(ip);
    const expires = this.now() + SESSION_MS;
    return this.#cookie(`${expires}.${this.#sign(expires)}`, SESSION_MS / 1000);
  }

  logoutCookie() {
    return this.#cookie('', 0);
  }

  #cookie(value, maxAge) {
    return `${COOKIE}=${value}; Path=/admin; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${this.secure ? '; Secure' : ''}`;
  }

  /** Is this request signed in? */
  check(req) {
    if (!this.enabled) return false;
    const raw = new RegExp(`(?:^|;\\s*)${COOKIE}=([0-9]+)\\.([a-f0-9]{64})`, 'u').exec(req.headers.cookie ?? '');
    if (!raw) return false;
    const expires = Number(raw[1]);
    if (!(expires > this.now())) return false;
    return timingSafeEqual(Buffer.from(raw[2]), Buffer.from(this.#sign(expires)));
  }
}
