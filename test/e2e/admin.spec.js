// The owner's dashboard: sign in, edit the home page banner, see it on the shop front.
import { test, expect } from '@playwright/test';
import sharp from 'sharp';

const signIn = async (page, password = 'e2e-admin-password') => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login$/u);
  await page.fill('input[name=user]', 'admin');
  await page.fill('input[name=password]', password);
  await page.click('button[type=submit]');
};

test('the dashboard is locked: a wrong password is refused, a POST without session too', async ({ page, request }) => {
  await signIn(page, 'wrong');
  await expect(page.locator('.note.bad')).toContainText('incorrect');
  const res = await request.post('/admin', { form: { title1_ar: 'x' }, maxRedirects: 0 });
  expect(res.status()).toBe(401);
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toContain('Disallow: /admin');
});

test('the owner edits the banner and the announcement, and the home page follows', async ({ page }) => {
  await signIn(page);
  await expect(page.locator('h1')).toHaveText('Page d’accueil');
  await page.fill('input[name=announce_ar]', 'تخفيضات **50%** هذا الأسبوع');
  await page.fill('input[name=title1_ar]', 'البس');
  await page.fill('input[name=title2_ar]', 'كالسلطان');
  await page.fill('input[name=primary_ar]', 'اكتشف الشاش');
  await page.fill('input[name=primary_href]', '/c/cheche');
  await page.fill('input[name=trust3_ar]', '');
  await page.click('button:has-text("Enregistrer")');
  await expect(page.locator('.note.ok')).toBeVisible();

  await page.goto('/');
  await expect(page.locator('.announce')).toContainText('تخفيضات 50% هذا الأسبوع');
  await expect(page.locator('.announce b')).toHaveText('50%');
  await expect(page.locator('.hero h1')).toContainText('البس');
  await expect(page.locator('.hero h1 em')).toHaveText('كالسلطان');
  await expect(page.locator('.hero .btn-ink')).toHaveText('اكتشف الشاش');
  await expect(page.locator('.hero .btn-ink')).toHaveAttribute('href', '/c/cheche');
  await expect(page.locator('.hero .trust > div')).toHaveCount(3);
  // French untouched
  await page.goto('/?lang=fr');
  await expect(page.locator('.hero h1 em')).toHaveText('comme un roi');
  await page.goto('/?lang=ar');

  // A dangerous link is refused and the old one kept.
  await page.goto('/admin');
  await page.fill('input[name=primary_href]', 'javascript:alert(1)');
  await page.click('button:has-text("Enregistrer")');
  await expect(page.locator('.note.bad')).toContainText('bouton 1');
  await expect(page.locator('input[name=primary_href]')).toHaveValue('/c/cheche');

  // Banner picture.
  const png = await sharp({ create: { width: 900, height: 1100, channels: 3, background: '#8a6a3a' } }).png().toBuffer();
  await page.setInputFiles('[data-upload]', { name: 'hero.png', mimeType: 'image/png', buffer: png });
  await expect(page).toHaveURL(/\/admin\?ok=saved$/u);
  await page.goto('/');
  await expect(page.locator('.hero-art')).toHaveClass(/is-photo/u);
  const src = await page.locator('.hero-art img').getAttribute('src');
  expect(src).toMatch(/^\/site\/hero-[a-f0-9]{16}\.webp$/u);
  const img = await page.request.get(src);
  expect(img.headers()['content-type']).toBe('image/webp');

  // Back to the defaults for the other tests.
  await page.goto('/admin');
  await page.click('button:has-text("Remettre le logo")');
  page.once('dialog', (d) => d.accept());
  await page.click('[data-reset]');
  await expect(page.locator('.note.ok')).toContainText('défaut');
  await page.goto('/');
  await expect(page.locator('.hero h1 em')).toHaveText('كأنك ملك');
  await expect(page.locator('.hero-art img')).toHaveAttribute('src', '/img/logo-gold.webp');

  await page.goto('/admin');
  await page.click('button:has-text("Déconnexion")');
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login$/u);
});
