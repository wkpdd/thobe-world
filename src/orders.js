/**
 * The checkout. A customer's basket becomes order rows through
 * `storage.placeOrder()` (the package checks the stock projection and the
 * delivery list, and writes the rows H47 Pay pulls into « Commandes web »).
 * Nothing here moves stock: H47 Pay does that when the shop confirms.
 *
 * What this file adds in front of it: Algerian phone numbers, a honeypot, a
 * per-device rate limit and a duplicate guard — the cash-on-delivery basics
 * that keep fake and double orders out of the shop's inbox.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { deliveryFeeFor } from '@h47io/sync-receiver';

/** "+213 661-23 45 67" → "0661234567"; null when it is not an Algerian mobile number. */
export function normalizePhone(input) {
  let digits = String(input ?? '').replace(/[\s().\-‎‏]/gu, '');
  digits = digits.replace(/[٠-٩]/gu, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  if (digits.startsWith('+213')) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith('00213')) digits = `0${digits.slice(5)}`;
  else if (digits.startsWith('213') && digits.length === 12) digits = `0${digits.slice(3)}`;
  return /^0[567]\d{8}$/u.test(digits) ? digits : null;
}

const clean = (value, max) => String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, max);

/** Validate the posted form. Returns `{ok:false, field, code}` or `{ok:true, order}`. */
export function validateOrder(body) {
  const fullName = clean(body?.fullName, 80);
  if (fullName.length < 3) return { ok: false, field: 'fullName', code: 'name' };
  const phone = normalizePhone(body?.phone);
  if (!phone) return { ok: false, field: 'phone', code: 'phone' };
  const wilaya = Number.parseInt(String(body?.wilaya ?? ''), 10);
  if (!Number.isInteger(wilaya) || wilaya < 1 || wilaya > 58) return { ok: false, field: 'wilaya', code: 'wilaya' };
  const commune = clean(body?.commune, 80);
  if (commune.length < 2) return { ok: false, field: 'commune', code: 'commune' };
  const deliveryType = body?.deliveryOption === 'stopdesk' ? 'stopdesk' : 'home';
  const carrier = clean(body?.carrier, 40) || null;
  const address = clean(body?.address, 200);
  const notes = clean(body?.notes, 300);

  const merged = new Map();
  const lines = Array.isArray(body?.lines) ? body.lines.slice(0, 30) : [];
  for (const line of lines) {
    const externalId = clean(line?.externalId, 64);
    const quantity = Number.parseInt(String(line?.quantity ?? ''), 10);
    if (!externalId || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) continue;
    const color = line?.color === undefined || line?.color === null || line?.color === '' ? null : clean(line.color, 60);
    const size = line?.size === undefined || line?.size === null || line?.size === '' ? null : clean(line.size, 30);
    const key = `${externalId}|${color ?? ''}|${size ?? ''}`;
    const existing = merged.get(key);
    merged.set(key, { externalId, color, size, quantity: (existing?.quantity ?? 0) + quantity });
  }
  if (merged.size === 0) return { ok: false, field: 'lines', code: 'variant' };
  return {
    ok: true,
    order: { fullName, phone, wilaya, commune, address, notes, deliveryType, carrier, lines: [...merged.values()] },
  };
}

/** Lines → a stable signature, to recognise the same basket posted twice. */
const signature = (lines) =>
  lines
    .map((l) => `${l.externalId}|${l.color ?? ''}|${l.size ?? ''}|${Number(l.quantity)}`)
    .sort()
    .join(';');

export class OrderDesk {
  constructor({ storage, catalogue, secret, limits, now = () => new Date() }) {
    this.storage = storage;
    this.catalogue = catalogue;
    this.secret = secret;
    this.limits = limits;
    this.now = now;
    this.hits = new Map();
  }

