// VENDORED from wkpdd/newstore modules/website-sync/src/site.ts (commit 8f401ee): H47 Pay's own website client, used by the end-to-end tests to play the shop.
/**
 * The whole of this module's contact with the SHOP'S WEBSITE: one PHP file on a
 * cPanel host, dispatched on `?action=`, behind one machine key. Every action in
 * docs/website-sync.md's table is one method here, with the body and the answer
 * exactly as that table spells them — the table is the contract, and anything
 * this file sends that the table does not list is a bug on this side.
 *
 * THE SHOP INITIATES EVERY CALL. The site cannot reach the shop (it is behind
 * NAT) and never tries; there is no webhook, no callback, no listener in this
 * process. What looks like "the site telling the shop about an order" is this
 * module ASKING, on its own clock — see runner.ts.
 *
 * EVERY CALL IS SAFE TO REPEAT, and that is what makes the runner simple: it can
 * be killed at any point and redo its last step. `upsert_products` upserts by
 * `external_id`; `set_stock` sets, it does not add; `attach_image` dedupes on
 * `content_hash` (a 200 instead of a 201, nothing stored twice); `ack_orders`
 * stamps rows already stamped; `set_order_status` sets; `upsert_repairs`
 * upserts by `external_id`. None of it needs an idempotency key because none of
 * it is a delta — WITH ONE EXCEPTION: `enqueue_message` appends to a queue a
 * phone will drain, so the runner keeps its own record of what it has queued
 * (extension_data `repair_sms`) and asks once per (repair, status).
 *
 * THE ERROR TAXONOMY IS THE PRINTER'S, applied to a different server. `SiteError`
 * is the same two-bucket verdict — RETRYABLE (the line is down, cPanel is having
 * a minute, a maintenance page) or FATAL (the key is wrong) — made once, here,
 * at the only place that can see the status code. There is one addition the
 * NewStore side never needs: A NON-JSON BODY IS NEVER A SUCCESS. A shared host
 * answers a wrong path with an HTML 200, a PHP fatal with a blank 200, a suspended
 * account with an HTML page — and a daemon that read any of those as "done" would
 * report a synchronised site over a telephone to a shopkeeper looking at an empty
 * one. Every answer is parsed as JSON first, and anything that is not JSON is an
 * error carrying the first line of what came back, so somebody can read it.
 *
 * MONEY AND QUANTITIES ARE STRINGS, in both directions. `price` and `qty` go out
 * as the decimal strings NewStore gave; `quantity`, `unit_price`, `total_price`
 * come back as strings and are handed on as strings. Nothing here calls Number()
 * on one.
 */

export type SiteFailure =
  /** No answer at all: DNS, connection refused, reset, or a socket that hung. */
  | 'UNREACHABLE'
  /** 5xx, or a body that is not JSON — a maintenance page, a PHP fatal, a wrong path. */
  | 'SERVER'
  /** 429. The host is rate-limiting the shop's address. */
  | 'THROTTLED'
  /** 401 UNAUTHORIZED: the key is missing or wrong. Nothing waiting will fix it. */
  | 'CREDENTIALS'
  /** Any other 4xx with a code, or a 2xx that carries `error`. Retried on the backoff, not fatal. */
  | 'REFUSED';

export class SiteError extends Error {
  override readonly name = 'SiteError';
  readonly failure: SiteFailure;
  /** True when waiting and asking again is the correct response. */
  readonly retryable: boolean;
  readonly status: number | null;
  /** The site's own `error` field, when it sent one. `UNAUTHORIZED`, `BARCODE_TAKEN`… */
  readonly code: string | null;
  /** The transport's own words (« fetch failed »): for the log, not the shopkeeper's screen. */
  readonly transportCause: string | null;

  constructor(
    failure: SiteFailure,
    message: string,
    options: { status?: number | null; code?: string | null; cause?: string | null } = {},
  ) {
    super(message);
    this.transportCause = options.cause ?? null;
    this.failure = failure;
    // ONLY THE KEY IS FATAL. A 4xx from the site that is not a 401 — a body it
    // did not like, an action an older sync.php does not know — is a bug on one
    // side or the other that the site's developer will fix without anybody
    // restarting a Windows service in the shop: the module keeps the batch, backs
    // off, and shows the site's sentence in `lastError` until it goes through.
    this.retryable = failure !== 'CREDENTIALS';
    this.status = options.status ?? null;
    this.code = options.code ?? null;
  }
}

