import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { Catalogue, availableFor, filterProducts, search, slugify } from '../../src/catalogue.js';
import { ImageOptimizer, imageSet } from '../../src/images.js';

const row = (over) => ({
  id: 1, external_id: 'm1', sku: 'QSL', barcode: null, name_fr: 'Qamis Sultan', name_ar: 'قميص السلطان', name_en: '', description_fr: '', description_ar: '', description_en: '',
  price: '6900.0000', wholesale_price: null, category: 'qamis', category_id: 1, is_public: 1, is_service: 0, stock: '5.000000',
  colors: null, sizes: null, variant_stock: null, swatches: null, color_images: null, compare_at_price: null, badges: null, highlights_fr: null, highlights_ar: null, specs: null, landing_html: null,
  ...over,
});

const fakeStorage = (products, images = []) => ({
  shopData: () => ({ products, images, categories: [{ id: 1, code: 'QAMIS', slug: 'qamis', name_fr: 'Qamis', name_ar: 'قمصان', name_en: '' }] }),
});

test('a modèle becomes one product with colours, sizes, per-variant stock and per-colour photos', () => {
  const model = row({
    colors: '["Blanc","Noir"]', sizes: '["52","54"]',
    variant_stock: '{"Blanc||52":2,"Blanc||54":0,"Noir||52":0,"Noir||54":0}',
    swatches: '[{"value":"Blanc","label_fr":"Blanc","label_ar":"أبيض","hex":"#FFFFFF"},{"value":"Noir","label_fr":"Noir","label_ar":"أسود","hex":null}]',
    color_images: '{"Noir":["bbb"]}', compare_at_price: '8500.0000',
  });
  const images = [
    { id: 1, product_id: 1, content_hash: 'aaa', sort_order: 0, image_path: '/uploads/a.jpg' },
    { id: 2, product_id: 1, content_hash: 'bbb', sort_order: 1, image_path: '/uploads/b.jpg' },
  ];
  const [p] = new Catalogue(fakeStorage([model], images)).snapshot().products;
  assert.equal(p.isModel, true);
  assert.equal(p.stock, 2);
  assert.deepEqual(p.gallery, ['/uploads/a.jpg'], 'the colour photo is not in the model gallery');
  assert.deepEqual(p.colors.find((c) => c.value === 'Noir').photos, ['/uploads/b.jpg']);
  assert.equal(p.colors.find((c) => c.value === 'Noir').stock, 0);
  assert.equal(p.colors.find((c) => c.value === 'Noir').hex, null, 'no swatch colour: never a guess');
  assert.equal(p.compareAt, '8500.0000');
  assert.equal(availableFor(p, 'Blanc', '52'), 2);
  assert.equal(availableFor(p, 'Blanc', '54'), 0);
  assert.equal(p.categoryNameAr, 'قمصان');
});

test('hidden articles and services never reach the shop front', () => {
  const list = new Catalogue(fakeStorage([row({ id: 1 }), row({ id: 2, is_public: 0 }), row({ id: 3, is_service: 1 })])).snapshot().products;
  assert.deepEqual(list.map((p) => p.id), [1]);
});

test('search works in Arabic and French, filters respect stock', () => {
  const cat = new Catalogue(fakeStorage([row({ id: 1 }), row({ id: 2, name_fr: 'Parfum Oud', name_ar: 'عطر العود', stock: '0.000000', price: '4200.0000' })]));
  const { products } = cat.snapshot();
  assert.deepEqual(search(products, 'oud').map((p) => p.id), [2]);
  assert.deepEqual(search(products, 'العود').map((p) => p.id), [2]);
  assert.deepEqual(search(products, 'sultan').map((p) => p.id), [1]);
  assert.deepEqual(filterProducts(products, { stock: '1' }).map((p) => p.id), [1]);
  assert.deepEqual(filterProducts(products, { sort: 'price_asc' }).map((p) => p.id), [2, 1]);
  assert.equal(slugify('Qamis Émirati — lin'), 'qamis-emirati-lin');
});

test('photos are served as resized WebP, far lighter than the original', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tw-img-'));
  const optimizer = new ImageOptimizer({ uploadsDir: dir, cacheDir: join(dir, 'cache') });
  const big = await sharp({ create: { width: 2400, height: 3000, channels: 3, background: '#E8DCC4', noise: { type: 'gaussian', mean: 128, sigma: 30 } } }).jpeg({ quality: 92 }).toBuffer();
  writeFileSync(join(dir, 'prod_x.jpg'), big);
  const file = await optimizer.get(720, 'prod_x.jpg');
  const meta = await sharp(file).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 720);
  assert.ok(statSync(file).size < big.length / 4, `${statSync(file).size} vs ${big.length}`);
  assert.equal(await optimizer.get(700, 'prod_x.jpg'), null, 'only the listed widths');
  assert.equal(await optimizer.get(720, '../secret'), null, 'no path tricks');
  assert.equal(await optimizer.get(720, 'missing.jpg'), null);
  const set = imageSet('/uploads/prod_x.jpg', { max: 960 });
  assert.match(set.srcset, /\/img\/320\/prod_x\.jpg 320w/u);
});
