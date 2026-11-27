// Statistics end to end: a customer arrives from Instagram on a phone, looks,
// adds to cart, searches for something the shop does not sell; the owner sees it
// in the dashboard, downloads it, and H47 Pay can read it with the sync key.
import { test, expect } from '@playwright/test';
import { ADMIN_PASSWORD, KEY } from './global-setup.js';
import { IDS } from '../../scripts/fixtures.js';

test.describe.configure({ mode: 'serial' });

const PHONE_UA = 'Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

test('1. a visit is counted (a headless robot is not)', async ({ browser, page }) => {
  // Playwright's own browser says « HeadlessChrome »: it must not count.
  await page.goto('/');
  const customer = await (await browser.newContext({ userAgent: PHONE_UA, viewport: { width: 412, height: 860 } })).newPage();
  const beacon = customer.waitForRequest((r) => r.url().endsWith('/api/e'));
  await customer.goto('/?utm_source=instagram&utm_campaign=aid');
  await beacon;
  await customer.goto('/p/parfum-oud-royal-50-ml-6');
  await customer.locator('[data-add-to-cart]').click();
  await customer.waitForTimeout(300);
  await customer.goto('/recherche?q=burnous');
  await expect(customer.locator('.empty')).toBeVisible();
  await customer.waitForTimeout(300);
});

test('2. the owner sees it in « Statistiques », with ideas and exports', async ({ page }) => {
  await page.goto('/admin/login');
  await page.locator('input[name=user]').fill('admin');
  await page.locator('input[name=password]').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/admin\/statistiques$/u);
  await expect(page.locator('h1')).toHaveText('Statistiques');
  const visitors = Number((await page.locator('.tile').first().locator('b').textContent()).replace(/\D/gu, ''));
  expect(visitors).toBeGreaterThanOrEqual(1);
  await expect(page.locator('.card', { hasText: 'D’où viennent les visiteurs' })).toContainText('Instagram');
  await expect(page.locator('.card', { hasText: 'D’où viennent les visiteurs' })).toContainText('instagram / ? / aid');
  await expect(page.locator('.card', { hasText: 'Recherches sur le site' })).toContainText('burnous');
  await expect(page.locator('.card', { hasText: 'Recherches sur le site' })).toContainText('aucun article');
  await expect(page.locator('.card', { hasText: 'Articles' }).first()).toContainText('Parfum Oud Royal');
  await expect(page.locator('.ideas li').first()).toBeVisible();
  await expect(page.locator('svg.chart').first()).toBeVisible();
  // the address the site sees for this browser is shown, for the owner to check
  await expect(page.locator('code').filter({ hasText: /^127\.0\.0\.1$|^::1/u })).toHaveCount(1);
  await page.getByRole('link', { name: '7 jours' }).click();
  await expect(page.locator('.tabs a[aria-current]')).toHaveText('7 jours');
  const csv = await page.request.get('/admin/statistiques.csv?p=7&t=articles');
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(await csv.text()).toContain('Parfum Oud Royal');
  const json = await (await page.request.get('/admin/statistiques.json?p=7')).json();
  expect(json.kpis.visitors.value).toBeGreaterThanOrEqual(1);
});

test('3. H47 Pay reads the same report with the sync key; nothing personal in it', async ({ request }) => {
  expect((await request.get('/api/stats.json')).status()).toBe(401);
  expect((await request.get('/api/stats.json', { headers: { 'x-newstore-key': 'wrong' } })).status()).toBe(401);
  const placed = await request.post('/api/order', { data: { fullName: 'Client Statistiques', phone: '0550123456', wilaya: 16, commune: 'Bab Ezzouar', carrier: 'noest', deliveryOption: 'home', lines: [{ externalId: IDS.oud, quantity: 1 }] } });
  expect(placed.status()).toBe(201);
  const res = await request.get('/api/stats.json?days=30', { headers: { 'x-newstore-key': KEY } });
  expect(res.status()).toBe(200);
  const report = await res.json();
  expect(report.period.days).toBe(30);
  expect(Array.isArray(report.ideas)).toBe(true);
  expect(report.sales.orders).toBeGreaterThan(0);
  expect(report.sales.wilayas.some((w) => w.name === 'Alger')).toBe(true);
  const text = JSON.stringify(report);
  expect(text).not.toMatch(/0[567]\d{8}/u); // no phone number
  expect(text).not.toContain('Client Statistiques'); // no customer name
  expect(text).not.toContain('Bab Ezzouar'); // no address
});
