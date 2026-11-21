/**
 * A demo catalogue shaped EXACTLY as H47 Pay sends it (contract 1.2/1.3):
 * modèles with colours × sizes and a per-variant stock grid, plain articles,
 * photographs per colour, and the delivery list (Noest + Yalidine).
 *
 * Used by `npm run demo` (local preview) and by the end-to-end tests. The
 * photos are drawn here (no real photos yet) as large JPEGs — like a phone's —
 * so the image compression is exercised for real.
 */
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const cat = {
  qamis: { code: 'QAMIS', slug: 'qamis', name_fr: 'Qamis', name_ar: 'قمصان' },
  cheche: { code: 'CHECHE', slug: 'cheche', name_fr: 'Chèche', name_ar: 'شاش' },
  parfum: { code: 'PARFUM', slug: 'parfums', name_fr: 'Parfums', name_ar: 'عطور' },
  access: { code: 'ACCESS', slug: 'accessoires', name_fr: 'Accessoires', name_ar: 'إكسسوارات' },
};

export const IDS = {
  sultan: '0b5e7c1a-1111-4a6b-9a1e-5f0c1d2e3a01',
  emirati: '0b5e7c1a-2222-4a6b-9a1e-5f0c1d2e3a02',
  brode: '0b5e7c1a-3333-4a6b-9a1e-5f0c1d2e3a03',
  touareg: '0b5e7c1a-4444-4a6b-9a1e-5f0c1d2e3a04',
  shemagh: '0b5e7c1a-5555-4a6b-9a1e-5f0c1d2e3a05',
  oud: '0b5e7c1a-6666-4a6b-9a1e-5f0c1d2e3a06',
  musc: '0b5e7c1a-7777-4a6b-9a1e-5f0c1d2e3a07',
  misbaha: '0b5e7c1a-8888-4a6b-9a1e-5f0c1d2e3a08',
  kofia: '0b5e7c1a-9999-4a6b-9a1e-5f0c1d2e3a09',
};

const SIZES = ['52', '54', '56', '58', '60'];
const grid = (colors, sizes, fn) => {
  const out = {};
  for (const c of colors) for (const s of sizes) out[`${c}||${s}`] = fn(c, s);
  return out;
};
const sum = (g) => Object.values(g).reduce((a, b) => a + b, 0);
const qty = (n) => `${n}.000000`;

const sultanGrid = grid(['Blanc', 'Beige', 'Noir', 'Bleu nuit'], SIZES, (c, s) => ({
  Blanc: { 52: 3, 54: 6, 56: 0, 58: 4, 60: 2 },
  Beige: { 52: 2, 54: 3, 56: 5, 58: 0, 60: 1 },
  Noir: { 52: 0, 54: 2, 56: 3, 58: 1, 60: 0 },
  'Bleu nuit': { 52: 0, 54: 0, 56: 0, 58: 0, 60: 0 },
})[c][s]);
const emiratiGrid = grid(['Blanc', 'Gris perle'], ['54', '56', '58', '60'], (c, s) => (c === 'Blanc' ? 8 : s === '60' ? 0 : 3));
const brodeGrid = grid(['Ivoire'], ['54', '56', '58'], () => 0);
const touaregGrid = grid(['Indigo', 'Blanc', 'Sable'], [''], (c) => ({ Indigo: 12, Blanc: 4, Sable: 1 })[c]);

