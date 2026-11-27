// The website dashboard (/admin) end to end: the owner signs in, builds the
// home carousel, prepares an exclusive launch; the customer sees the countdown,
// asks to be told, cannot order early; at the hour the launch opens, limited
// and capped per customer. Then everything is removed and the site is as before.
import { test, expect } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { ADMIN_PASSWORD } from './global-setup.js';

test.describe.configure({ mode: 'serial' });

const dir = mkdtempSync(join(tmpdir(), 'tw-dash-'));
const picture = async (name, width, height, colour) => {
  const file = join(dir, name);
  await sharp({ create: { width, height, channels: 3, background: colour } }).jpeg({ quality: 80 }).toFile(file);
  return file;
};
const inAlgiers = (ms) => new Date(Date.now() + ms + 3_600_000).toISOString().slice(0, 16);
const CUSTOMER = '0770 11 22 33';
let admin; // the owner's signed-in page, kept across the steps
let launchUrl;
let productUrl;

const order = (page, quantity, size = '56') => page.evaluate(async ([q, z]) => {
  const externalId = window.TW_PRODUCT.externalId;
  const res = await fetch('/api/order', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: 'Client Lancement', phone: '0770112233', wilaya: 16, commune: 'Bab Ezzouar', carrier: 'noest', deliveryOption: 'home', lines: [{ externalId, color: 'Blanc', size: z, quantity: q }] }),
  });
  return { status: res.status, ...(await res.json()) };
}, [quantity, size]);