  /** Sliding window per device (IP). True when it may still order. */
  allow(ip) {
    const windowMs = this.limits.perIpWindowMin * 60_000;
    const at = this.now().getTime();
    const recent = (this.hits.get(ip) ?? []).filter((t) => at - t < windowMs);
    if (recent.length >= this.limits.perIpMax) {
      this.hits.set(ip, recent);
      return false;
    }
    recent.push(at);
    this.hits.set(ip, recent);
    if (this.hits.size > 5000) this.hits.clear();
    return true;
  }

  /** A pending cart from the same phone with the same lines, placed recently. */
  findDuplicate(order, externalLines) {
    const data = this.storage.shopData();
    const windowMs = this.limits.duplicateWindowMin * 60_000;
    const since = this.now().getTime() - windowMs;
    const productExt = new Map(data.products.map((p) => [p.id, p.external_id]));
    const groups = new Map();
    for (const row of data.orders) {
      if (row.phone !== order.phone || row.status !== 'pending') continue;
      const at = Date.parse(`${String(row.created_at).replace(' ', 'T')}Z`);
      if (!Number.isFinite(at) || at < since) continue;
      if (!groups.has(row.order_group)) groups.set(row.order_group, []);
      groups.get(row.order_group).push({ externalId: productExt.get(row.product_id), color: row.selected_color, size: row.selected_size, quantity: row.quantity });
    }
    const wanted = signature(externalLines);
    for (const [group, lines] of groups) if (signature(lines) === wanted) return group;
    return null;
  }

  /**
   * Cash on delivery's real cost is the parcel that comes back. H47 Pay tells the
   * site when a cart was `returned` (set_order_status), so a phone with refused
   * parcels behind it is flagged in the notes the shop reads in « Commandes web ».
   * Flagged, never refused: the shop decides, on the phone.
   */
  returnsWarning(phone) {
    const groups = new Set(this.storage.shopData().orders.filter((r) => r.phone === phone && r.status === 'returned').map((r) => r.order_group));
    return groups.size ? `⚠ Client : ${groups.size} colis retourné${groups.size > 1 ? 's' : ''} auparavant` : '';
  }

  deliveryOptions() {
    return this.storage.shopData().deliveryOptions;
  }

  /** The fee the server charges for this choice; null when not offered. Undefined: the shop sends no list. */
  feeFor(order) {
    const list = this.deliveryOptions();
    if (list === null) return undefined;
    const carriers = [...new Set(list.filter((o) => Number(o.wilaya) === order.wilaya).map((o) => o.carrier))];
    const carrier = order.carrier ?? (carriers.length === 1 ? carriers[0] : null);
    if (!carrier) return null;
    const fee = deliveryFeeFor(list, { carrier, wilaya: order.wilaya, option: order.deliveryType });
    return fee === null ? null : { carrier, fee, label: list.find((o) => o.carrier === carrier)?.label ?? carrier };
  }

