import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonFileSyncStorage } from '@h47io/sync-receiver';
import { OrderDesk } from '../../src/orders.js';
import { Catalogue } from '../../src/catalogue.js';
import { assetVersions } from '../../src/assets.js';

test('a phone with parcels returned before is flagged in the notes H47 Pay shows, never refused', () => {
  const storage = new JsonFileSyncStorage({ dir: mkdtempSync(join(tmpdir(), 'tw-ret-')) });
  const data = storage.shopData();
  data.products.push({
    id: 1, external_id: 'p1', sku: 'A', barcode: null, name_fr: 'Musc', name_ar: 'مسك', name_en: '', description_fr: '', description_ar: '', description_en: '',
    price: '1200.0000', wholesale_price: null, category: 'parfums', category_id: null, is_public: 1, is_service: 0, stock: '9.000000',
    colors: null, sizes: null, variant_stock: null, swatches: null, color_images: null, compare_at_price: null, badges: null, highlights_fr: null, highlights_ar: null, specs: null, landing_html: null,
  });
  const desk = new OrderDesk({ storage, catalogue: new Catalogue(storage), secret: 's', limits: { perIpWindowMin: 10, perIpMax: 9, duplicateWindowMin: 0 } });
  const order = (q) => ({ fullName: 'Ali', phone: '0661000000', wilaya: 16, commune: 'Hydra', address: '', notes: 'Après 17h', deliveryType: 'home', carrier: null, lines: [{ externalId: 'p1', quantity: q }] });

  const first = desk.place(order(1));
  assert.equal(storage.shopData().orders.at(-1).notes, 'Après 17h', 'a new customer: nothing added');
  // H47 Pay reports the parcel came back
  for (const row of storage.shopData().orders) if (row.order_group === first.orderGroup) row.status = 'returned';
  const second = desk.place(order(2));
  assert.equal(second.ok, true);
  assert.equal(storage.shopData().orders.at(-1).notes, '⚠ Client : 1 colis retourné auparavant — Après 17h');
});

test('a registered in-memory file is versioned by its own bytes', () => {
  const assets = assetVersions('/nonexistent', { 'a.css': 'one' });
  const before = assets.url('a.css');
  assets.register('a.css', 'two');
  assert.notEqual(assets.url('a.css'), before);
});
