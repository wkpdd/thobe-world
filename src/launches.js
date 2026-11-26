/**
 * The rules of an exclusive launch, enforced on the server whatever the page
 * showed: nothing in a launch can be ordered before its hour, and a limited
 * launch can cap what one customer (one phone number) takes across all orders.
 */
const NOT_COUNTED = new Set(['cancelled']);

export function whenText(iso, lang) {
  const date = new Date(iso);
  try {
    return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'ar-DZ', {
      timeZone: 'Africa/Algiers', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}

/**
 * Why this order may not be placed because of a launch, or null.
 * `{code: 'launchLocked', product, launch}` or `{code: 'launchMax', launch, max}`.
 */
export function launchRefusal(order, { content, storage, catalogue, now = new Date() }) {
  const { byExternalId } = catalogue.snapshot();
  const capped = new Map();
  for (const line of order.lines) {
    const found = content.launchFor(line.externalId, now);
    if (!found) continue;
    if (found.state === 'upcoming') return { code: 'launchLocked', product: byExternalId.get(line.externalId) ?? null, launch: found.launch };
    if (found.launch.maxPerCustomer) {
      const entry = capped.get(found.launch.id) ?? { launch: found.launch, quantity: 0 };
      entry.quantity += line.quantity;
      capped.set(found.launch.id, entry);
    }
  }
  if (!capped.size) return null;
  const data = storage.shopData();
  const externalOf = new Map(data.products.map((p) => [p.id, p.external_id]));
  for (const { launch, quantity } of capped.values()) {
    const already = data.orders
      .filter((row) => row.phone === order.phone && !NOT_COUNTED.has(row.status) && launch.products.includes(externalOf.get(row.product_id)))
      .reduce((sum, row) => sum + Number(row.quantity), 0);
    if (already + quantity > launch.maxPerCustomer) return { code: 'launchMax', launch, max: launch.maxPerCustomer, already };
  }
  return null;
}