// ---------------------------------------------------------------------------
// The wire shapes, named exactly as the contract's table names them.
// ---------------------------------------------------------------------------

/** `Product`: every key optional except `external_id`; only keys PRESENT are written. */
export interface SiteProduct {
  readonly external_id: string;
  readonly sku?: string;
  readonly barcode?: string;
  readonly name_fr?: string;
  readonly name_ar?: string;
  readonly name_en?: string;
  readonly description_fr?: string;
  readonly description_ar?: string;
  readonly description_en?: string;
  /** Decimal string → DECIMAL(12,2). */
  readonly price?: string;
  readonly wholesale_price?: string | null;
  /**
   * `null` = no famille; the site files the article under « Autres ».
   * Contract 1.1: the famille's CODE identifies the category per shop — the
   * site finds-or-creates it by code and adopts a hand-made category with the
   * same name rather than duplicating it. The slug rides along for a site on
   * contract 1.0 (the live store until the platform is deployed), which
   * requires it; a 1.1 site uses it only to adopt a hand-made category.
   */
  readonly category?: {
    readonly code: string;
    readonly slug: string;
    readonly name_fr: string;
    readonly name_ar: string;
    readonly name_en?: string;
  } | null;
  readonly is_public?: 0 | 1;
  readonly is_service?: 0 | 1;
  /** Decimal string. Accepted on create for convenience; `set_stock` is the steady state. */
  readonly stock?: string;
  /**
   * Contract 1.3, the article's details: `{label: value}`, in the shop's order.
   * Replaced whole; `{}` clears; ABSENT leaves the site's own alone. A receiver
   * that predates it ignores it, as it ignores every key it does not know.
   */
  readonly specs?: Readonly<Record<string, string>>;
  /**
   * « Page de présentation »: the article's landing page as HTML, kept as pasted.
   * '' clears it; ABSENT leaves the site's own alone. A receiver that predates it
   * ignores it, as it ignores every key it does not know.
   */
  readonly landing_html?: string;
  /**
   * Contract 1.2, a modèle's grid. Sent ONLY for a model item, on every upsert
   * (the grid is part of its contentHash): the colour values, the size values,
   * and `{"<colour>||<size>": integer}`. A receiver that predates them ignores
   * them, as it ignores every key it does not know.
   */
  readonly colors?: readonly string[];
  readonly sizes?: readonly string[];
  readonly variant_stock?: Readonly<Record<string, number>>;
  /**
   * Contract 1.2, the model's PAGE (step 6). Sent only for a model item whose
   * feed carried them, on every upsert of it (they are in its contentHash).
   * Unknown keys are ignored by a receiver that predates them.
   *   compare_at_price — the « prix barré », a decimal string, or null to clear it;
   *   badges / highlights_fr / highlights_ar — arrays of strings, replaced whole;
   *   swatches — `[{value, label_fr, label_ar, hex}]`, one per `colors` entry;
   *   color_images — `{"<colour>": [content_hash, …]}`, hashes of photographs
   *   pushed by `attach_image` under this same external_id.
   */
  readonly compare_at_price?: string | null;
  readonly badges?: readonly string[];
  readonly highlights_fr?: readonly string[];
  readonly highlights_ar?: readonly string[];
  readonly swatches?: readonly {
    readonly value: string;
    readonly label_fr: string;
    readonly label_ar: string | null;
    readonly hex: string | null;
  }[];
  readonly color_images?: Readonly<Record<string, readonly string[]>>;
}

export interface UpsertResult {
  readonly external_id: string;
  /** The site's row id — what `website_product_link.remote_id` records. */
  readonly id: number;
  readonly created: boolean;
  readonly error?: { readonly code: string; readonly message: string };
}

export interface StockItem {
  readonly external_id: string;
  /** Decimal string, as NewStore's `qtyAvailable` gave it. */
  readonly qty: string;
}

