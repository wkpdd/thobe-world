# عالم الثوب · Thobe World — the online store

> « تأنق كأنك ملك »: qamis, chèche, perfumes and accessories for men. Arabic first,
> French on a click, cash on delivery to the 58 wilayas.

**H47 Pay (NewStore) is the database. Everything goes through it.** The site
holds no catalogue of its own. Products, modèles (colour × size with stock per
variant), prices, promotions, photos, stock, the delivery price list
(Noest / Yalidine), order statuses and parcel numbers are all managed in H47 Pay
and pushed to the site. Web orders go back to H47 Pay's « Commandes web ». The
link is the owner's own package, [`@h47io/sync-receiver`](https://www.npmjs.com/package/@h47io/sync-receiver)
(1.3.0), mounted at `/api/sync.php`.

```
 Shop PC — H47 Pay                                   Website (this repo, Node)
┌───────────────────────────┐   HTTPS + X-NewStore-Key  ┌──────────────────────────────────┐
│ Modèles, variantes, stock │ ─ upsert_products ───────▶ │ /api/sync.php (@h47io/sync-…)   │
│ Photos                    │ ─ attach_image ──────────▶ │   data/store.json  data/uploads │
│ Livraison (Noest/Yalidine)│ ─ set_delivery_options ──▶ │   → WebP sizes in data/cache    │
│ Commandes web ◀───────────│ ◀ orders / ack_orders ──── │ Pages: home, catégories, produit│
│ Confirmer → BL → stock    │ ─ set_order_status/stock ▶ │   (landing), panier, commande,  │
│ Colis → Noest / Yalidine  │ ─ set_order_tracking ────▶ │   merci, suivi, pages légales   │
└───────────────────────────┘                            └──────────────────────────────────┘
```

The shop always calls the site; the site never calls the shop. The site never
writes stock: placing an order checks the stock and the shop's confirmation
moves it. Noest and Yalidine are driven from H47 Pay's livraison module, so the
site holds no courier token.

## What a customer gets

- **Product landing page** for every article and modèle:
  - a gallery that changes with the colour, with sold-out colours crossed out
  - sizes greyed out when that colour × size is at 0, and a live "only 3 left"
  - quantity capped at the stock, promo price and saving
  - details (`specs`), highlights, size guide, "complete the look" and FAQ
  - the owner's own « Page de présentation » shown sandboxed
  - a sticky mobile button and an **inline cash-on-delivery form**
- **Delivery** from H47 Pay's own list: wilaya, then courier (only when two
  serve it), then home or stop desk, with the price computed **on the server**.
  Communes of all 58 wilayas.
- **Cart and checkout** for several articles, then a thank-you page and
  **order tracking** (reference + phone) showing the courier, tracking number,
  parcel status and amount to pay.
- **Protection against fake orders**: Algerian mobile numbers only (05/06/07),
  the same basket sent twice is recognised, a limit per device and a honeypot.
  A sale at the till during checkout gives a clear "only 1 left" message.
- **Fast**: server-rendered HTML, no framework. Photos from H47 Pay are stored
  verbatim, as the contract requires, but served as resized **WebP**
  (an 850 KB phone photo becomes 6 KB on a phone) with a one-year cache.
  Fonts are self-hosted and subset, and HTML is gzip-compressed. Measured on a
  throttled slow-4G phone: largest paint under 0.9 s and layout shift about 0.
  The product page weighs about 210 KB.
- **SEO and ads**: canonical URLs, Open Graph, `Product` JSON-LD, sitemap and
  robots. Meta, TikTok and Google pixels with ViewContent, AddToCart,
  InitiateCheckout and Purchase events.

## Website dashboard (/admin)

Products, prices, stock, categories (« familles ») and orders come from
H47 Pay. Two things are managed on the website itself, at
**https://thobeworld.com/admin**:

- **Carrousel**: wide pictures at the top of the home page, each with an
  optional picture for phones, a title, subtitle and button in Arabic and
  French, and a link (category, launch, article or any address).
  - Put them in order with ↑ ↓.
  - Schedule them with « à partir du » / « jusqu’au ».
  - With no visible slide, the home page shows its usual banner.
- **Lancements exclusifs**: pick articles that H47 Pay sent and set the
  opening date and hour (Algiers time). Before that hour:
  - the articles show « قريباً » and a countdown, on their page and on
    `/lancement/<name>`, which is also promoted on the home page;
  - they **cannot be ordered**, and the server refuses an early order;
  - customers can leave their number (« نبّهني »). The dashboard lists them
    with a ready-to-send WhatsApp message, and a CSV export.

  At the hour the order form appears by itself. A **limited edition** shows
  « حصري · كمية محدودة » and the pieces left. An optional **maximum per
  customer** counts every order from the same phone number.

To open the dashboard, set `ADMIN_PASSWORD` (12 characters or more, and
optionally `ADMIN_USER`) in cPanel → Setup Node.js App → Environment variables,
then click Restart. Its data is `data/site-content.json` and `data/media/`, in
the shared data folder that deploys never touch.

The login protections:
- 8 wrong passwords lock that address for 15 minutes;
- the session lasts 12 hours, and changing the password signs everyone out;
- forms posted from another site are refused.

## Run it

```bash
npm install
npm run demo        # store + demo catalogue pushed by H47 Pay's own client → http://localhost:8080
```