/** The real Meta/TikTok/Google scripts are not fetched in tests: the pages' own queues are what we check. */
const stubAdScripts = (page) => page.route(/connect\.facebook\.net|analytics\.tiktok\.com|googletagmanager\.com/u, (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
const queues = (page) => page.evaluate(() => ({
  fbq: (window.fbq?.queue ?? []).map((a) => Array.from(a)),
  ttq: Array.isArray(window.ttq) ? window.ttq.map((a) => Array.from(a)) : [],
  gtag: (window.dataLayer ?? []).map((a) => Array.from(a)),
}));

test('1. the dashboard is closed to strangers', async ({ page, request }) => {
  await page.goto('/admin/carrousel');
  await expect(page).toHaveURL(/\/admin\/login$/u);
  await page.locator('input[name=user]').fill('admin');
  await page.locator('input[name=password]').fill('not-the-password');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('.notice.err')).toHaveText('Identifiant ou mot de passe incorrect.');
  // a form posted from another site is refused even before the password is checked
  const forged = await request.post('/admin/login', { headers: { origin: 'https://evil.example' }, form: { user: 'admin', password: ADMIN_PASSWORD } });
  expect(forged.status()).toBe(403);
  expect((await request.get('/robots.txt').then((r) => r.text()))).toContain('Disallow: /admin');
});

test('2. the owner signs in and builds a two-slide carousel', async ({ browser }) => {
  admin = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  await admin.goto('/admin/login');
  await admin.locator('input[name=user]').fill('admin');
  await admin.locator('input[name=password]').fill(ADMIN_PASSWORD);
  await admin.getByRole('button', { name: 'Se connecter' }).click();
  await expect(admin).toHaveURL(/\/admin\/statistiques$/u); // the dashboard opens on its statistics
  await admin.getByRole('link', { name: 'Carrousel' }).click();
  await expect(admin.locator('.card.empty')).toContainText('Aucune diapositive');

  await admin.getByRole('link', { name: '+ Ajouter une diapositive' }).click();
  // saving without the picture is stopped in the page
  await admin.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(admin.locator('[data-status]').first()).toHaveText('Ajoutez d’abord cette image.');
  const files = admin.locator('[data-upload] input[type=file]');
  await files.nth(0).setInputFiles(await picture('wide.jpg', 1920, 800, '#8A6A2E'));
  await expect(admin.locator('[data-status]').nth(0)).toHaveText('Image prête. Pensez à enregistrer.');
  await files.nth(1).setInputFiles(await picture('tall.jpg', 1080, 1350, '#2E2922'));
  await expect(admin.locator('[data-status]').nth(1)).toHaveText('Image prête. Pensez à enregistrer.');
  await admin.locator('input[name=titleAr]').fill('تشكيلة العيد');
  await admin.locator('input[name=titleFr]').fill('Collection de l’Aïd');
  await admin.locator('input[name=buttonAr]').fill('اكتشف');
  await admin.locator('input[name=link]').fill('/c/qamis');
  await admin.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(admin.locator('.notice.ok')).toHaveText('Diapositive enregistrée.');

  await admin.getByRole('link', { name: '+ Ajouter une diapositive' }).click();
  await admin.locator('[data-upload] input[type=file]').first().setInputFiles(await picture('wide2.jpg', 1920, 800, '#3D4B3F'));
  await expect(admin.locator('[data-status]').first()).toHaveText('Image prête. Pensez à enregistrer.');
  await admin.locator('input[name=titleAr]').fill('عطور جديدة');
  await admin.locator('input[name=link]').fill('javascript:alert(1)'); // refused quietly: no link
  await admin.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(admin.locator('.rows .row')).toHaveCount(2);
});

test('3. the home page opens on the carousel, resized photos, a phone picture, working dots', async ({ page }) => {
  await page.goto('/');
  const carousel = page.locator('[data-carousel]');
  await expect(carousel.locator('.slide')).toHaveCount(2);
  await expect(page.locator('section.hero')).toHaveCount(0); // the carousel replaces the static banner
  const first = carousel.locator('.slide').first();
  await expect(first.locator('h2')).toHaveText('تشكيلة العيد');
  await expect(first.locator('a')).toHaveAttribute('href', '/c/qamis');
  await expect(first.locator('img')).toHaveAttribute('fetchpriority', 'high');
  await expect(first.locator('source[media="(max-width:700px)"]')).toHaveCount(1);
  await expect(carousel.locator('.slide').nth(1).locator('a')).toHaveCount(0);
  const src = await first.locator('img').getAttribute('src');
  const webp = await page.request.get(src);
  expect(webp.headers()['content-type']).toBe('image/webp');
  await carousel.locator('[data-dots] button').nth(1).click();
  await expect(carousel.locator('[data-dots] button').nth(1)).toHaveAttribute('aria-current', 'true');
});

test('4. an exclusive launch two days ahead: countdown, « notify me », no early orders', async ({ page }) => {
  await admin.getByRole('link', { name: 'Lancements' }).click();
  await admin.getByRole('link', { name: '+ Nouveau lancement' }).click();
  await admin.locator('input[name=titleAr]').fill('الإصدار الإماراتي');
  await admin.locator('input[name=titleFr]').fill('Édition Émirats');
  await admin.locator('input[name=launchAt]').fill(inAlgiers(2 * 86_400_000));
  await admin.locator('input[name=maxPerCustomer]').fill('2');
  await admin.locator('[data-filter]').fill('émirati');
  await expect(admin.locator('.pitem:visible')).toHaveCount(1);
  await admin.locator('.pitem:visible input').check();
  await expect(admin.locator('[data-picked]')).toHaveText('1 choisi(s)');
  await admin.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(admin.locator('.notice.ok')).toHaveText('Lancement enregistré.');
  launchUrl = await admin.getByRole('link', { name: 'Voir ↗' }).getAttribute('href');
  expect(launchUrl).toBe('/lancement/edition-emirats');

  await page.goto('/');
  const strip = page.locator('.launch-strip');
  await expect(strip).toContainText('الإصدار الإماراتي');
  await expect(strip.locator('[data-countdown] [data-unit="d"]')).toHaveText(/^0[12]$/u);

  await page.goto(launchUrl);
  await expect(page.locator('h1')).toHaveText('الإصدار الإماراتي');
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.card .badge.launch')).toHaveText('قريباً');
  productUrl = await page.locator('.card').getAttribute('href');

  await page.goto(productUrl);
  await expect(page.locator('[data-order-form]')).toHaveCount(0);
  await expect(page.locator('[data-add-to-cart]')).toHaveCount(0);
  await expect(page.locator('.launch-box [data-countdown]')).toBeVisible();
  const seconds = await page.locator('.launch-box [data-unit="s"]').textContent();
  await expect(page.locator('.launch-box [data-unit="s"]')).not.toHaveText(seconds); // it moves
  await page.locator('#notify input[name=phone]').fill('0221');
  await page.locator('#notify button[type=submit]').click();
  await expect(page.locator('[data-notify-msg]')).toContainText('رقم الهاتف غير صحيح');
  await page.locator('#notify input[name=name]').fill('سليم');
  await page.locator('#notify input[name=phone]').fill(CUSTOMER);
  await page.locator('#notify button[type=submit]').click();
  await expect(page.locator('[data-notify-msg]')).toHaveText('تم! سنراسلك عند الافتتاح.');

  // the server refuses an early order whatever the page does
  const early = await order(page, 1);
  expect(early.status).toBe(409);
  expect(early.code).toBe('launchLocked');
  expect(early.message).toContain('يُطرح');
  const cart = await page.evaluate(async () => (await (await fetch('/api/cart', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lines: [{ externalId: window.TW_PRODUCT.externalId, color: 'Blanc', size: '56' }] }) })).json()).lines[0]);
  expect(cart.available).toBe(0);
});

