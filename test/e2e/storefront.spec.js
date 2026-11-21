// The shop front a customer browses: what H47 Pay pushed, drawn correctly, fast.
import { test, expect } from '@playwright/test';

const noErrors = (page) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
};

test('home: categories and products from H47 Pay, Arabic by default, no script error', async ({ page }) => {
  const errors = noErrors(page);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('.cats .cat')).toHaveCount(4);
  await expect(page.locator('.cats')).toContainText('قمصان');
  await expect(page.locator('.cats')).toContainText('عطور');
  await expect(page.getByRole('link', { name: /قميص السلطان/u }).first()).toBeVisible();
  // sold-out articles are not featured on the home page
  await expect(page.locator('.grid')).not.toContainText('قميص مطرز يدوياً');
  expect(errors).toEqual([]);
});

test('photos are compressed WebP in several sizes, lazy below the fold', async ({ page, request }) => {
  await page.goto('/boutique');
  const img = page.locator('.card .ph img').nth(5);
  await expect(img).toHaveAttribute('loading', 'lazy');
  const srcset = await img.getAttribute('srcset');
  expect(srcset).toMatch(/\/img\/320\/\S+ 320w, \/img\/480\//u);
  const src = await img.getAttribute('src');
  const name = src.split('/').pop();
  const webp = await request.get(src);
  expect(webp.headers()['content-type']).toBe('image/webp');
  expect(webp.headers()['cache-control']).toContain('immutable');
  const original = await request.get(`/uploads/${decodeURIComponent(name)}`);
  const ratio = (await webp.body()).length / (await original.body()).length;
  expect(ratio).toBeLessThan(0.1); // the phone photo H47 Pay sent is ten times heavier than what the customer downloads
});

test('product landing page: colours, sold-out cells, gallery per colour', async ({ page }) => {
  const errors = noErrors(page);
  await page.goto('/p/qamis-sultan-lin-1');
  await expect(page.locator('h1')).toHaveText('قميص السلطان — كتان');
  await expect(page.locator('[data-price]')).toContainText('6 900');
  await expect(page.locator('.pprice s')).toContainText('8 500');
  // Bleu nuit has no stock at all: crossed out
  await expect(page.locator('[data-color="Bleu nuit"]')).toHaveClass(/out/u);
  // Blanc is chosen first; its 56 is at 0
  await expect(page.locator('[data-color="Blanc"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-size="56"]')).toBeDisabled();
  await expect(page.locator('[data-size="54"]')).toBeEnabled();
  const blancPhoto = await page.locator('[data-main-photo] img').getAttribute('src');
  // Beige: 56 is back, 58 goes, and the photos follow the colour
  await page.locator('[data-color="Beige"]').click();
  await expect(page.locator('[data-color-name]')).toHaveText('بيج');
  await expect(page.locator('[data-size="56"]')).toBeEnabled();
  await expect(page.locator('[data-size="58"]')).toBeDisabled();
  await expect(page.locator('[data-main-photo] img')).not.toHaveAttribute('src', blancPhoto);
  // one Beige 60 left
  await page.locator('[data-size="60"]').click();
  await expect(page.locator('[data-stock]')).toHaveText('آخر قطعة!');
  await page.locator('[data-qty="1"]').click();
  await expect(page.locator('[data-qty-value]')).toHaveText('1'); // capped at the stock
  // structured data for Google
  const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
  expect(ld['@type']).toBe('Product');
  expect(ld.offers.priceCurrency).toBe('DZD');
  expect(errors).toEqual([]);
});

test('a plain article with details (specs) and a promotion', async ({ page }) => {
  await page.goto('/p/parfum-oud-royal-50-ml-6');
  await expect(page.locator('table.specs')).toContainText('50 ml');
  await expect(page.locator('table.specs')).toContainText('الثبات');
  await expect(page.locator('.save')).toBeVisible();
});

test('category filters, search and French', async ({ page }) => {
  await page.goto('/c/qamis?couleur=Noir');
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.card')).toContainText('قميص السلطان');
  await page.goto('/recherche?q=oud');
  await expect(page.locator('.card')).toHaveCount(1);
  await page.goto('/recherche?q=مسك');
  await expect(page.locator('.card')).toContainText('مسك أبيض');
  await page.goto('/p/qamis-sultan-lin-1?lang=fr');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('h1')).toHaveText('Qamis Sultan — lin');
  await page.goto('/'); // the choice is remembered
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await page.goto('/?lang=ar');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
});

test('unknown pages answer 404 with suggestions; SEO files exist', async ({ page, request }) => {
  const res = await page.goto('/p/nothing-999');
  expect(res.status()).toBe(404);
  await expect(page.locator('h1')).toHaveText('الصفحة غير موجودة');
  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(sitemap).toContain('/p/qamis-sultan-lin-1');
  expect(await (await request.get('/robots.txt')).text()).toContain('Sitemap:');
  // an old product URL redirects to the canonical one
  const moved = await request.get('/p/old-name-1', { maxRedirects: 0 });
  expect(moved.status()).toBe(301);
  expect(moved.headers().location).toBe('/p/qamis-sultan-lin-1');
});

test('no page scrolls sideways', async ({ page }) => {
  for (const path of ['/', '/boutique', '/p/qamis-sultan-lin-1', '/p/cheche-touareg-4-m-4', '/panier', '/commande', '/suivi', '/page/echanges']) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});

test('the product page is light: under 250 KB on first visit', async ({ page }) => {
  let bytes = 0;
  page.on('response', async (r) => {
    const len = Number(r.headers()['content-length'] ?? 0);
    if (len) bytes += len;
    else bytes += (await r.body().catch(() => Buffer.alloc(0))).length;
  });
  await page.goto('/p/qamis-sultan-lin-1', { waitUntil: 'networkidle' });
  expect(bytes).toBeLessThan(250_000);
});