export const PRODUCTS = [
  {
    external_id: IDS.sultan, sku: 'QSL', name_fr: 'Qamis Sultan — lin', name_ar: 'قميص السلطان — كتان',
    description_fr: 'Qamis en lin respirant, coupe droite et col officier. Idéal pour le vendredi, les fêtes et les grandes occasions.',
    description_ar: 'قميص من الكتان الذي يسمح بمرور الهواء، بقصة مستقيمة وياقة رسمية. مثالي ليوم الجمعة والأعياد والمناسبات الكبرى.',
    price: '6900.0000', compare_at_price: '8500.0000', category: cat.qamis, is_public: 1,
    colors: ['Blanc', 'Beige', 'Noir', 'Bleu nuit'], sizes: SIZES, variant_stock: sultanGrid, stock: qty(sum(sultanGrid)),
    badges: ['Nouveau'], highlights_fr: ['100 % lin', 'Coupe droite', 'Boutons nacrés'], highlights_ar: ['كتان 100٪', 'قصة مستقيمة', 'أزرار صدفية'],
    swatches: [
      { value: 'Blanc', label_fr: 'Blanc', label_ar: 'أبيض', hex: '#FFFFFF' },
      { value: 'Beige', label_fr: 'Beige', label_ar: 'بيج', hex: '#E8DCC4' },
      { value: 'Noir', label_fr: 'Noir', label_ar: 'أسود', hex: '#1F1B16' },
      { value: 'Bleu nuit', label_fr: 'Bleu nuit', label_ar: 'أزرق ليلي', hex: '#1E2A44' },
    ],
  },
  {
    external_id: IDS.emirati, sku: 'QEM', name_fr: 'Qamis Émirati', name_ar: 'قميص إماراتي',
    description_fr: 'Coupe émiratie longue, tissu fluide qui ne se froisse pas.', description_ar: 'قصة إماراتية طويلة، قماش ناعم لا يتجعد.',
    price: '5500.0000', compare_at_price: null, category: cat.qamis, is_public: 1,
    colors: ['Blanc', 'Gris perle'], sizes: ['54', '56', '58', '60'], variant_stock: emiratiGrid, stock: qty(sum(emiratiGrid)),
    badges: [], highlights_fr: ['Infroissable'], highlights_ar: ['لا يتجعد'],
    swatches: [
      { value: 'Blanc', label_fr: 'Blanc', label_ar: 'أبيض', hex: '#FFFFFF' },
      { value: 'Gris perle', label_fr: 'Gris perle', label_ar: 'رمادي لؤلؤي', hex: '#C9C6BF' },
    ],
  },
  {
    external_id: IDS.brode, sku: 'QBR', name_fr: 'Qamis brodé main', name_ar: 'قميص مطرز يدوياً',
    description_fr: 'Broderie faite main au col et aux manches.', description_ar: 'تطريز يدوي على الياقة والأكمام.',
    price: '9800.0000', compare_at_price: null, category: cat.qamis, is_public: 1,
    colors: ['Ivoire'], sizes: ['54', '56', '58'], variant_stock: brodeGrid, stock: qty(0),
    swatches: [{ value: 'Ivoire', label_fr: 'Ivoire', label_ar: 'عاجي', hex: '#F4EEDC' }],
  },
  {
    external_id: IDS.touareg, sku: 'CTG', name_fr: 'Chèche touareg 4 m', name_ar: 'شاش ترقي 4 أمتار',
    description_fr: 'Chèche en coton léger, teint à l’indigo, 4 mètres.', description_ar: 'شاش قطني خفيف مصبوغ بالنيلة، 4 أمتار.',
    price: '1800.0000', compare_at_price: '2200.0000', category: cat.cheche, is_public: 1,
    colors: ['Indigo', 'Blanc', 'Sable'], sizes: [], variant_stock: touaregGrid, stock: qty(sum(touaregGrid)),
    swatches: [
      { value: 'Indigo', label_fr: 'Indigo', label_ar: 'نيلي', hex: '#2B3A67' },
      { value: 'Blanc', label_fr: 'Blanc', label_ar: 'أبيض', hex: '#FFFFFF' },
      { value: 'Sable', label_fr: 'Sable', label_ar: 'رملي', hex: '#D8C3A0' },
    ],
  },
  {
    external_id: IDS.shemagh, sku: 'CSH', name_fr: 'Shemagh rouge et blanc', name_ar: 'شماغ أحمر وأبيض',
    description_fr: 'Shemagh traditionnel en coton.', description_ar: 'شماغ تقليدي من القطن.',
    price: '2500.0000', compare_at_price: null, category: cat.cheche, is_public: 1, stock: qty(7),
  },
  {
    external_id: IDS.oud, sku: 'POUD50', name_fr: 'Parfum Oud Royal 50 ml', name_ar: 'عطر العود الملكي 50 مل',
    description_fr: 'Oud fumé, ambre et rose de Taïf. Tenue 12 h.', description_ar: 'عود مدخن، عنبر وورد طائفي. ثبات 12 ساعة.',
    price: '4200.0000', compare_at_price: '4900.0000', category: cat.parfum, is_public: 1, stock: qty(15),
    specs: { Contenance: '50 ml', Famille: 'Boisé oriental', 'الثبات': '12 ساعة' },
  },
  {
    external_id: IDS.musc, sku: 'PMUS', name_fr: 'Musc blanc 12 ml', name_ar: 'مسك أبيض 12 مل',
    description_fr: 'Musc blanc doux, en huile, sans alcool.', description_ar: 'مسك أبيض ناعم، زيتي وبدون كحول.',
    price: '1200.0000', compare_at_price: null, category: cat.parfum, is_public: 1, stock: qty(3),
  },
  {
    external_id: IDS.misbaha, sku: 'AMIS', name_fr: 'Misbaha ambre 33 grains', name_ar: 'مسبحة كهرمان 33 حبة',
    description_fr: 'Misbaha en ambre pressé, pompon doré.', description_ar: 'مسبحة من الكهرمان المضغوط مع شرابة ذهبية.',
    price: '1500.0000', compare_at_price: null, category: cat.access, is_public: 1, stock: qty(9),
  },
  {
    external_id: IDS.kofia, sku: 'AKOF', name_fr: 'Kofia blanche', name_ar: 'كوفية بيضاء',
    description_fr: 'Calotte brodée en coton.', description_ar: 'طاقية قطنية مطرزة.',
    price: '600.0000', compare_at_price: null, category: cat.access, is_public: 1, stock: qty(0),
  },
];

