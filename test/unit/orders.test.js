import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonFileSyncStorage } from '@h47io/sync-receiver';
import { normalizePhone, validateOrder, OrderDesk, toMinor, fromMinor } from '../../src/orders.js';
import { Catalogue, formatMoney } from '../../src/catalogue.js';

test('Algerian mobile numbers are normalised, everything else refused', () => {
  assert.equal(normalizePhone('0661 23 45 67'), '0661234567');
  assert.equal(normalizePhone('+213 661-23-45-67'), '0661234567');
  assert.equal(normalizePhone('00213551234567'), '0551234567');
  assert.equal(normalizePhone('٠٧٧٠١٢٣٤٥٦'), '0770123456');
  assert.equal(normalizePhone('0221234567'), null, 'landline');
  assert.equal(normalizePhone('066123456'), null, 'too short');
  assert.equal(normalizePhone('abc'), null);
});

test('the order form is validated and identical lines are merged', () => {
  const base = { fullName: 'Karim B', phone: '0661234567', wilaya: '16', commune: 'Bab Ezzouar', lines: [] };
  assert.deepEqual(validateOrder({ ...base, fullName: 'K' }), { ok: false, field: 'fullName', code: 'name' });
  assert.equal(validateOrder({ ...base, phone: '123' }).field, 'phone');
  assert.equal(validateOrder({ ...base, wilaya: '59' }).field, 'wilaya');
  assert.equal(validateOrder({ ...base, commune: '' }).field, 'commune');
  assert.equal(validateOrder(base).field, 'lines');
  const ok = validateOrder({
    ...base,
    deliveryOption: 'stopdesk',
    lines: [
      { externalId: 'x', color: 'Blanc', size: '54', quantity: 1 },
      { externalId: 'x', color: 'Blanc', size: '54', quantity: 2 },
      { externalId: 'y', quantity: 0 },
    ],
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.order.deliveryType, 'stopdesk');
  assert.deepEqual(ok.order.lines, [{ externalId: 'x', color: 'Blanc', size: '54', quantity: 3 }]);
});

test('money stays exact and is displayed in whole dinars', () => {
  assert.equal(fromMinor(toMinor('6900.0000') * 2n + toMinor('250.0000')), '14050.0000');
  assert.equal(formatMoney('14050.0000'), '14 050');
  assert.equal(formatMoney('1200.5000'), '1 200,50');
});

function desk({ now = () => new Date('2026-11-21T10:00:00Z') } = {}) {
  const storage = new JsonFileSyncStorage({ dir: mkdtempSync(join(tmpdir(), 'tw-unit-')) });
  const data = storage.shopData();
  data.products.push({
    id: 1, external_id: 'm1', sku: 'QSL', barcode: null, name_fr: 'Qamis', name_ar: 'قميص', name_en: '', description_fr: '', description_ar: '', description_en: '',
    price: '6900.0000', wholesale_price: null, category: 'qamis', category_id: null, is_public: 1, is_service: 0, stock: '3.000000',
    colors: '["Blanc"]', sizes: '["54"]', variant_stock: '{"Blanc||54":3}', swatches: null, color_images: null, compare_at_price: null, badges: null, highlights_fr: null, highlights_ar: null, specs: null, landing_html: null,
  });
  data.deliveryOptions = [{ carrier: 'noest', label: 'Noest', wilaya: 16, home: '400.0000', stopdesk: '250.0000' }];
  const catalogue = new Catalogue(storage);
  return new OrderDesk({ storage, catalogue, secret: 's', limits: { perIpWindowMin: 10, perIpMax: 2, duplicateWindowMin: 30 }, now });
}

const order = (over = {}) => ({ fullName: 'Karim', phone: '0661234567', wilaya: 16, commune: 'Hydra', address: '', notes: '', deliveryType: 'home', carrier: null, lines: [{ externalId: 'm1', color: 'Blanc', size: '54', quantity: 2 }], ...over });

test('an order is placed with the server-side delivery fee, and a double submit returns the same reference', () => {
  const d = desk();
  const first = d.place(order());
  assert.equal(first.ok, true);
  const rows = d.storage.shopData().orders;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].delivery_fee, '400.0000');
  assert.equal(rows[0].delivery_carrier, 'noest');
  assert.equal(rows[0].city, '16');
  assert.equal(rows[0].total_price, '13800.0000');
  const again = d.place(order());
  assert.equal(again.orderGroup, first.orderGroup);
  assert.equal(again.duplicate, true);
  assert.equal(d.storage.shopData().orders.length, 1);
  const summary = d.summary(first.orderGroup);
  assert.equal(summary.total, '14200.0000');
});

test('more than the stock, or an undelivered wilaya, is refused', () => {
  const d = desk();
  const tooMany = d.place(order({ lines: [{ externalId: 'm1', color: 'Blanc', size: '54', quantity: 4 }] }));
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.status, 409);
  const far = d.place(order({ wilaya: 11 }));
  assert.equal(far.ok, false);
  assert.equal(far.status, 422);
});

test('tracking needs the reference AND the phone; the thank-you link is signed', () => {
  const d = desk();
  const { orderGroup } = d.place(order());
  assert.ok(d.track(orderGroup, '+213661234567'));
  assert.equal(d.track(orderGroup, '0770000000'), null);
  assert.ok(d.verify(orderGroup, d.sign(orderGroup)));
  assert.equal(d.verify(orderGroup, 'nope'), false);
});

test('one device may not flood the inbox', () => {
  const d = desk();
  assert.equal(d.allow('1.2.3.4'), true);
  assert.equal(d.allow('1.2.3.4'), true);
  assert.equal(d.allow('1.2.3.4'), false);
  assert.equal(d.allow('5.6.7.8'), true);
});
