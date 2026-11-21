/** H47 Pay, as the tests drive it: NewStore's own website client. */
import { SiteClient } from '../newstore/site.ts';

export const shop = () => new SiteClient({ siteUrl: 'http://127.0.0.1:8099', apiKey: process.env.E2E_SYNC_KEY, requestTimeoutMs: 30_000 });

/** Every order row the shop's module would fetch now. */
export async function allOrders(client = shop()) {
  const rows = [];
  let after = 0;
  for (;;) {
    const page = await client.orders(after);
    rows.push(...page.orders);
    if (page.next_after_id === null || page.orders.length === 0) return rows;
    after = page.next_after_id;
  }
}