/* ---------- photographs ---------- */

const ART = {
  qamis: (fill, stroke) => `<path d="M420 300 L520 260 Q600 330 680 260 L780 300 L900 460 L820 520 L760 450 L760 1250 L440 1250 L440 450 L380 520 L300 460 Z" fill="${fill}" stroke="${stroke}" stroke-width="6"/><path d="M600 300 L600 700" stroke="${stroke}" stroke-width="4"/><circle cx="600" cy="400" r="9" fill="${stroke}"/><circle cx="600" cy="480" r="9" fill="${stroke}"/><circle cx="600" cy="560" r="9" fill="${stroke}"/>`,
  cheche: (fill, stroke) => `<path d="M330 520 Q600 300 870 520 Q900 820 600 960 Q300 820 330 520 Z" fill="${fill}" stroke="${stroke}" stroke-width="6"/><path d="M380 600 Q600 470 820 600 M360 700 Q600 560 840 700 M400 800 Q600 680 800 800" stroke="${stroke}" stroke-width="5" fill="none"/>`,
  perfume: (fill, stroke) => `<rect x="520" y="330" width="160" height="120" rx="14" fill="#C9A45C" stroke="${stroke}" stroke-width="6"/><rect x="400" y="450" width="400" height="620" rx="70" fill="${fill}" stroke="${stroke}" stroke-width="6"/><rect x="470" y="680" width="260" height="150" rx="10" fill="#FBF8F2" stroke="#C9A45C" stroke-width="4"/>`,
  beads: (fill, stroke) => Array.from({ length: 22 }, (_, i) => {
    const a = (i / 22) * Math.PI * 2;
    return `<circle cx="${600 + Math.cos(a) * 260}" cy="${640 + Math.sin(a) * 300}" r="34" fill="${fill}" stroke="${stroke}" stroke-width="4"/>`;
  }).join('') + '<path d="M600 940 L600 1120" stroke="#C9A45C" stroke-width="14"/>',
};

let grain;
/** A fine film grain, made once and tiled: real photos are never flat, and neither is their weight. */
async function grainTile() {
  grain ??= await sharp({ create: { width: 400, height: 400, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 40 } } })
    .ensureAlpha(0.08)
    .png()
    .toBuffer();
  return grain;
}