test('5. the owner sees who asked, with a WhatsApp message ready', async () => {
  await admin.goto('/admin/lancements');
  await admin.getByRole('link', { name: 'Inscrits (1)' }).click();
  const row = admin.locator('table tbody tr');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('سليم');
  await expect(row).toContainText('0770112233');
  const wa = await row.getByRole('link', { name: 'WhatsApp' }).getAttribute('href');
  expect(wa).toMatch(/^https:\/\/wa\.me\/213770112233\?text=/u);
  expect(decodeURIComponent(wa)).toContain('/lancement/edition-emirats');
  const csv = await admin.request.get(`${new URL(admin.url()).pathname}.csv`);
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(await csv.text()).toContain('0770112233');
});

test('5b. the owner pastes the Meta, TikTok and Google codes; every page carries them at once', async ({ page }) => {
  await admin.getByRole('link', { name: 'Publicité' }).click();
  await expect(admin.locator('.pixel .pill.off')).toHaveCount(4);
  await admin.locator('input[name=meta]').fill('nope');
  await admin.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(admin.locator('.pixel .notice.err')).toContainText('Un identifiant de pixel Meta');
  await admin.locator('input[name=meta]').fill("<script>!function(f,b,e,v,n,t,s){}(window, document,'script','https://connect.facebook.net/en_US/fbevents.js'); fbq('init', '1234567890123456'); fbq('track', 'PageView');</script>");
  await admin.locator('input[name=tiktok]').fill("ttq.load('C4ABCDEFGHIJKLMNOPQR'); ttq.page();");
  await admin.locator('input[name=ga]').fill('G-AB12CD34EF');
  await admin.locator('input[name=adsId]').fill('AW-987654321/AbCdEf_123');
  await admin.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(admin.locator('.notice.ok')).toContainText('Pixels enregistrés');
  await expect(admin.locator('input[name=meta]')).toHaveValue('1234567890123456');
  await expect(admin.locator('input[name=adsLabel]')).toHaveValue('AbCdEf_123');
  await expect(admin.locator('.pixel .pill.on')).toHaveCount(4);

  await stubAdScripts(page);
  await page.goto('/');
  const q = await queues(page);
  expect(q.fbq).toContainEqual(['init', '1234567890123456']);
  expect(q.fbq).toContainEqual(['track', 'PageView']);
  expect(q.ttq).toContainEqual(['page']);
  expect(q.gtag).toContainEqual(['config', 'G-AB12CD34EF']);
  expect(q.gtag).toContainEqual(['config', 'AW-987654321']);
});

