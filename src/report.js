/**
 * One report for a period: traffic (from src/stats.js), sales (from the orders
 * H47 Pay holds), the funnel between them, and the period before for comparison.
 * Used by the dashboard, its exports, and /api/stats.json for H47 Pay.
 *
 * Personal data never leaves this function: no name, phone or address, only
 * counts and amounts. (They stay in H47 Pay, where they belong.)
 */
import { dayOf, hourOf, orderDate, WILAYAS } from './stats.js';
import { toMinor, fromMinor } from './orders.js';

const DAY = 86_400_000;
const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);
const merge = (days, key) => {
  const out = {};
  for (const d of days) for (const [k, v] of Object.entries(d[key] ?? {})) out[k] = (out[k] ?? 0) + v;
  return out;
};
const top = (map, n = 20) => Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n).map(([key, value]) => ({ key, value }));
const money = (minor) => Number(fromMinor(minor));
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

/** The days [from, to] for « the last N days » ending today (Algiers). */
export function periodOf(days, now = new Date()) {
  const to = dayOf(now);
  const from = dayOf(new Date(now.getTime() - (days - 1) * DAY));
  const prevTo = dayOf(new Date(now.getTime() - days * DAY));
  const prevFrom = dayOf(new Date(now.getTime() - (2 * days - 1) * DAY));
  return { from, to, prevFrom, prevTo, days };
}

/** Orders grouped by cart, inside [from, to] (Algiers days). */
function carts(rows, from, to) {
  const groups = new Map();
  for (const row of rows) {
    const at = orderDate(row);
    const day = dayOf(at);
    if (day < from || day > to) continue;
    if (!groups.has(row.order_group)) groups.set(row.order_group, { ref: row.order_group, at, day, status: row.status, phone: row.phone, wilaya: Number(row.city) || null, carrier: row.delivery_carrier ?? null, type: row.delivery_type ?? 'home', fee: toMinor(row.delivery_fee ?? '0'), items: 0n, lines: [] });
    const cart = groups.get(row.order_group);
    cart.items += toMinor(row.total_price ?? '0');
    cart.lines.push(row);
  }
  return [...groups.values()];
}