export interface SetStockResult {
  readonly updated: number;
  /** Products the site does not hold: never upserted, or deleted there. */
  readonly missing: readonly string[];
}

export interface SiteImage {
  readonly id: number;
  /** The sha256 this module gave `attach_image`. Null on a photo the site added itself. */
  readonly content_hash: string | null;
  readonly sort_order: number;
  readonly image_path: string;
}

export interface AttachImageInput {
  readonly external_id: string;
  readonly content_hash: string;
  readonly sort_order: number;
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly filename: string;
}

export interface AttachImageResult {
  readonly id: number;
  readonly image_path: string;
  /** True (and a 200 rather than a 201) when the site already held these bytes. */
  readonly deduped: boolean;
}

/** One wilaya of one company, as `set_delivery_options` takes it. Null: that option is not offered. */
export interface DeliveryOption {
  readonly carrier: string;
  readonly label: string;
  readonly wilaya: number;
  readonly home: string | null;
  readonly stopdesk: string | null;
}

/**
 * One site `orders` row. A cart is N rows sharing `order_group`.
 *
 * SEVEN FIELDS ARE NULLABLE THAT THIS TYPE ONCE PROMISED WERE NOT, and the
 * promise was the defect. Every column the site answers from is nullable in its
 * own schema, and `api/sync.php` selects them straight out — so `order_group`,
 * `status`, `created_at`, `full_name`, `product_id`, `quantity`, `unit_price`
 * and `total_price` can all arrive as null from a row written by an older
 * checkout, an import, or a hand-edit in phpMyAdmin.
 *
 * What the lie cost: `asDecimalString(null)` answers `''`, so a null quantity
 * became an EMPTY quantity in the submission, which `routes/website.ts` refuses
 * (`z.string().regex(decimalQty)`) — the order was recorded as refused and the
 * cursor moved past it, so a real customer's order never reached the inbox and
 * never would again. Worse, `groupOrders` keyed a Map on `order_group`: two
 * different customers whose rows both carried null were FUSED into one cart,
 * and one of them would have been shipped the other's goods.
 *
 * Declaring the truth here is what forces `orderRowProblem` to exist and every
 * consumer to decide. Nothing downstream may assume a value it has not checked.
 */
export interface OrderRow {
  readonly id: number;
  readonly order_group: string | null;
  readonly status: string | null;
  readonly payment_status: string | null;
  readonly delivery_type: string | null;
  readonly created_at: string | null;
  readonly full_name: string | null;
  readonly phone: string | null;
  readonly city: string | null;
  readonly address: string | null;
  readonly notes: string | null;
  readonly product_id: number | null;
  /** NewStore's product id, or null if the article is not a synced one. */
  readonly external_id: string | null;
  readonly sku: string | null;
  /** Decimal strings. Kept as strings; never parsed here. Null on an older row. */
  readonly quantity: string | null;
  readonly unit_price: string | null;
  readonly total_price: string | null;
  readonly selected_color: string | null;
  readonly selected_size: string | null;
  readonly synced_at: string | null;
  readonly newstore_ref: string | null;
  /**
   * The company the customer chose and the fee they were told: the same on every row of a cart, and
   * NEVER part of `total_price`. Absent from a site that sends none. Read once per cart, never summed.
   */
  readonly delivery_carrier?: string | null;
  readonly delivery_fee?: string | null;
  /** What the shop last sent the courier to collect for this cart, as `set_order_tracking` told the site. */
  readonly amount_due?: string | null;
  /** How many rows the checkout said this cart has. Fewer here: still arriving, or left half-way. */
  readonly cart_size?: number | null;
  /** The article as the customer saw it. Optional: only the reference site sends it. */
  readonly product_name?: string | null;
}

/** One cart's parcel, as `set_order_tracking` takes it. */
export interface SiteParcel {
  readonly order_group: string;
  readonly carrier: string;
  readonly tracking: string;
  readonly status: string;
  /** The courier's public tracking page, when somebody knows it. Nothing sends one yet: see docs/delivery.md. */
  readonly url?: string | null;
  /** What the driver collects at the door, as sent to the courier: the customer's page shows it. */
  readonly amount_due?: string | null;
}

