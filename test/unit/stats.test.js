// The shop's own statistics: counted right, private by construction, and turned into ideas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Stats, browser, device, isBot, source } from '../../src/stats.js';
import { buildReport } from '../../src/report.js';
import { insights } from '../../src/insights.js';
import { ContentStore } from '../../src/content.js';

const dir = () => mkdtempSync(join(tmpdir(), 'tw-stats-'));
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const IG_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0';

test('robots are not visitors; sources, devices and in-app browsers are recognised', () => {
  assert.equal(isBot('Googlebot/2.1'), true);
  assert.equal(isBot('facebookexternalhit/1.1'), true);
  assert.equal(isBot(''), true);
  assert.equal(isBot(PHONE_UA), false);
  assert.equal(device(PHONE_UA), 'mobile');
  assert.equal(browser(IG_UA), 'Instagram (in-app)');
  assert.equal(source('https://l.instagram.com/?u=x', '', 'thobeworld.com'), 'Instagram');
  assert.equal(source('https://m.facebook.com/', '', 'thobeworld.com'), 'Facebook');
  assert.equal(source('https://thobeworld.com/boutique', '', 'thobeworld.com'), 'Direct');
  assert.equal(source('', 'tiktok', 'thobeworld.com'), 'TikTok', 'utm_source wins');
  assert.equal(source('', '', 'thobeworld.com'), 'Direct');
});

test('one visitor per device per day; no IP, no identifier in what is kept; the salt goes at midnight', () => {
  let now = new Date('2026-11-27T10:00:00Z');
  const d = dir();
  const stats = new Stats({ dir: d, ownHost: 'thobeworld.com', now: () => now, flushMs: 0 });
  const who = { ip: '41.200.1.2', ua: PHONE_UA };
  stats.pageView({ path: '/', referrer: 'https://l.instagram.com/', lang: 'ar' }, who);
  stats.pageView({ path: '/p/qamis-1', referrer: '', lang: 'ar', product: 'p1' }, who);
  stats.pageView({ path: '/', referrer: '', lang: 'fr' }, { ip: '41.200.9.9', ua: IG_UA });
  assert.equal(stats.pageView({ path: '/' }, { ip: '1.1.1.1', ua: 'Googlebot' }), false);
  stats.event('add_to_cart', { product: 'p1' }, who);
  stats.search('Jellaba', false, who);
  stats.search('jellaba ', false, who);
  stats.notFound('/old-link', who);
  stats.flush();
  const [today] = stats.days('2026-11-27', '2026-11-27');
  assert.equal(today.visitors, 2);
  assert.equal(today.views, 3);
  assert.deepEqual(today.sources, { Instagram: 1, Direct: 1 });
  assert.equal(today.products.p1, 1);
  assert.equal(today.events.add_to_cart, 1);
  assert.deepEqual(today.searches.jellaba, { n: 2, zero: 2 });
  assert.equal(today.hours[11], 3, '10:00 UTC is 11 h in Algiers');
  assert.equal('_seen' in today || '_salt' in today, false, 'the report never carries the day’s hashes or salt');
  const file = readFileSync(join(d, 'stats', '2026-11-27.json'), 'utf8');
  assert.doesNotMatch(file, /41\.200/u, 'no IP address is ever written');

  now = new Date('2026-11-28T09:00:00Z'); // next day
  stats.pageView({ path: '/' }, who);
  stats.flush();
  const yesterday = JSON.parse(readFileSync(join(d, 'stats', '2026-11-27.json'), 'utf8'));
  assert.equal(yesterday._salt, undefined, 'yesterday’s salt is gone');
  assert.equal(yesterday._seen, undefined, 'and its visitor hashes');
  assert.equal(stats.days('2026-11-28', '2026-11-28')[0].visitors, 1, 'the same phone is a new visitor today: no follow-up across days');
  assert.deepEqual(readdirSync(join(d, 'stats')).sort(), ['2026-11-27.json', '2026-11-28.json']);
});

test('the report joins traffic and the orders, and the ideas speak only with enough data', () => {
  const now = new Date('2026-11-27T20:00:00Z');
  const d = dir();
  const stats = new Stats({ dir: d, ownHost: 'shop', now: () => now, flushMs: 0 });
  for (let i = 0; i < 60; i += 1) stats.pageView({ path: '/p/x', referrer: 'https://l.instagram.com/', product: 'p1' }, { ip: `41.0.0.${i}`, ua: PHONE_UA });
  for (let i = 0; i < 4; i += 1) stats.search('burnous', false, { ua: PHONE_UA });
  const at = '2026-11-27 18:30:00';
  const orders = [
    { order_group: 'WEB-1', status: 'delivered', phone: '0661000001', city: '16', delivery_carrier: 'noest', delivery_type: 'home', delivery_fee: '400.0000', total_price: '6900.0000', quantity: 1, product_id: 1, selected_size: '54', selected_color: 'Blanc', created_at: at },
    { order_group: 'WEB-2', status: 'returned', phone: '0661000002', city: '31', delivery_carrier: 'yalidine', delivery_type: 'stopdesk', delivery_fee: '250.0000', total_price: '13800.0000', quantity: 2, product_id: 1, selected_size: '56', selected_color: 'Blanc', created_at: at },
    { order_group: 'WEB-3', status: 'cancelled', phone: '0661000001', city: '16', delivery_carrier: 'noest', delivery_type: 'home', delivery_fee: '400.0000', total_price: '6900.0000', quantity: 1, product_id: 1, selected_size: '54', selected_color: 'Noir', created_at: at },
  ];
  const storage = { shopData: () => ({ orders, products: [] }) };
  const catalogue = { snapshot: () => ({ products: [{ id: 1, externalId: 'p1', nameFr: 'Qamis Sultan', stock: 0 }], byExternalId: new Map([['p1', { externalId: 'p1', nameFr: 'Qamis Sultan', stock: 0 }]]) }) };
  const content = new ContentStore({ dir: d });
  const r = buildReport({ stats, storage, catalogue, content, days: 7, now });
  assert.equal(r.kpis.visitors.value, 60);
  assert.equal(r.kpis.orders.value, 3);
  assert.equal(r.kpis.revenue.value, 20700, 'cancelled orders are not revenue');
  assert.equal(r.kpis.averageOrder.value, 10350);
  assert.equal(r.sales.returnRate, 50);
  assert.equal(r.sales.returningCustomers, 1, 'the same phone ordering again');
  assert.equal(r.sales.wilayas[0].name, 'Alger');
  assert.deepEqual(r.sales.sizes[0], { key: '56', value: 2 });
  assert.equal(r.products[0].views, 60);
  assert.equal(r.products[0].orders, 2);
  assert.equal(JSON.stringify(r).includes('0661000001'), false, 'no phone number in the report');
  const ideas = insights(r);
  assert.ok(ideas.some((i) => i.title.includes('burnous')), 'a search with no result becomes an idea');
  assert.ok(ideas.some((i) => i.title.includes('Instagram')), 'the main source is named');
});
