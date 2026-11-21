/**
 * The shop front's view of what H47 Pay (NewStore) pushed.
 *
 * The rows in `storage.shopData()` are NewStore's projection and are READ ONLY
 * here: prices, names, photos, colours, sizes and stock are written only by the
 * sync endpoint. This module turns them into what the pages draw.
 *
 * A modèle (contract 1.2) is ONE product row carrying `colors`, `sizes`,
 * `variant_stock` ({"<colour>||<size>": integer}), `swatches` and
 * `color_images` ({"<colour>": [sha256…]}) as JSON text.
 */

const parseJson = (text, fallback) => {
  if (text === null || text === undefined || text === '') return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

/** "4500.0000" → 4500 (display and sorting only; money is never computed from this). */
export const moneyNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** "4500.0000" → "4 500" — integer dinars, grouped by thousands, from the string (no float rounding). */
export function formatMoney(value) {
  if (value === null || value === undefined || value === '') return '';
  const text = String(value);
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const grouped = whole.replace(/^0+(?=\d)/u, '').replace(/\B(?=(\d{3})+(?!\d))/gu, ' ');
  const cents = fraction.replace(/0+$/u, '');
  return `${negative ? '-' : ''}${grouped}${cents ? `,${cents.padEnd(2, '0').slice(0, 2)}` : ''}`;
}

/** "4.000000" → 4: whole units a customer can order. */
export const wholeUnits = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

export function slugify(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60);
}

export const productPath = (product) => `/p/${product.slugBase ? `${product.slugBase}-` : ''}${product.id}`;

const pick = (lang, ar, fr) => (lang === 'fr' ? fr || ar : ar || fr) || '';

/** Build every page's model once per catalogue version (cheap: in memory). */
export class Catalogue {
  constructor(storage) {
    this.storage = storage;
    this.cache = null;
  }

  /** Called by the app after every sync request so the next page view rebuilds. */
  invalidate() {
    this.cache = null;
  }

  snapshot() {
    if (this.cache) return this.cache;
    const data = this.storage.shopData();
    const imagesByProduct = new Map();
    for (const image of [...data.images].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)) {
      if (!imagesByProduct.has(image.product_id)) imagesByProduct.set(image.product_id, []);
      imagesByProduct.get(image.product_id).push(image);
    }
    const categories = new Map(data.categories.map((c) => [c.slug, c]));
    const products = data.products
      .filter((p) => p.is_public === 1 && p.is_service !== 1)
      .map((row) => buildProduct(row, imagesByProduct.get(row.id) ?? [], categories.get(row.category)));
    const byId = new Map(products.map((p) => [p.id, p]));
    const byExternalId = new Map(products.filter((p) => p.externalId).map((p) => [p.externalId, p]));
    const usedCategories = data.categories
      .filter((c) => products.some((p) => p.category === c.slug))
      .map((c) => ({ slug: c.slug, nameAr: c.name_ar, nameFr: c.name_fr, count: products.filter((p) => p.category === c.slug).length }));
    this.cache = { products, byId, byExternalId, categories: usedCategories, data };
    return this.cache;
  }
}