export interface OrdersPage {
  readonly orders: readonly OrderRow[];
  readonly next_after_id: number | null;
}

/**
 * One row of the site's `audit_log` for an order, as `order_events` exposes it.
 *
 * `ts`, `order_id` and `order_group` are nullable for the same reason as
 * `OrderRow`'s: the site's audit_log columns are, and the reference selects them
 * as they are. `planOrderEvents` used to key a Map on `order_group`, so every
 * null-group event collapsed onto one entry and then reported a status against
 * an order group of `null`.
 */
export interface OrderEvent {
  readonly id: number;
  readonly ts: string | null;
  readonly order_id: number | null;
  readonly order_group: string | null;
  readonly action: string;
  readonly from_status: string | null;
  readonly to_status: string | null;
  readonly by: string | null;
}

export interface OrderEventsPage {
  readonly events: readonly OrderEvent[];
  readonly next_after: number | null;
}

/** The site's repair timeline. The words on the customer's `/track/<ticket>` page. */
export type SiteRepairStatus = 'received' | 'diagnosing' | 'in_repair' | 'ready' | 'delivered' | 'cancelled';

/** One `repair_tickets` row as `upsert_repairs` takes it. Only keys PRESENT are written. */
export interface SiteRepair {
  /** NewStore's repair id. What the site's `external_id` (v28) holds. */
  readonly external_id: string;
  /** `REP-2026-0001`, as NewStore formatted it. */
  readonly ticket_number: string;
  readonly status: SiteRepairStatus;
  readonly client_name: string;
  /** Omitted — not null — when the repair has no phone: the site's operator may have typed one. */
  readonly client_phone?: string;
  readonly device_type: string;
  readonly device_brand: string | null;
  readonly device_model: string | null;
  readonly issue_description: string | null;
  /** Decimal string, or null while nothing is quoted. */
  readonly estimated_cost: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface UpsertRepairResult {
  readonly external_id: string;
  readonly id: number;
  readonly created: boolean;
  readonly error?: { readonly code: string; readonly message: string };
}

/** One row for the site's `message_queue`, as `enqueue_message` takes it — the admin's « Add to queue », by wire. */
export interface SiteMessage {
  readonly recipient_phone: string;
  readonly recipient_name: string;
  /** ≤ 1000 characters. */
  readonly body: string;
  readonly source: 'repair';
  /** What the message is about, for the site's operator: the ticket number. */
  readonly source_ref: string;
}

/** One photograph of a row, as `list_products` says it. */
export interface SiteCatalogueImage {
  readonly id: number;
  readonly image_path: string;
  /** Null on a photo the site added itself: NewStore's hash is told by `adopt_products`. */
  readonly content_hash: string | null;
  readonly sort_order?: number;
}

/** One product of the shop's site as `list_products` lists it, linked or not, public or not. */
export interface SiteCatalogueRow {
  readonly id: number;
  readonly external_id: string | null;
  readonly sku: string | null;
  readonly barcode: string | null;
  readonly name_fr: string | null;
  readonly name_ar: string | null;
  readonly name_en: string | null;
  readonly description_fr: string | null;
  readonly description_ar: string | null;
  readonly description_en: string | null;
  readonly price: string | null;
  readonly stock: string;
  readonly category: Readonly<Record<string, unknown>> | null;
  readonly specs: unknown;
  readonly pc_specs?: unknown;
  readonly is_public: 0 | 1;
  readonly is_service: 0 | 1;
  readonly has_colors: boolean;
  readonly has_sizes: boolean;
  readonly images: readonly SiteCatalogueImage[];
}

export interface CataloguePage {
  readonly products: readonly SiteCatalogueRow[];
  /** Where to ask from next, or null when this was the last page. */
  readonly next_after: number | null;
}

export interface AdoptItem {
  readonly id: number;
  readonly external_id: string;
  readonly images?: readonly { readonly id: number; readonly content_hash: string }[];
}

export interface SiteAdoptResult {
  readonly id: number | null;
  readonly external_id: string | null;
  readonly adopted: boolean;
  readonly images_stamped: number;
  readonly error?: { readonly code: string; readonly message: string };
}

export interface SiteUnlinkResult {
  readonly id: number | null;
  readonly external_id: string | null;
  readonly unlinked: boolean;
  readonly error?: { readonly code: string; readonly message: string };
}

export interface SiteHideResult {
  readonly id: number | null;
  readonly is_public: 0 | 1 | null;
  readonly changed: boolean;
  readonly error?: { readonly code: string; readonly message: string };
}

export interface PingResult {
  readonly ok: true;
  readonly contract: number;
  readonly site: string;
  readonly time: string;
  /** How many delivery options the site holds from a list the shop sent. Absent: it keeps no list. */
  readonly delivery_options?: number;
}

export interface SiteClientOptions {
  /** The site's root (`https://store.h47.io`) or the sync file itself (`…/api/sync.php`). */
  readonly siteUrl: string;
  /** `NEWSTORE_SYNC_KEY` on the site. Sent as `X-NewStore-Key` on every call. */
  readonly apiKey: string;
  readonly requestTimeoutMs: number;
  /** Injected by the tests to stand in for the site. */
  readonly fetch?: typeof globalThis.fetch;
}

/** The header the contract names. One constant so a test and the code agree by reference. */
export const KEY_HEADER = 'X-NewStore-Key';

/** `upsert_products` takes at most this many. */
export const UPSERT_BATCH = 100;
/** `set_stock` takes at most this many. */
export const STOCK_BATCH = 500;
/** `upsert_repairs` takes at most this many. */
export const REPAIR_BATCH = 100;
/** `orders` page size. */
export const ORDERS_LIMIT = 100;
/** `order_events` page size. */
export const ORDER_EVENTS_LIMIT = 200;
/** `list_products` page size. */
export const LIST_PRODUCTS_LIMIT = 100;
/** `adopt_products` takes at most this many. */
export const ADOPT_BATCH = 100;
/** `hide_products` takes at most this many. */
export const HIDE_BATCH = 500;

/**
 * Where `?action=` goes. A site url given as the root gets `/api/sync.php`
 * appended; one that already names the endpoint is used as it is. Both forms
 * appear on the Extensions screen in practice, and refusing one of them would be
 * a support call about a slash.
 *
 * « Names the endpoint » is a path ending in `.php`, a WordPress REST route
 * (`…/wp-json/newstore-sync/v1/sync`, what the WooCommerce plugin's settings
 * page shows) or an address that already carries a query string
 * (`…/?rest_route=/newstore-sync/v1/sync`, the same route without pretty
 * permalinks). Appending `/api/sync.php` to either of the last two built an
 * address nothing answers.
 */
export function syncEndpoint(siteUrl: string): string {
  const trimmed = siteUrl.trim().replace(/\/+$/u, '');
  const path = trimmed.replace(/[?#].*$/u, '');
  if (/\.php$/iu.test(path) || /\/wp-json\//iu.test(path) || trimmed.includes('?')) return trimmed;
  return `${trimmed}/api/sync.php`;
}

/** Anything the site sends on a refusal. Every field is optional on purpose. */
interface ErrorBody {
  readonly error?: string;
  readonly message?: string;
}

export class SiteClient {
  readonly #options: SiteClientOptions;
  readonly #fetch: typeof globalThis.fetch;
  readonly #endpoint: string;

  constructor(options: SiteClientOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#endpoint = syncEndpoint(options.siteUrl);
  }

  /** `GET ?action=ping`. Proves the key and the path before anything is pushed. */
  async ping(): Promise<PingResult> {
    return this.#call<PingResult>('GET', 'ping');
  }

  /** `POST ?action=upsert_products` `{products:[…]}`, at most 100. */
  async upsertProducts(products: readonly SiteProduct[]): Promise<readonly UpsertResult[]> {
    if (products.length > UPSERT_BATCH) {
      throw new SiteError('REFUSED', `upsert_products accepte au plus ${UPSERT_BATCH} produits par appel.`);
    }
    const body = await this.#call<{ results?: readonly UpsertResult[] }>('POST', 'upsert_products', {
      json: { products },
    });
    return body.results ?? [];
  }

  /** `POST ?action=set_stock` `{items:[{external_id, qty}]}`, at most 500. */
  async setStock(items: readonly StockItem[]): Promise<SetStockResult> {
    if (items.length > STOCK_BATCH) {
      throw new SiteError('REFUSED', `set_stock accepte au plus ${STOCK_BATCH} articles par appel.`);
    }
    const body = await this.#call<Partial<SetStockResult>>('POST', 'set_stock', { json: { items } });
    return { updated: body.updated ?? 0, missing: body.missing ?? [] };
  }

  /** `GET ?action=images&external_id=`. The site's photos for one product. */
  async images(externalId: string): Promise<readonly SiteImage[]> {
    const body = await this.#call<{ images?: readonly SiteImage[] }>('GET', 'images', {
      query: { external_id: externalId },
    });
    return body.images ?? [];
  }

