// The whole life of an order, end to end, with H47 Pay on the other side:
// the customer orders on the site → H47 Pay pulls it → confirms it, moves the
// stock and pushes it back → hands the parcel to the courier → the customer tracks it.
import { test, expect } from '@playwright/test';
import { IDS } from '../../scripts/fixtures.js';
import { shop, allOrders } from './shop.js';

test.describe.configure({ mode: 'serial' });

const CUSTOMER = { name: 'كريم بن علي', phone: '0661 23 45 67', normalized: '0661234567' };
let reference;

async function fillCustomer(page, { name = CUSTOMER.name, phone = CUSTOMER.phone, wilaya, carrier, option, commune }) {
  const form = page.locator('[data-order-form]');
  await form.locator('input[name=fullName]').fill(name);
  await form.locator('input[name=phone]').fill(phone);
  await form.locator('select[name=wilaya]').selectOption(String(wilaya));
  if (carrier) await form.locator('select[name=delivery_carrier]').selectOption(carrier);
  if (option) await form.locator(`input[name=delivery_option][value=${option}]`).check();
  await expect(form.locator('[data-commune]')).toBeEnabled();
  await form.locator('[data-commune]').selectOption(commune);
}

test('1. the landing page form refuses a bad phone and a missing size, in Arabic', async ({ page }) => {
  await page.goto('/p/qamis-sultan-lin-1');
  let posted = false;
  page.on('request', (r) => { if (r.url().endsWith('/api/order')) posted = true; });
  await fillCustomer(page, { phone: '0221', wilaya: 16, carrier: 'yalidine', option: 'stopdesk', commune: 'Bab Ezzouar' });
  await page.locator('[data-submit]').click();
  await expect(page.locator('[data-err="phone"]')).toContainText('رقم الهاتف غير صحيح');
  await expect(page.locator('[data-toast]')).toContainText('اختر اللون والمقاس');
  expect(posted).toBe(false);
});

test('2. a customer orders 2 × Qamis Sultan Blanc 54 from the landing page, Yalidine stop desk in Alger', async ({ page }) => {
  await page.goto('/p/qamis-sultan-lin-1');
  await page.locator('[data-size="54"]').click();
  await expect(page.locator('[data-stock]')).toContainText('متوفر');
  await page.locator('[data-qty="1"]').click();
  await fillCustomer(page, { wilaya: 16, carrier: 'yalidine', option: 'stopdesk', commune: 'Bab Ezzouar' });
  await page.locator('input[name=address]').fill('حي 5 جويلية، عمارة 12');
  // the live total: 2 × 6 900 + 250 (Yalidine stop desk, Alger, from H47 Pay's list)
  await expect(page.locator('[data-sum-sub]')).toContainText('13 800');
  await expect(page.locator('[data-sum-ship]')).toContainText('250');
  await expect(page.locator('[data-sum-total]')).toContainText('14 050');
  await page.locator('[data-submit]').click();
  await page.waitForURL(/\/merci\/WEB-\d+\?t=/u);
  await expect(page.locator('h1')).toContainText('شكراً لك');
  reference = (await page.locator('[data-order-ref]').textContent()).trim();
  await expect(page.locator('.panel')).toContainText('14 050');
});

test('3. H47 Pay pulls the order: every key it needs, exactly', async () => {
  const rows = (await allOrders()).filter((r) => r.order_group === reference);
  expect(rows).toHaveLength(1);
  const row = rows[0];
  expect(row).toMatchObject({
    external_id: IDS.sultan,
    selected_color: 'Blanc',
    selected_size: '54',
    quantity: '2',
    unit_price: '6900.0000',
    total_price: '13800.0000',
    status: 'pending',
    phone: CUSTOMER.normalized,
    full_name: CUSTOMER.name,
    city: '16',
    delivery_type: 'stopdesk',
    delivery_carrier: 'yalidine',
    delivery_fee: '250.0000',
  });
  expect(row.address).toContain('Bab Ezzouar');
  expect(row.address).toContain('عمارة 12');
  const acked = await shop().ackOrders([row.id], 'BC-2026-0042');
  expect(acked).toBe(1);
});