function sales(rows, from, to, { productsById, firstSeen }) {
  const list = carts(rows, from, to);
  const kept = list.filter((c) => c.status !== 'cancelled');
  const statuses = {};
  for (const c of list) statuses[c.status] = (statuses[c.status] ?? 0) + 1;
  const revenue = kept.reduce((a, c) => a + c.items, 0n);
  const fees = kept.reduce((a, c) => a + c.fee, 0n);
  const decided = list.filter((c) => c.status !== 'pending').length;
  const confirmed = list.filter((c) => ['confirmed', 'shipped', 'delivered', 'returned'].includes(c.status)).length;
  const shipped = list.filter((c) => ['shipped', 'delivered', 'returned'].includes(c.status)).length;
  const byWilaya = {};
  const byCarrier = {};
  const byType = {};
  const sizes = {};
  const colors = {};
  const products = {};
  const hours = Array(24).fill(0);
  const weekdays = Array(7).fill(0);
  let returning = 0;
  for (const c of list) {
    const w = c.wilaya ?? 0;
    byWilaya[w] ??= { code: w, name: WILAYAS[w - 1] ?? '—', orders: 0, revenue: 0n, cancelled: 0, returned: 0, delivered: 0 };
    byWilaya[w].orders += 1;
    if (c.status === 'cancelled') byWilaya[w].cancelled += 1;
    else byWilaya[w].revenue += c.items;
    if (c.status === 'returned') byWilaya[w].returned += 1;
    if (c.status === 'delivered') byWilaya[w].delivered += 1;
    byCarrier[c.carrier ?? '—'] = (byCarrier[c.carrier ?? '—'] ?? 0) + 1;
    byType[c.type] = (byType[c.type] ?? 0) + 1;
    hours[hourOf(c.at)] += 1;
    weekdays[(new Date(c.at.getTime() + 3_600_000).getUTCDay() + 6) % 7] += 1; // Monday first
    if (firstSeen.get(c.phone) && firstSeen.get(c.phone) !== c.ref) returning += 1; // this phone's first order was another one
    if (c.status === 'cancelled') continue;
    for (const line of c.lines) {
      const q = Number(line.quantity) || 0;
      const p = productsById.get(line.product_id);
      const id = p?.externalId ?? `#${line.product_id}`;
      products[id] ??= { units: 0, revenue: 0n, orders: 0 };
      products[id].units += q;
      products[id].revenue += toMinor(line.total_price ?? '0');
      products[id].orders += 1;
      if (line.selected_size) sizes[line.selected_size] = (sizes[line.selected_size] ?? 0) + q;
      if (line.selected_color) colors[line.selected_color] = (colors[line.selected_color] ?? 0) + q;
    }
  }
  return {
    orders: list.length,
    ordersKept: kept.length,
    revenue: money(revenue),
    deliveryFees: money(fees),
    averageOrder: kept.length ? Math.round(money(revenue) / kept.length) : null,
    itemsSold: sum(kept, (c) => sum(c.lines, (l) => Number(l.quantity) || 0)),
    statuses,
    confirmationRate: pct(confirmed, decided),
    cancellationRate: pct(statuses.cancelled ?? 0, decided),
    returnRate: pct(statuses.returned ?? 0, shipped),
    returningCustomers: returning,
    newCustomers: list.length - returning,
    wilayas: Object.values(byWilaya).map((w) => ({ ...w, revenue: money(w.revenue) })).sort((a, b) => b.orders - a.orders),
    carriers: top(byCarrier, 10),
    deliveryTypes: top(byType, 5),
    sizes: top(sizes, 30),
    colors: top(colors, 30),
    hours,
    weekdays,
    products: Object.entries(products).map(([id, p]) => ({ id, ...p, revenue: money(p.revenue) })),
    daily: Object.fromEntries([...new Set(list.map((c) => c.day))].map((d) => [d, { orders: list.filter((c) => c.day === d).length, revenue: money(list.filter((c) => c.day === d && c.status !== 'cancelled').reduce((a, c) => a + c.items, 0n)) }])),
  };
}