test('6. at the hour the launch opens: limited edition, 2 per customer', async ({ page }) => {
  await stubAdScripts(page);
  await admin.goto('/admin/lancements');
  await admin.getByRole('link', { name: 'Modifier' }).click();
  await admin.locator('input[name=launchAt]').fill(inAlgiers(-60_000 * 2));
  await admin.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(admin.locator('.pill.on')).toContainText('Ouvert depuis');

  await page.goto(productUrl);
  await expect(page.locator('.gallery .badge.launch')).toHaveText('حصري · كمية محدودة');
  await expect(page.locator('p.small').filter({ hasText: 'حد أقصى 2 لكل زبون' })).toBeVisible();
  await page.locator('[data-size="56"]').click();
  await expect(page.locator('[data-stock]')).toHaveText(/بقي 8 قطعة فقط من هذا الإصدار/u);
  for (let i = 0; i < 4; i += 1) await page.locator('[data-qty="1"]').click();
  await expect(page.locator('[data-qty-value]')).toHaveText('2'); // capped at the per-customer limit

  expect((await queues(page)).fbq.some((e) => e[0] === 'track' && e[1] === 'ViewContent')).toBe(true);
  const first = await order(page, 2);
  expect(first.status).toBe(201);
  // the thank-you page reports the sale to every platform, Google Ads conversion included:
  // 2 × 5 500 DA + 400 DA Noest home delivery to Algiers
  await page.goto(first.redirect);
  const sale = await queues(page);
  expect(sale.fbq.find((e) => e[1] === 'Purchase')[2]).toMatchObject({ value: 11400, currency: 'DZD' });
  expect(sale.ttq.some((e) => e[0] === 'track' && e[1] === 'CompletePayment')).toBe(true);
  expect(sale.gtag.find((e) => e[0] === 'event' && e[1] === 'conversion')[2]).toMatchObject({ send_to: 'AW-987654321/AbCdEf_123', value: 11400, currency: 'DZD', transaction_id: first.orderGroup });
  await page.goto(productUrl);
  const more = await order(page, 1, '58');
  expect(more.status).toBe(409);
  expect(more.code).toBe('launchMax');
  expect(more.message).toBe('هذا الإصدار الحصري محدود بـ 2 قطعة لكل زبون.');
});

test('7. removing the slides and the launch puts the site back as it was', async ({ page }) => {
  await admin.goto('/admin/lancements');
  admin.once('dialog', (d) => d.accept());
  await admin.getByRole('button', { name: 'Supprimer' }).click();
  await expect(admin.locator('.notice.ok')).toHaveText('Lancement supprimé.');
  await admin.goto('/admin/carrousel');
  for (let i = 0; i < 2; i += 1) {
    admin.once('dialog', (d) => d.accept());
    await admin.getByRole('button', { name: 'Supprimer' }).first().click();
    await expect(admin.locator('.notice.ok')).toHaveText('Diapositive supprimée.');
  }
  await admin.goto('/admin/publicite');
  for (const name of ['meta', 'tiktok', 'ga', 'adsId', 'adsLabel']) await admin.locator(`input[name=${name}]`).fill('');
  await admin.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(admin.locator('.pixel .pill.off')).toHaveCount(4);
  await admin.getByRole('button', { name: 'Déconnexion' }).click();
  await expect(admin).toHaveURL(/\/admin\/login$/u);
  await page.goto('/');
  await expect(page.locator('[data-carousel]')).toHaveCount(0);
  await expect(page.locator('section.hero')).toHaveCount(1);
  await expect(page.locator('.launch-strip')).toHaveCount(0);
  expect(await page.evaluate(() => typeof window.fbq)).toBe('undefined'); // pixels emptied: nothing loads
  expect((await page.goto(launchUrl)).status()).toBe(404);
  await page.goto(productUrl);
  await expect(page.locator('[data-order-form]')).toHaveCount(1);
});
