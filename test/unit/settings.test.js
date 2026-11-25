import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { loadConfig } from '../../src/config.js';
import { SiteSettings, cleanSettings, defaultSettings, safeHref, announceHtml } from '../../src/settings.js';

const setup = () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'thobe-settings-'));
  const config = loadConfig({ DATA_DIR: dataDir });
  return { dataDir, config, settings: new SiteSettings({ dataDir, config }) };
};

test('defaults reproduce the original banner', () => {
  const { settings } = setup();
  const s = settings.get();
  assert.equal(s.hero.title1.ar, 'تأنق');
  assert.equal(s.hero.title2.fr, 'comme un roi');
  assert.equal(s.hero.trust.length, 4);
  assert.equal(settings.imageUrl(), '/img/logo-gold.webp');
});

test('saved texts persist, are trimmed, and survive a restart', () => {
  const { dataDir, config, settings } = setup();
  const errors = settings.save({ announce: { ar: '  عرض  خاص ', fr: 'Promo' }, hero: { title1: { ar: 'مرحبا', fr: 'Salut' }, primary: { label: { ar: 'تسوق', fr: 'Acheter' }, href: '/c/qamis' } } });
  assert.deepEqual(errors, []);
  const again = new SiteSettings({ dataDir, config }).get();
  assert.equal(again.announce.ar, 'عرض خاص');
  assert.equal(again.hero.title1.fr, 'Salut');
  assert.equal(again.hero.primary.href, '/c/qamis');
});

test('only site paths and https links are accepted for buttons', () => {
  assert.equal(safeHref('/boutique'), '/boutique');
  assert.equal(safeHref('https://wa.me/213'), 'https://wa.me/213');
  assert.equal(safeHref(''), '');
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('//evil.example'), null);
  assert.equal(safeHref('http://plain.example'), null);
  const defaults = defaultSettings(loadConfig());
  const { settings, errors } = cleanSettings({ hero: { primary: { href: 'javascript:x' } } }, defaults);
  assert.deepEqual(errors, ['primary']);
  assert.equal(settings.hero.primary.href, '/boutique');
});

test('announcement HTML is escaped, **bold** becomes <b>', () => {
  assert.equal(String(announceHtml('<i>x</i> **58** wilayas')), '&lt;i&gt;x&lt;/i&gt; <b>58</b> wilayas');
});

test('a banner picture becomes one WebP; the old one is removed', async () => {
  const { settings } = setup();
  const png = await sharp({ create: { width: 1600, height: 2000, channels: 3, background: '#c9a45c' } }).png().toBuffer();
  const first = await settings.setImage(png);
  assert.match(first, /^hero-[a-f0-9]{16}\.webp$/u);
  assert.equal(settings.get().hero.imageFit, 'photo');
  const meta = await sharp(join(settings.mediaDir, first)).metadata();
  assert.equal(meta.format, 'webp');
  assert.ok(meta.width <= 1000);
  const jpg = await sharp({ create: { width: 400, height: 500, channels: 3, background: '#222' } }).jpeg().toBuffer();
  const second = await settings.setImage(jpg);
  assert.deepEqual(readdirSync(settings.mediaDir), [second]);
  await assert.rejects(settings.setImage(Buffer.from('not an image')), { code: 'image' });
  settings.clearImage();
  assert.equal(settings.imageUrl(), '/img/logo-gold.webp');
  assert.equal(existsSync(join(settings.mediaDir, second)), false);
});