function buildProduct(row, images, category) {
  const colors = parseJson(row.colors, null);
  const sizes = parseJson(row.sizes, null);
  const grid = parseJson(row.variant_stock, null);
  const swatchList = parseJson(row.swatches, []);
  const colorImages = parseJson(row.color_images, {});
  const isModel = Array.isArray(colors) || Array.isArray(sizes) || (grid !== null && typeof grid === 'object');

  // Photos: the model's own gallery first; each colour's photos resolved by hash.
  const pathByHash = new Map(images.filter((i) => i.content_hash).map((i) => [i.content_hash, i.image_path]));
  const colourHashes = new Set(Object.values(colorImages ?? {}).flat());
  const gallery = images.filter((i) => !i.content_hash || !colourHashes.has(i.content_hash)).map((i) => i.image_path);
  const allPhotos = images.map((i) => i.image_path);

  const colorList = (Array.isArray(colors) ? colors : []).map((value) => {
    const swatch = (Array.isArray(swatchList) ? swatchList : []).find((s) => s && s.value === value) ?? {};
    const photos = (colorImages?.[value] ?? []).map((h) => pathByHash.get(h)).filter(Boolean);
    const stock = Object.entries(grid ?? {})
      .filter(([key]) => key.split('||')[0] === value)
      .reduce((sum, [, n]) => sum + (Number.isInteger(n) && n > 0 ? n : 0), 0);
    return {
      value,
      labelFr: swatch.label_fr || value,
      labelAr: swatch.label_ar || swatch.label_fr || value,
      hex: /^#[0-9a-f]{6}$/iu.test(swatch.hex ?? '') ? swatch.hex : null,
      photos,
      stock,
    };
  });
  const sizeList = Array.isArray(sizes) ? sizes : [];

  let stock;
  if (isModel && grid) stock = Object.values(grid).reduce((s, n) => s + (Number.isInteger(n) && n > 0 ? n : 0), 0);
  else stock = wholeUnits(row.stock);

  const firstPhotos = gallery.length ? gallery : allPhotos;
  const specsObject = parseJson(row.specs, null);
  return {
    id: row.id,
    externalId: row.external_id,
    sku: row.sku,
    nameAr: row.name_ar || row.name_fr,
    nameFr: row.name_fr || row.name_ar,
    descriptionAr: row.description_ar || '',
    descriptionFr: row.description_fr || '',
    slugBase: slugify(row.name_fr || row.name_en || row.sku),
    price: row.price,
    priceNumber: moneyNumber(row.price) ?? 0,
    compareAt: row.compare_at_price && moneyNumber(row.compare_at_price) > moneyNumber(row.price) ? row.compare_at_price : null,
    category: row.category,
    categoryNameAr: category?.name_ar || category?.name_fr || '',
    categoryNameFr: category?.name_fr || category?.name_ar || '',
    isModel,
    colors: colorList,
    sizes: sizeList,
    grid: grid ?? {},
    stock,
    gallery: firstPhotos,
    allPhotos,
    cover: firstPhotos[0] ?? colorList.find((c) => c.photos.length)?.photos[0] ?? null,
    badges: parseJson(row.badges, []),
    highlightsAr: parseJson(row.highlights_ar, []),
    highlightsFr: parseJson(row.highlights_fr, []),
    specs: specsObject && typeof specsObject === 'object' ? Object.entries(specsObject) : [],
    landingHtml: row.landing_html,
  };
}

export const name = (product, lang) => pick(lang, product.nameAr, product.nameFr);
export const description = (product, lang) => pick(lang, product.descriptionAr, product.descriptionFr);
export const highlights = (product, lang) => {
  const list = lang === 'fr' ? product.highlightsFr : product.highlightsAr;
  const other = lang === 'fr' ? product.highlightsAr : product.highlightsFr;
  return (list?.length ? list : other) ?? [];
};
/** A category's name; given a product, the name of ITS category (never the product's own name). */
export const categoryName = (cat, lang) =>
  'categoryNameAr' in cat ? pick(lang, cat.categoryNameAr, cat.categoryNameFr) : pick(lang, cat.nameAr, cat.nameFr);
export const colorLabel = (color, lang) => pick(lang, color.labelAr, color.labelFr);

/** Units available for one choice: a grid cell for a modèle, the scalar stock otherwise. */
export function availableFor(product, color, size) {
  if (!product.isModel) return product.stock;
  const cell = product.grid[`${color ?? ''}||${size ?? ''}`];
  return Number.isInteger(cell) && cell > 0 ? cell : 0;
}

/** Search in both languages, the sku and the category. */
export function search(products, query) {
  const words = String(query ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .split(/\s+/u)
    .filter(Boolean);
  if (!words.length) return [];
  return products.filter((p) => {
    const hay = `${p.nameAr} ${p.nameFr} ${p.sku} ${p.categoryNameAr} ${p.categoryNameFr} ${p.colors.map((c) => `${c.labelAr} ${c.labelFr}`).join(' ')}`
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/gu, '');
    return words.every((w) => hay.includes(w));
  });
}

/** Category listing with the filters the page offers. */
export function filterProducts(products, { color, size, stock, sort } = {}) {
  let list = products;
  if (color) list = list.filter((p) => p.colors.some((c) => (c.labelFr === color || c.value === color) && (stock !== '1' || c.stock > 0)));
  if (size) list = list.filter((p) => p.sizes.includes(size) && (stock !== '1' || Object.entries(p.grid).some(([k, n]) => k.split('||')[1] === size && n > 0)));
  if (stock === '1') list = list.filter((p) => p.stock > 0);
  const sorted = [...list];
  if (sort === 'price_asc') sorted.sort((a, b) => a.priceNumber - b.priceNumber);
  else if (sort === 'price_desc') sorted.sort((a, b) => b.priceNumber - a.priceNumber);
  else sorted.sort((a, b) => (b.stock > 0) - (a.stock > 0) || b.id - a.id);
  return sorted;
}