  /**
   * `POST ?action=attach_image`, multipart: `external_id`, `content_hash`,
   * `sort_order`, `file`.
   *
   * Built with the platform `FormData` and `Blob` (Node 20+; the installer ships
   * Node 24), and NO content-type header of our own: fetch writes the multipart
   * boundary into the header itself, and a hand-set `multipart/form-data` without
   * that boundary is a body PHP cannot split. The site dedupes on `content_hash`,
   * answering 200 `deduped:true` for bytes it already holds, which is what makes a
   * re-push after a crash a no-op.
   */
  async attachImage(input: AttachImageInput): Promise<AttachImageResult> {
    const form = new FormData();
    form.append('external_id', input.external_id);
    form.append('content_hash', input.content_hash);
    form.append('sort_order', String(input.sort_order));
    form.append('file', new Blob([input.bytes], { type: input.contentType }), input.filename);
    const body = await this.#call<Partial<AttachImageResult>>('POST', 'attach_image', { form });
    if (typeof body.id !== 'number') {
      throw new SiteError('SERVER', "attach_image a répondu sans « id » : la photo n'est pas confirmée.");
    }
    return { id: body.id, image_path: body.image_path ?? '', deduped: body.deduped === true };
  }

  /** `POST ?action=delete_image` `{id}` or `{external_id, content_hash}`. */
  async deleteImage(
    target: { readonly id: number } | { readonly external_id: string; readonly content_hash: string },
  ): Promise<void> {
    await this.#call<{ deleted?: boolean }>('POST', 'delete_image', { json: target });
  }