export function buildReport({ stats, storage, catalogue, content, days = 30, now = new Date() }) {
  const period = periodOf(days, now);
  const data = storage.shopData();
  const snap = catalogue.snapshot();
  const productsById = new Map(snap.products.map((p) => [p.id, p]));
  const byExternal = snap.byExternalId;
  const firstSeen = new Map();
  // Each phone's first order (earliest, then lowest reference), to tell new customers from returning ones.
  const firstAt = new Map();
  const refNumber = (ref) => Number(String(ref).replace(/\D/gu, '')) || 0;
  for (const row of data.orders) {
    const t = orderDate(row).getTime();
    const seen = firstAt.get(row.phone);
    if (!seen || t < seen.t || (t === seen.t && refNumber(row.order_group) < refNumber(seen.ref))) firstAt.set(row.phone, { t, ref: row.order_group });
  }
  for (const [phone, first] of firstAt) firstSeen.set(phone, first.ref);

  const traffic = (from, to) => {
    const list = stats.days(from, to);
    return { list, visitors: sum(list, (d) => d.visitors), views: sum(list, (d) => d.views), events: merge(list, 'events') };
  };
  const now_ = traffic(period.from, period.to);
  const before = traffic(period.prevFrom, period.prevTo);
  const s = sales(data.orders, period.from, period.to, { productsById, firstSeen });
  const sBefore = sales(data.orders, period.prevFrom, period.prevTo, { productsById, firstSeen });

  const productViews = merge(now_.list, 'products');
  const cartAdds = merge(now_.list, 'cartProducts');
  const soldOut = merge(now_.list, 'soldOutViews');
  const name = (id) => byExternal.get(id)?.nameFr || byExternal.get(id)?.nameAr || id;
  const productIds = new Set([...Object.keys(productViews), ...Object.keys(cartAdds), ...s.products.map((p) => p.id)]);
  const products = [...productIds].filter((id) => id !== '(autres)').map((id) => {
    const sold = s.products.find((p) => p.id === id);
    const p = byExternal.get(id);
    return {
      id,
      name: name(id),
      views: productViews[id] ?? 0,
      cartAdds: cartAdds[id] ?? 0,
      orders: sold?.orders ?? 0,
      units: sold?.units ?? 0,
      revenue: sold?.revenue ?? 0,
      conversion: pct(sold?.orders ?? 0, productViews[id] ?? 0),
      stock: p?.stock ?? null,
      soldOutViews: soldOut[id] ?? 0,
    };
  }).sort((a, b) => b.views - a.views || b.revenue - a.revenue);

  const searchesMap = {};
  for (const d of now_.list) for (const [term, v] of Object.entries(d.searches ?? {})) {
    searchesMap[term] ??= { term, n: 0, zero: 0 };
    searchesMap[term].n += v.n;
    searchesMap[term].zero += v.zero;
  }
  const launches = content.launches().map((l) => ({
    title: l.titleFr || l.titleAr,
    launchAt: l.launchAt,
    subscribers: content.subscribers(l.id).filter((x) => x.at.slice(0, 10) >= period.from && x.at.slice(0, 10) <= period.to).length,
    views: merge(now_.list, 'launches')[l.slug] ?? 0,
  }));
  const slides = merge(now_.list, 'slides');

  const kpi = (cur, prev) => ({ value: cur, previous: prev, change: prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : null });
  return {
    period,
    since: stats.firstDay(),
    generatedAt: now.toISOString(),
    kpis: {
      visitors: kpi(now_.visitors, before.visitors),
      views: kpi(now_.views, before.views),
      orders: kpi(s.orders, sBefore.orders),
      revenue: kpi(s.revenue, sBefore.revenue),
      averageOrder: kpi(s.averageOrder ?? 0, sBefore.averageOrder ?? 0),
      conversion: kpi(pct(s.orders, now_.visitors) ?? 0, pct(sBefore.orders, before.visitors) ?? 0),
    },
    daily: now_.list.map((d) => ({ date: d.date, visitors: d.visitors, views: d.views, orders: s.daily[d.date]?.orders ?? 0, revenue: s.daily[d.date]?.revenue ?? 0 })),
    funnel: [
      { step: 'Visiteurs', value: now_.visitors },
      { step: 'Ont vu un article', value: sum(now_.list, (d) => d.productVisitors ?? 0) },
      { step: 'Ajouts au panier', value: now_.events.add_to_cart ?? 0 },
      { step: 'Formulaire de commande', value: now_.events.begin_checkout ?? 0 },
      { step: 'Commandes', value: s.orders },
    ],
    traffic: {
      sources: top(merge(now_.list, 'sources')),
      referrers: top(merge(now_.list, 'referrers')),
      campaigns: top(merge(now_.list, 'campaigns')),
      devices: top(merge(now_.list, 'devices'), 5),
      browsers: top(merge(now_.list, 'browsers'), 12),
      systems: top(merge(now_.list, 'systems'), 8),
      languages: top(merge(now_.list, 'languages'), 4),
      pages: top(merge(now_.list, 'pages'), 25),
      hours: Array.from({ length: 24 }, (_, h) => sum(now_.list, (d) => d.hours?.[h] ?? 0)),
      notFound: top(merge(now_.list, 'notFound'), 15),
    },
    products,
    searches: Object.values(searchesMap).sort((a, b) => b.n - a.n).slice(0, 40),
    sales: { ...s, products: undefined, daily: undefined },
    marketing: {
      launches,
      slideClicks: Object.entries(slides).map(([id, n]) => ({ id, title: content.slide(id)?.titleFr || content.slide(id)?.titleAr || id, clicks: n })),
      notifySignups: sum(launches, (l) => l.subscribers),
    },
  };
}
