# عالم الثوب · Thobe World — men's store: plan, design, architecture

> Brand: « تأنق كأنك ملك » · +213 659 11 85 69 · Instagram @thobe_world_ · حي العربي بن مهيدي، أمام السونلغاز القديمة

> **Update (Nov 2026), now built.** H47 Pay already has modèles (contract 1.2),
> a delivery module (Noest, Yalidine, ZR, Ecotrack) and the npm package
> `@h47io/sync-receiver` 1.3.0. The store is therefore a Node app on that
> package (see `../README.md`), not a Gamra/PHP fork. H47 Pay drives the
> carriers, so the site holds no courier token. Phases 1–4 below are done,
> except connecting the real shop. Phase 5 is half done: pixels, SEO and
> performance are in place, the deployment is not.

## 1. What I found in your repos

| Repo | What it gives us |
|---|---|
| `newstore` | Owns the catalogue, stock (ledger per depot), web-order inbox, confirmation → bon de livraison. Has a **website-sync module** and a written **contract** (`integrations/contract`) with a ready **PHP receiver library** (`integrations/php`, `SyncReceiver`). |
| `thegamra` | Your latest PHP/MySQL cPanel store: RTL Arabic, COD checkout, wilaya/commune rates, **Noest + Yalidine drivers** (`app/Services/Delivery`), pixels, colour images + sizes. |
| `touatstore` | Older store with `NoestApi.php`. Reference only. |

**Gap:** NewStore's `product` is flat. It has no *model → colour → size*
concept. ("variant" in the code only means image sizes.) So "each colour has its
own quantity" needs the NewStore enhancement in
[`NEWSTORE_MODELS_PROMPT.md`](NEWSTORE_MODELS_PROMPT.md).

## 2. Architecture

```
 Shop PC                                       cPanel (waqar.dz)                 Carriers
┌──────────────────────────────┐   HTTPS      ┌───────────────────────────┐     ┌──────────┐
│ NewStore                     │ X-NewStore-  │ api/sync.php              │     │  Noest   │
│  Modèles → variantes         │ Key          │  (integrations/php        │     │ (main)   │
│  stock per depot (ledger)    │──────────────▶   SyncReceiver)           │────▶│          │
│  web-order inbox → confirm   │ products,    │ Storefront (Gamra fork)   │     ├──────────┤
│  website-sync module         │ stock, imgs  │  model landing pages      │────▶│ Yalidine │
│                              │◀──────────── │  COD checkout + fees      │     │ (option) │
└──────────────────────────────┘ orders,      │  admin: delivery, pixels  │     └──────────┘
                                 events       └───────────────────────────┘
```

- **NewStore is the single source of truth** for models, variants, prices,
  photos and stock. On site-managed products the site's own stock/sku fields are
  locked. The contract already enforces this.
- **Order flow:** customer orders on the site (stock is checked) → the module
  pulls it into the NewStore inbox (a slip prints) → you confirm in NewStore and
  pick the depot, which posts a BL and moves stock → the new quantity is pushed to
  the site → status `confirmed` → the parcel is created at Noest/Yalidine →
  tracking.
- **Delivery, phase 1:** the site creates the parcel when NewStore confirms,
  reusing Gamra's drivers, and imports fees/communes/desks from Noest.
  **Phase 2 (optional):** a NewStore `livraison` module, already anticipated in
  NewStore's manifest and permissions, so the tracking number lives on the BL.

## 3. Palette — "goldish white with a little beige"

| Token | Hex | Use |
|---|---|---|
| Ivory | `#FBF8F2` | page background |
| Pearl | `#FFFFFF` | cards, fields |
| Sand | `#EFE6D6` | beige sections, chips |
| Linen | `#E2D4BC` | dividers, hover |
| Hairline | `#E6DCCB` | borders |
| **Gold** | `#C9A45C` | accent, gold buttons (dark text), swatch ring, stars. **Decor only** |
| Gold soft | `#E9D9B4` | highlight backgrounds |
| Gold deep | `#8A6A2E` | gold **text**/links (4.7:1) |
| Ink | `#1F1B16` | text, dark CTA (16:1) |
| Muted | `#6B6255` | secondary text (5.6:1) |
| Success / Danger | `#3D6B4F` / `#9E3B2F` | in stock / low stock |

Type: **Amiri** (Arabic headings), **Tajawal** (Arabic body), **Cormorant
Garamond** (Latin logo/eyebrows). All text pairs pass WCAG AA. Tokens are in
`design/tokens.css`.

## 4. Site structure

```
/                      Home: hero, categories, best sellers, perfume band, trust
/c/{category}          Qamis · Chèche · Parfums · Accessoires (filters: colour, size, price)
/p/{model-slug}        ★ Product LANDING page (one per NewStore model)
/cart  /checkout       Multi-item cart (the landing page also has an inline order form)
/track                 Order tracking (Noest / Yalidine number)
/admin                 Orders, delivery settings & fees, pixels, landing blocks, reviews
/api/sync.php          NewStore receiver (contract 1.2)
```

**Product landing page, in order:** gallery that switches with the colour ·
name, rating, price + old price + saving · colour swatches (crossed out when
sold out) · sizes (disabled at 0) · live per-variant stock ("only 3 left") ·
**inline COD form** (name, phone, wilaya, commune, Noest/Yalidine,
home/stop-desk, quantity capped at stock, live total) · trust tiles · fabric
story blocks · "complete the look" upsell (chèche) · size guide · reviews · FAQ
· sticky mobile CTA · Meta/TikTok pixels.

## 5. Phases

| # | Phase | Where | Output |
|---|---|---|---|
| 0 | Design system + mockups | this folder | ✅ `design/` (done) |
| 1 | NewStore "Modèles & déclinaisons" + contract 1.2 | `newstore` | via the prompt: audit → approval → build |
| 2 | Storefront: fork Gamra, apply the design, model-grouped catalogue, landing page, FR/AR | new repo | site running on sample data |
| 3 | Receiver: `api/sync.php` with `integrations/php` + MySQL `Storage` (contract 1.2) | new repo | live sync from NewStore |
| 4 | Delivery: Noest (default) + Yalidine, fee import, parcel on confirm, tracking page | new repo | end-to-end order → parcel |
| 5 | Pixels, SEO, performance, cPanel deploy, go-live checklist | — | live store |

Phases 1 and 2 can run in parallel. Phase 3 needs both.