  /** `GET ?action=orders&after_id=N&limit=100`. Rows, not carts; the module groups them. */
  async orders(afterId: number, limit: number = ORDERS_LIMIT): Promise<OrdersPage> {
    const body = await this.#call<Partial<OrdersPage>>('GET', 'orders', {
      query: { after_id: String(afterId), limit: String(limit) },
    });
    return { orders: body.orders ?? [], next_after_id: body.next_after_id ?? null };
  }

  /** `GET ?action=order_events&after=N&limit=200`. The site's audit log for orders. */
  async orderEvents(after: number, limit: number = ORDER_EVENTS_LIMIT): Promise<OrderEventsPage> {
    const body = await this.#call<Partial<OrderEventsPage>>('GET', 'order_events', {
      query: { after: String(after), limit: String(limit) },
    });
    return { events: body.events ?? [], next_after: body.next_after ?? null };
  }

  /** `POST ?action=ack_orders` `{ids, newstore_ref}`. Stamps `synced_at` on the rows. */
  async ackOrders(ids: readonly number[], newstoreRef: string): Promise<number> {
    const body = await this.#call<{ acked?: number }>('POST', 'ack_orders', {
      json: { ids, newstore_ref: newstoreRef },
    });
    return body.acked ?? 0;
  }

  /** `POST ?action=set_order_status` `{order_group, status, newstore_ref?}`. MOVES NO STOCK on the site. */
  async setOrderStatus(orderGroup: string, status: string, newstoreRef?: string): Promise<number> {
    const body = await this.#call<{ updated?: number }>('POST', 'set_order_status', {
      json: {
        order_group: orderGroup,
        status,
        ...(newstoreRef === undefined ? {} : { newstore_ref: newstoreRef }),
      },
    });
    return body.updated ?? 0;
  }

  /** `POST ?action=set_delivery_options`: the whole list. A site without it answers UNKNOWN_ACTION. */
  async setDeliveryOptions(options: readonly DeliveryOption[]): Promise<number> {
    const body = await this.#call<{ updated?: number }>('POST', 'set_delivery_options', { json: { options } });
    return typeof body.updated === 'number' ? body.updated : options.length;
  }

  /**
   * `POST ?action=set_order_tracking` `{order_group, carrier, tracking, status, url?}`.
   * The whole parcel, every time: the site replaces what it holds. Moves no stock
   * and no order status. An older site answers 404 UNKNOWN_ACTION, which this
   * throws like any refusal; the runner decides what that means.
   */
  async setOrderTracking(parcel: SiteParcel): Promise<number> {
    const body = await this.#call<{ updated?: number }>('POST', 'set_order_tracking', { json: { ...parcel } });
    return body.updated ?? 0;
  }

  /**
   * `POST ?action=upsert_repairs` `{repairs:[…]}`, at most 100. Upserts by
   * `external_id`; a per-repair refusal comes back INSIDE the 200 as
   * `results[i].error`, never as a throw, so one bad row does not hold the batch.
   */
  async upsertRepairs(repairs: readonly SiteRepair[]): Promise<readonly UpsertRepairResult[]> {
    if (repairs.length > REPAIR_BATCH) {
      throw new SiteError('REFUSED', `upsert_repairs accepte au plus ${REPAIR_BATCH} réparations par appel.`);
    }
    const body = await this.#call<{ results?: readonly UpsertRepairResult[] }>('POST', 'upsert_repairs', {
      json: { repairs },
    });
    return body.results ?? [];
  }

  /**
   * `POST ?action=enqueue_message` — one row into the site's `message_queue`,
   * exactly as the admin's « Add to queue » inserts it; the site's phone app
   * sends it. NOT idempotent on the site's side — the queue is a queue — which
   * is why the runner remembers each (repair, status) it has queued and never
   * asks twice. An answer without an `id` is not a confirmation.
   */
  async enqueueMessage(message: SiteMessage): Promise<{ readonly id: number | string }> {
    const body = await this.#call<{ id?: number | string }>('POST', 'enqueue_message', { json: message });
    if (typeof body.id !== 'number' && typeof body.id !== 'string') {
      throw new SiteError('SERVER', "enqueue_message a répondu sans « id » : le SMS n'est pas confirmé.");
    }
    return { id: body.id };
  }

  /** `GET ?action=list_products&after=N&limit=100`. Every product of this shop. */
  async listProducts(after: number, limit: number = LIST_PRODUCTS_LIMIT): Promise<CataloguePage> {
    const body = await this.#call<Partial<CataloguePage>>('GET', 'list_products', {
      query: { after: String(after), limit: String(limit) },
    });
    return { products: body.products ?? [], next_after: body.next_after ?? null };
  }

  /**
   * `POST ?action=adopt_products` `{items:[{id, external_id, images?}]}`, at most 100.
   * Links existing rows and stamps their photos. A row's refusal comes back INSIDE the
   * 200; an older receiver answers 404 UNKNOWN_ACTION, thrown like any refusal.
   */
  async adoptProducts(items: readonly AdoptItem[]): Promise<readonly SiteAdoptResult[]> {
    if (items.length > ADOPT_BATCH) {
      throw new SiteError('REFUSED', `adopt_products accepte au plus ${ADOPT_BATCH} articles par appel.`);
    }
    const body = await this.#call<{ results?: readonly SiteAdoptResult[] }>('POST', 'adopt_products', {
      json: { items },
    });
    return body.results ?? [];
  }

  /**
   * `POST ?action=hide_products` `{ids, hidden}`, at most 500. Flips `is_public` on
   * rows NewStore does not manage. Never deletes, never moves stock.
   */
  async hideProducts(ids: readonly number[], hidden: boolean): Promise<readonly SiteHideResult[]> {
    if (ids.length > HIDE_BATCH) {
      throw new SiteError('REFUSED', `hide_products accepte au plus ${HIDE_BATCH} articles par appel.`);
    }
    const body = await this.#call<{ results?: readonly SiteHideResult[] }>('POST', 'hide_products', {
      json: { ids, hidden },
    });
    return body.results ?? [];
  }

  /**
   * `POST ?action=unlink_products`: this row is the site's own again. Only the link goes.
   * A row already free answers `unlinked: false`, which is success: asking twice is safe.
   */
  async unlinkProducts(items: readonly { id: number; external_id: string }[]): Promise<readonly SiteUnlinkResult[]> {
    const body = await this.#call<{ results?: readonly SiteUnlinkResult[] }>('POST', 'unlink_products', {
      json: { items },
    });
    return body.results ?? [];
  }

  /**
   * The one place a socket to the site is opened, and the one place its answer is
   * judged. Everything above is a thin shape over this.
   */
  async #call<T>(
    method: 'GET' | 'POST',
    action: string,
    options: { query?: Record<string, string>; json?: unknown; form?: FormData } = {},
  ): Promise<T> {
    const search = new URLSearchParams({ action, ...(options.query ?? {}) });
    // `&` when the endpoint already has a query (`?rest_route=…`).
    const url = `${this.#endpoint}${this.#endpoint.includes('?') ? '&' : '?'}${search.toString()}`;

    const headers: Record<string, string> = {
      accept: 'application/json',
      [KEY_HEADER]: this.#options.apiKey,
    };
    let body: string | FormData | undefined;
    if (options.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.json);
    } else if (options.form !== undefined) {
      body = options.form; // fetch sets the multipart content-type, boundary included
    }

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(this.#options.requestTimeoutMs),
      });
    } catch (error) {
      throw new SiteError(
        'UNREACHABLE',
        `Le site (${this.#endpoint}) ne répond pas. Vérifiez la connexion Internet et que le `
        + 'site est bien en ligne. Le module réessaiera ; rien n’est perdu.',
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }

    return judge<T>(response, action);
  }
}