async function photo(kind, fill, { stroke = '#8A6A2E', bg = ['#F7F1E6', '#E7DAC2'], angle = 0 } = {}) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500" viewBox="0 0 1200 1500">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></linearGradient></defs>
<rect width="1200" height="1500" fill="url(#g)"/>
<ellipse cx="600" cy="1300" rx="360" ry="40" fill="rgba(31,27,22,.10)"/>
<g transform="rotate(${angle} 600 750)">${ART[kind](fill, stroke)}</g></svg>`;
  // 2400×3000 at quality 92 with grain: the weight of a phone photo, what a shop really uploads.
  return sharp(Buffer.from(svg), { density: 144 })
    .composite([{ input: await grainTile(), tile: true, blend: 'over' }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Every photo: {external_id, color?, bytes, content_hash, sort_order}. */
export async function photos() {
  const list = [];
  const add = async (externalId, color, kind, fill, opts = {}) => {
    const bytes = await photo(kind, fill, opts);
    list.push({ external_id: externalId, color, bytes, content_hash: hash(bytes) });
  };
  for (const [c, fill] of [['Blanc', '#FFFFFF'], ['Beige', '#E8DCC4'], ['Noir', '#2A2621'], ['Bleu nuit', '#1E2A44']]) {
    await add(IDS.sultan, c, 'qamis', fill, { stroke: c === 'Noir' || c === 'Bleu nuit' ? '#C9A45C' : '#8A6A2E' });
    await add(IDS.sultan, c, 'qamis', fill, { stroke: c === 'Noir' || c === 'Bleu nuit' ? '#C9A45C' : '#8A6A2E', angle: -4, bg: ['#EFE6D6', '#E2D4BC'] });
  }
  await add(IDS.emirati, 'Blanc', 'qamis', '#FFFFFF');
  await add(IDS.emirati, 'Gris perle', 'qamis', '#C9C6BF');
  await add(IDS.brode, null, 'qamis', '#F4EEDC', { stroke: '#C9A45C' });
  await add(IDS.touareg, 'Indigo', 'cheche', '#2B3A67', { stroke: '#C9A45C' });
  await add(IDS.touareg, 'Blanc', 'cheche', '#FFFFFF');
  await add(IDS.touareg, 'Sable', 'cheche', '#D8C3A0');
  await add(IDS.shemagh, null, 'cheche', '#B23A2E', { stroke: '#FFFFFF' });
  await add(IDS.oud, null, 'perfume', '#3B2A1E', { stroke: '#C9A45C' });
  await add(IDS.oud, null, 'perfume', '#3B2A1E', { stroke: '#C9A45C', angle: 6, bg: ['#2E2922', '#1F1B16'] });
  await add(IDS.musc, null, 'perfume', '#F4EEDC');
  await add(IDS.misbaha, null, 'beads', '#D98E2B');
  await add(IDS.kofia, null, 'cheche', '#FFFFFF');
  // sort_order per product, in push order
  const seen = new Map();
  for (const p of list) {
    const n = seen.get(p.external_id) ?? 0;
    p.sort_order = n;
    seen.set(p.external_id, n + 1);
  }
  return list;
}

/** `color_images` for each modèle, from the photos (faces first). */
export function colorImages(list) {
  const map = {};
  for (const p of list) {
    if (!p.color) continue;
    map[p.external_id] ??= {};
    (map[p.external_id][p.color] ??= []).push(p.content_hash);
  }
  return map;
}

/** H47 Pay's delivery list: Noest everywhere, Yalidine in the big wilayas. */
export function deliveryOptions() {
  const north = new Set([2, 5, 6, 9, 10, 15, 16, 18, 19, 21, 23, 25, 26, 27, 31, 34, 35, 42, 43, 44]);
  const south = new Set([1, 8, 11, 33, 37, 49, 50, 52, 53, 54, 56, 58]);
  const options = [];
  for (let w = 1; w <= 58; w += 1) {
    const base = w === 16 ? 400 : north.has(w) ? 600 : south.has(w) ? 1100 : 800;
    options.push({ carrier: 'noest', label: 'Noest', wilaya: w, home: `${base}.0000`, stopdesk: south.has(w) ? null : `${base - 200}.0000` });
    if ([16, 9, 31, 25, 19, 35].includes(w)) options.push({ carrier: 'yalidine', label: 'Yalidine', wilaya: w, home: `${base + 100}.0000`, stopdesk: `${base - 150}.0000` });
  }
  return options;
}

/** Push the whole demo through a NewStore SiteClient, exactly as H47 Pay would. */
export async function pushDemo(client, { log = () => {} } = {}) {
  await client.ping();
  const list = await photos();
  const ci = colorImages(list);
  const items = PRODUCTS.map((p) => (ci[p.external_id] ? { ...p, color_images: ci[p.external_id] } : p));
  const results = await client.upsertProducts(items);
  const failed = results.filter((r) => r.error);
  if (failed.length) throw new Error(`upsert_products: ${JSON.stringify(failed)}`);
  log(`${results.length} articles`);
  for (const p of list) {
    await client.attachImage({ external_id: p.external_id, content_hash: p.content_hash, sort_order: p.sort_order, bytes: p.bytes, contentType: 'image/jpeg', filename: `${p.content_hash.slice(0, 8)}.jpg` });
  }
  log(`${list.length} photos`);
  const n = await client.setDeliveryOptions(deliveryOptions());
  log(`${n} delivery rows`);
  return { photos: list };
}