  /** Place the order. Answers `{ok, status, orderGroup?, duplicate?, code?, message?}`. */
  place(order) {
    const delivery = this.feeFor(order);
    if (delivery === null) return { ok: false, status: 422, code: 'delivery' };

    const duplicate = this.findDuplicate(order, order.lines);
    if (duplicate) return { ok: true, status: 200, orderGroup: duplicate, duplicate: true };

    const result = this.storage.placeOrder({
      fullName: order.fullName,
      phone: order.phone,
      // NewStore reads `city` as the two-digit wilaya code and prints « 16 — Alger » on the slip.
      city: String(order.wilaya).padStart(2, '0'),
      address: [order.commune, order.address].filter(Boolean).join(' — '),
      notes: [this.returnsWarning(order.phone), order.notes].filter(Boolean).join(' — ') || null,
      deliveryType: order.deliveryType,
      delivery: delivery ? { carrier: delivery.carrier, wilaya: order.wilaya } : undefined,
      lines: order.lines.map((l) => ({ externalId: l.externalId, quantity: l.quantity, color: l.color, size: l.size })),
    });
    if (!result.ok) return { ok: false, status: result.status, refusal: this.#explain(result, order) };
    return { ok: true, status: 201, orderGroup: result.orderGroup };
  }

  /** The package's French refusal → what the customer is told, in their language. */
  #explain(result, order) {
    if (result.status === 409) {
      const { byExternalId } = this.catalogue.snapshot();
      for (const line of order.lines) {
        const product = byExternalId.get(line.externalId);
        if (!product) continue;
        const cell = product.isModel ? Number(product.grid[`${line.color ?? ''}||${line.size ?? ''}`] ?? 0) : product.stock;
        if (cell < line.quantity) return { code: 'stock', product, available: Math.max(0, cell) };
      }
      return { code: 'stock', product: null, available: 0 };
    }
    if (result.status === 404) return { code: 'gone' };
    if (result.status === 422) return { code: 'delivery' };
    if (result.status === 400 && /n'existe pas/u.test(result.message)) return { code: 'variant' };
    return { code: 'generic', message: result.message };
  }

  /** A short signature so /merci/<ref> is only shown to whoever placed the order. */
  sign(orderGroup) {
    return createHmac('sha256', this.secret).update(`merci:${orderGroup}`).digest('hex').slice(0, 20);
  }

  verify(orderGroup, token) {
    const expected = Buffer.from(this.sign(orderGroup));
    const given = Buffer.from(String(token ?? ''));
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  /** One cart as the customer sees it: lines, totals, status and parcel. */
  summary(orderGroup) {
    const data = this.storage.shopData();
    const rows = data.orders.filter((r) => r.order_group === orderGroup);
    if (!rows.length) return null;
    const { byId } = this.catalogue.snapshot();
    const productRows = new Map(data.products.map((p) => [p.id, p]));
    const lines = rows.map((r) => {
      const product = byId.get(r.product_id);
      const productRow = productRows.get(r.product_id);
      return {
        product,
        nameAr: product?.nameAr ?? productRow?.name_ar ?? productRow?.name_fr ?? '',
        nameFr: product?.nameFr ?? productRow?.name_fr ?? '',
        color: r.selected_color,
        colorAr: product?.colors.find((c) => c.value === r.selected_color)?.labelAr ?? r.selected_color,
        colorFr: product?.colors.find((c) => c.value === r.selected_color)?.labelFr ?? r.selected_color,
        size: r.selected_size,
        quantity: Number(r.quantity),
        total: r.total_price,
      };
    });
    const subtotal = rows.reduce((sum, r) => sum + BigInt(toMinor(r.total_price)), 0n);
    const fee = rows[0].delivery_fee ?? null;
    const total = subtotal + BigInt(toMinor(fee ?? '0'));
    const parcel = data.orderTracking?.[orderGroup] ?? null;
    return {
      orderGroup,
      status: rows[0].status,
      phone: rows[0].phone,
      fullName: rows[0].full_name,
      createdAt: rows[0].created_at,
      deliveryType: rows[0].delivery_type,
      carrier: rows[0].delivery_carrier ?? null,
      carrierLabel: (data.deliveryOptions ?? []).find((o) => o.carrier === rows[0].delivery_carrier)?.label ?? rows[0].delivery_carrier ?? null,
      lines,
      subtotal: fromMinor(subtotal),
      fee,
      total: fromMinor(total),
      parcel,
    };
  }

  /** Tracking needs the reference AND the phone (contract §8: never one alone). */
  track(reference, phoneInput) {
    const phone = normalizePhone(phoneInput);
    const ref = String(reference ?? '').trim().toUpperCase();
    if (!phone || !/^[A-Z0-9-]{3,40}$/u.test(ref)) return null;
    const summary = this.summary(ref);
    if (!summary || summary.phone !== phone) return null;
    return summary;
  }
}

/** "1234.5000" → 12345000n (4 decimals), exact. */
export function toMinor(value) {
  const text = String(value ?? '0');
  const negative = text.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const minor = BigInt(whole || '0') * 10000n + BigInt((fraction + '0000').slice(0, 4));
  return negative ? -minor : minor;
}

export function fromMinor(minor) {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  return `${negative ? '-' : ''}${abs / 10000n}.${String(abs % 10000n).padStart(4, '0')}`;
}