/**
 * Parse the answer, and turn anything that is not a JSON success into the right
 * kind of error.
 *
 *   401                  → CREDENTIALS. The key is wrong; the owner must fix it.
 *   429                  → THROTTLED.
 *   5xx                  → SERVER. Including 503 SYNC_NOT_CONFIGURED: the owner has
 *                          not set the key on the site yet, and will — the module
 *                          waits on the backoff rather than dying to be restarted.
 *   other 4xx            → REFUSED, with the site's code and sentence.
 *   not JSON (any status) → SERVER, carrying the first line of what came back.
 *   2xx JSON with `error` → REFUSED. The contract says errors get a real status;
 *                          this is belt and braces against a handler that forgot.
 */
async function judge<T>(response: Response, action: string): Promise<T> {
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }

  if (parsed === undefined || typeof parsed !== 'object' || parsed === null) {
    const glimpse = text.replace(/\s+/gu, ' ').trim().slice(0, 120);
    throw new SiteError(
      'SERVER',
      `Le site a répondu à « ${action} » par autre chose que du JSON (HTTP ${response.status})`
      + (glimpse ? ` : « ${glimpse} »` : '')
      + '. Vérifiez l’adresse du site et que api/sync.php est en place.',
      { status: response.status },
    );
  }

  const errorBody = parsed as ErrorBody;
  const code = typeof errorBody.error === 'string' ? errorBody.error : null;
  const message = typeof errorBody.message === 'string' ? errorBody.message : `HTTP ${response.status}`;

  if (response.status === 401) {
    throw new SiteError(
      'CREDENTIALS',
      `Le site refuse la clé de synchronisation (${code ?? 'UNAUTHORIZED'}) : ${message} `
      + 'Vérifiez NEWSTORE_SYNC_KEY sur le site et la clé saisie dans NewStore.',
      { status: 401, code },
    );
  }
  if (response.status === 429) {
    throw new SiteError('THROTTLED', message, { status: 429, code });
  }
  if (response.status >= 500) {
    throw new SiteError('SERVER', message, { status: response.status, code });
  }
  if (!response.ok || code !== null) {
    throw new SiteError('REFUSED', message, { status: response.status, code });
  }
  return parsed as T;
}