```bash
cp .env.example .env   # set NEWSTORE_SYNC_KEY, APP_SECRET, SITE_URL
npm start
```

Node 20.9+ runs the store. Node 22.18+ is needed for `npm run demo` and the
tests, which load H47 Pay's TypeScript client directly.

## Tests

```bash
npm test            # unit (node:test) + end-to-end (Playwright)
```

The end-to-end suite starts the store on a fresh data folder. It then plays the
shop with **H47 Pay's own website client**, `test/newstore/site.ts`, vendored
from `wkpdd/newstore`. A real browser plays the customer:

1. A wrong phone number or a missing size is refused, in Arabic.
2. Order 2 × Qamis Sultan Blanc 54 on the landing page, Yalidine stop desk in
   Alger. The total is 13 800 + 250 = 14 050 DA.
3. H47 Pay pulls the order and gets every key it needs: variant, quantity,
   wilaya, courier, fee and address with commune. Then it acknowledges it.
4. The same order sent twice does not reach the shop twice.
5. H47 Pay confirms and pushes the new stock. The page greys out the
   sold-out size and shows "4 left".
6. The parcel goes to Yalidine and the customer tracks it with reference and
   phone. A wrong phone shows nothing.
7. A cart of two articles from two pages becomes one order of two rows. The
   cart is emptied.
8. A till sale while the customer fills the form gives a clear refusal, and
   no order is created.
9. A wilaya with no delivery offer is refused.
10. The shop archives a modèle and deletes a photo, and the site follows.
11. A wrong sync key is refused in the contract's envelope.
12. Shop-front checks:
    - Arabic and French, and filters and search
    - per-colour gallery and per-cell stock
    - WebP at under 10 % of the original weight
    - 404 page, sitemap and canonical redirects
    - no sideways scroll on a phone, page weight under 250 KB

## Connect H47 Pay

1. Deploy the site behind HTTPS and set `NEWSTORE_SYNC_KEY` to a long random
   key.
2. In H47 Pay, the licence must include **website-sync**. Enable the module in
   *Extensions*. Then go to **« Mon site web » → Ajouter un site** and enter
   the site address (`https://…`) and **the same key**. *Tester la connexion*
   must answer « connecté ».
3. Within a minute the catalogue, photos and delivery list arrive. Web orders
   appear in **« Commandes web »**. Confirming one moves the stock, and the
   site follows at the next pass.

**How to name things in H47 Pay so the site looks right:**

- **Modèle** (e.g. « Qamis Sultan — lin »): set the colours **with their
  hex**, the sizes, the web description in FR and AR, highlights and badges.
  Add photos per colour, face first.
- **Famille**: one per category (Qamis, Chèche, Parfums, Accessoires). Fill
  in its Arabic name.
- **Promotions**: set them on the article. The crossed-out price appears and
  disappears by itself.
- **Livraison**: switch Noest on, and Yalidine if you use it, with your tokens
  and prices. The site offers exactly that list.

## Deploy (cPanel shared hosting)

```bash
npm run deploy            # build → upload → switch → verify, automatic rollback on failure
npm run deploy:rollback   # back to the previous release, in seconds
npm run deploy:status     # what is live and what you can roll back to
```

The cPanel « Setup Node.js App » runs a small switcher (`app.cjs`) that keeps
the 5 latest releases side by side. H47 Pay's data stays in a shared `data/`
folder that deploys never touch. Uploads go through cPanel's HTTPS API with an
API token, or by FTP. The one-time setup and how it works are in
**[docs/DEPLOY.md](docs/DEPLOY.md)**.

> Algerian law 18-05 asks an online seller to show its commercial register
> details and to host the site in Algeria under `.dz`. Fill `SHOP_RC`/`SHOP_NIF`
> and check the hosting with your accountant.

## Still to provide (owner)

- Real photos in H47 Pay. The demo draws placeholders.
- The **size guide** measurements (`src/views/product.js`, `QAMIS_GUIDE`).
  Today's values are placeholders.
- The **policy wording** (`src/views/policies.js`: 7-day exchange, delays).
  Confirm every sentence.
- Domain and Algerian hosting, the RC/NIF numbers, and the pixel IDs.

## Layout

```
src/app.js          routes; mounts @h47io/sync-receiver at /api/sync.php
src/catalogue.js    H47 Pay rows → what pages draw (modèles, colours, photos, stock)
src/orders.js       checkout checks, duplicate guard, rate limit, tracking
src/content.js      what /admin manages: carousel slides, launches, « notify me » sign-ups
src/launches.js     launch rules on orders (closed before the hour, max per customer)
src/admin/          the dashboard: login, pages, routes
src/images.js       WebP sizes from the verbatim uploads, cached
src/views/          server-rendered pages (layout, home, listing, product, cart, …)
public/             css, small scripts, self-hosted fonts, communes of the 58 wilayas
scripts/            demo catalogue (shaped exactly as H47 Pay sends it) and `npm run demo`
deploy/             `npm run deploy`: release build, cPanel/FTP upload, switcher (bootstrap.cjs), rollback
test/               unit, deploy and Playwright end-to-end; test/newstore/site.ts = H47 Pay's client
design/  brand/  docs/   mockup, palette, logo files (brand/README.md), plan
```