test('4. the same order sent twice does not reach the shop twice', async ({ page }) => {
  await page.goto('/p/qamis-sultan-lin-1');
  await page.locator('[data-size="54"]').click();
  await page.locator('[data-qty="1"]').click();
  await fillCustomer(page, { wilaya: 16, carrier: 'yalidine', option: 'stopdesk', commune: 'Bab Ezzouar' });
  await page.locator('[data-submit]').click();
  await page.waitForURL(/\/merci\//u);
  await expect(page.locator('[data-order-ref]')).toHaveText(reference);
  await expect(page.locator('.pill').first()).toContainText('استلمنا هذا الطلب من قبل');
  expect((await allOrders()).filter((r) => r.phone === CUSTOMER.normalized)).toHaveLength(1);
});

test('5. H47 Pay confirms and moves the stock: the site follows', async ({ page }) => {
  const client = shop();
  expect(await client.setOrderStatus(reference, 'confirmed', 'BL-2026-0107')).toBeGreaterThan(0);
  // the shop's confirmation took 2 × Blanc 54 out (6 → 4) and a till sale emptied Blanc 58
  const grid = {
    'Blanc||52': 3, 'Blanc||54': 4, 'Blanc||56': 0, 'Blanc||58': 0, 'Blanc||60': 2,
    'Beige||52': 2, 'Beige||54': 3, 'Beige||56': 5, 'Beige||58': 0, 'Beige||60': 1,
    'Noir||52': 0, 'Noir||54': 2, 'Noir||56': 3, 'Noir||58': 1, 'Noir||60': 0,
    'Bleu nuit||52': 0, 'Bleu nuit||54': 0, 'Bleu nuit||56': 0, 'Bleu nuit||58': 0, 'Bleu nuit||60': 0,
  };
  const total = Object.values(grid).reduce((a, b) => a + b, 0);
  const [result] = await client.upsertProducts([{ external_id: IDS.sultan, variant_stock: grid, colors: ['Blanc', 'Beige', 'Noir', 'Bleu nuit'], sizes: ['52', '54', '56', '58', '60'] }]);
  expect(result.error).toBeUndefined();
  expect((await client.setStock([{ external_id: IDS.sultan, qty: `${total}.000000` }])).updated).toBe(1);
  await page.goto('/p/qamis-sultan-lin-1');
  await expect(page.locator('[data-size="58"]')).toBeDisabled();
  await page.locator('[data-size="54"]').click();
  await expect(page.locator('[data-stock]')).toContainText('متبقي 4 قطع فقط');
});

test('6. the parcel is handed to Yalidine; the customer tracks it with the reference AND the phone', async ({ page }) => {
  const client = shop();
  await client.setOrderTracking({ order_group: reference, carrier: 'Yalidine', tracking: 'yal-1042', status: 'in_transit', amount_due: '14050.0000' });
  await client.setOrderStatus(reference, 'shipped');
  await page.goto(`/suivi?ref=${reference}&phone=0770000000`);
  await expect(page.locator('.form-error')).toContainText('لم نجد طلباً');
  await expect(page.locator('[data-track-result]')).toHaveCount(0);
  await page.goto('/suivi');
  await page.locator('input[name=ref]').fill(reference.toLowerCase());
  await page.locator('input[name=phone]').fill('+213 661 23 45 67');
  await page.getByRole('button', { name: 'تتبع' }).click();
  const result = page.locator('[data-track-result]');
  await expect(result).toContainText('Yalidine');
  await expect(result.locator('[data-tracking-number]')).toHaveText('yal-1042');
  await expect(result).toContainText('في الطريق');
  await expect(result).toContainText('تم الشحن');
  await expect(result).toContainText('14 050');
});

test('7. a cart of two articles from different pages becomes one order of two rows', async ({ page }) => {
  await page.goto('/p/cheche-touareg-4-m-4');
  // a colour-only modèle: no size to choose
  await expect(page.locator('[data-size]')).toHaveCount(0);
  await page.locator('[data-color="Indigo"]').click();
  await page.locator('[data-add-to-cart]').click();
  await expect(page.locator('[data-toast]')).toContainText('تمت الإضافة');
  await page.goto('/p/parfum-oud-royal-50-ml-6');
  await page.locator('[data-qty="1"]').click();
  await page.locator('[data-add-to-cart]').click();
  await expect(page.locator('[data-cart-count]').first()).toHaveText('3');
  await page.goto('/panier');
  await expect(page.locator('[data-cart-view] .line')).toHaveCount(2);
  await expect(page.locator('[data-cart-subtotal]')).toContainText('10 200'); // 1 800 + 2 × 4 200
  await page.locator('[data-cart-checkout]').click();
  await page.waitForURL('**/commande');
  await expect(page.locator('[data-cart-view] .line')).toHaveCount(2);
  // Oran: Noest and Yalidine both deliver there
  await fillCustomer(page, { name: 'Yacine Haddad', phone: '0550123456', wilaya: 31, carrier: 'noest', option: 'home', commune: 'Bir El Djir' });
  await expect(page.locator('[data-sum-total]')).toContainText('10 800'); // + 600 Noest home Oran
  await page.locator('[data-submit]').click();
  await page.waitForURL(/\/merci\//u);
  const ref = (await page.locator('[data-order-ref]').textContent()).trim();
  const rows = (await allOrders()).filter((r) => r.order_group === ref);
  expect(rows.map((r) => [r.external_id, r.selected_color, r.quantity]).sort()).toEqual([[IDS.touareg, 'Indigo', '1'], [IDS.oud, null, '2']].sort());
  expect(rows.every((r) => r.delivery_carrier === 'noest' && r.delivery_fee === '600.0000' && r.city === '31')).toBe(true);
  // the cart is emptied once the order is placed
  await page.goto('/panier');
  await expect(page.locator('[data-cart-view]')).toContainText('سلتك فارغة');
});

test('8. stock sold at the till while the customer fills the form: the order is refused, clearly', async ({ page }) => {
  await page.goto('/p/musc-blanc-12-ml-7');
  await page.locator('[data-qty="1"]').click();
  await page.locator('[data-qty="1"]').click();
  await expect(page.locator('[data-qty-value]')).toHaveText('3');
  await fillCustomer(page, { name: 'Sofiane M', phone: '0770123456', wilaya: 9, carrier: 'noest', option: 'home', commune: 'Boufarik' });
  // meanwhile, two are sold at the till and H47 Pay pushes the new figure
  await shop().setStock([{ external_id: IDS.musc, qty: '1.000000' }]);
  await page.locator('[data-submit]').click();
  await expect(page.locator('[data-form-error]')).toContainText('«مسك أبيض 12 مل»: بقي 1 فقط في المخزون');
  expect((await allOrders()).filter((r) => r.phone === '0770123456')).toHaveLength(0);
});

test('9. a wilaya H47 Pay does not deliver cannot be ordered to', async ({ request }) => {
  const res = await request.post('/api/order', {
    data: { fullName: 'Test Sud', phone: '0661000000', wilaya: 11, commune: 'Tamanrasset', deliveryOption: 'stopdesk', carrier: 'noest', lines: [{ externalId: IDS.misbaha, quantity: 1 }] },
  });
  expect(res.status()).toBe(422);
  expect((await res.json()).message).toContain('اختر طريقة التوصيل');
});

test('10. the shop archives a modèle and removes a photo: the site follows', async ({ page }) => {
  const client = shop();
  await client.upsertProducts([{ external_id: IDS.brode, is_public: 0 }]);
  const res = await page.goto('/p/qamis-brode-main-3');
  expect(res.status()).toBe(404);
  await page.goto('/c/qamis');
  await expect(page.locator('.grid')).not.toContainText('قميص مطرز');
  const photos = await client.images(IDS.oud);
  expect(photos).toHaveLength(2);
  await client.deleteImage({ id: photos[1].id });
  await page.goto('/p/parfum-oud-royal-50-ml-6');
  await expect(page.locator('[data-thumbs] button')).toHaveCount(0);
});

test('11. the sync endpoint refuses a wrong key, in the contract\'s envelope', async ({ request }) => {
  const res = await request.get('/api/sync.php?action=ping', { headers: { 'X-NewStore-Key': 'wrong' } });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.error).toBeTruthy();
  expect(typeof body.message).toBe('string');
});
