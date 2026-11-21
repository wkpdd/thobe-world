# Prompt — add "Modèles & déclinaisons" to NewStore

> **Probably no longer needed (Nov 2026).** NewStore now sends modèles with a
> colour × size grid (contract 1.2, `@h47io/sync-receiver` 1.1+), and the store
> uses them. Keep this only if something is still missing in the H47 Pay screens.

> Paste everything below the line into a Claude Code session opened on the
> `wkpdd/newstore` repository. The prompt has a hard stop after the audit, so
> nothing is written until you approve the plan.

---

You are working in the NewStore monorepo (offline-first stock & POS for Algerian
retail; Fastify + PostgreSQL server in `packages/server`, React UI in
`packages/ui`, website sync in `modules/website-sync`, the site contract in
`integrations/contract`, receivers in `integrations/php` and `integrations/node`).

## Goal

A clothing & perfume shop (qamis, chèche/chach, perfumes, accessories) must manage
**models with variants** entirely from NewStore and publish them to its website:

- A **model** (modèle) e.g. « Qamis Sultan — lin » owns the shared data: names
  FR/AR, famille, marque, web descriptions, default price, photos.
- A model has **axes**: usually **Couleur** (with a hex swatch) and **Taille**
  (52, 54, 56… or S/M/L), for perfumes **Contenance** (30/50/100 ml). Zero, one
  or two axes.
- Every combination is a **variant**. Each variant has its own sku, barcode,
  price override (optional) and its own stock **per depot**. Stock is per
  variant, never per model.
- Photos belong to the model **or to one colour value**, and all sizes of that
  colour share them.
- The website must receive enough to build ONE landing page per model, with
  colour swatches, sizes greyed out when the variant is at 0, and per-variant
  quantity.

## STEP 0 — Audit first. Do not write code, migrations or files in this step.

Read the code before you propose anything. Answer each question with file paths
and line numbers, and say "not found" when you find nothing. Do not guess.

1. **Does anything model/variant-like already exist?** Search migrations,
   server, shared and UI for: model, modele, modèle, variant, declinaison,
   déclinaison, couleur, coloris, taille, size, parent_id on product, matrix,
   grille, `attrs`, `attribute_definition`. I already know that `variant` mostly
   means image sizes (`variantETag`, `variantPath`). Separate those hits from any
   real product-variant concept. Also check whether `attribute_definition` (an ENUM
   attribute with scope PRODUCT) plus `product.attrs` could carry colour/size, and
   whether it is enough on its own. My expectation is no, because nothing groups
   articles into a model.
2. **Product spine.** Read `migrations/0002_catalogue.sql` and every later
   migration that alters `product`, `product_image`, `product_category`,
   `price_list` and `price_rule`. Answer: where does the sale price (DETAIL) live,
   how is the sku generated, how are barcodes stored (`product_barcode`?), and how
   are images attached (`product_image`, `0015_product_image_dedupe.sql`)?
3. **Stock.** Show how quantity per depot is read (`quant`, `qty_on_hand`,
   `qty_reserved`) and how stock enters. The rule is "stock is never adjusted,
   only moved". List the documents and screens a person uses today to add stock
   to an article: reception, inventaire, opening stock. Variants must use exactly
   these paths and must never write quantities directly.
4. **Product UI.** Summarise `ProductForm.tsx`, `QuickAddProduct.tsx`,
   `CatalogueBrowse.tsx`, `Receiving.tsx`, `InventoryCount.tsx`, `Labels.tsx` and
   `Pos.tsx`. For each one, say where a model and its variant grid would plug in.
5. **Website feed & contract.** Read `packages/server/src/api/routes/website.ts`
   (feed, `contentHashOf`, availability), `modules/website-sync`,
   `integrations/contract/actions.json` + `README.md` + `conformance/`,
   `integrations/php/src/{Validate,ProductMapper,Contract}.php` and
   `integrations/node/src/{validate,contract}.ts`. Answer: **do the receivers
   reject unknown product keys?** If they do, a new optional key breaks every
   deployed site. Note how the contract is versioned (`contract: 1`, "1.1" for
   category code) and how a minor version is added.
6. **Conventions.** Next migration number (I believe `0073`). The
   immutable-migration rule. How new permissions are inserted (the "0045 lesson").
   Money and quantity are scaled bigints. How tests run against a real
   PostgreSQL. The i18n files (`locales/fr.ts`, `ar`?). Lockout and dev setup.

**Then STOP.** Reply with:
- the audit findings,
- a gap list: what exists and can be reused vs what is missing,
- your proposed design (schema, API, UI, contract), using what exists wherever
  it fits and flagging every place you disagree with the design sketch below,
- the risks: existing data, offline/replication (`0070_replication_log`), the
  ledger, deployed websites,
- a step list with the tests each step adds.

Wait for my explicit "go" before changing anything.

## Design sketch to check against what you find (not a spec, challenge it)

**Schema (new migration, additive only):**
- `product_model (id, company_id, code UNIQUE per company, designation_fr,
  designation_ar, category_id, brand_id, web_description_fr, web_description_ar,
  is_online, created_at, updated_at)`.
- `product_model_axis (id, model_id, code, label_fr, label_ar, kind
  COLOR|SIZE|OTHER, position)` with at most 2 axes per model.
- `product_model_axis_value (id, axis_id, code, label_fr, label_ar, hex NULL,
  position)`. `hex` is required when kind = COLOR.
- `product.model_id uuid NULL` plus a variant-values link
  (`product_variant_value (product_id, axis_id, value_id)`, unique per
  product+axis, and unique combination per model). A product with no model keeps
  working exactly as today. That covers standalone perfumes and every existing
  article.
- Images: either `product_image.model_id` / `axis_value_id`, or a
  `product_model_image` table. Choose after reading `0015` and the image pipeline.
  Dedupe by sha256 must keep working.
- Optional web merchandising fields on the model: `compare_at_price`, `badges
  text[]`, `highlights_fr/ar text[]`.

**Behaviour:**
- **Generate variants**: pick the axis values and preview the matrix
  (colour × size), then create the missing articles in one transaction. Each gets
  an sku `{MODEL_CODE}-{COLOR_CODE}-{SIZE_CODE}` (check the existing sku rules), an
  internal EAN-13 barcode if the shop uses them, the model's famille, marque and
  TVA, and the model price unless overridden. Re-running only adds missing
  combinations. Removing a value deactivates its variants, never deletes them,
  because the ledger references them.
- **Stock by grid**: in Réception and in Inventaire, choosing a model opens a
  colour × size grid of quantities. It produces ordinary document lines, one per
  variant, posted through the existing posting path. No new stock writer.
- **Model screen**: the grid shows per-variant available quantity per depot and
  in total, inline price override, barcode, active/online toggles, and photos per
  colour.
- **POS & labels**: scanning a variant barcode sells that variant. Search finds
  the model and opens the grid. Labels print model name + colour + size.
- **Permissions**: reuse the product permissions (`product.*`) unless the audit
  shows a reason not to. `product.cost.view` stripping must also apply to model
  endpoints.

**Website (contract 1.2, backward compatible):**
- The feed still sends one item per sellable **variant** (identity stays
  `external_id = product.id`, `set_stock` unchanged). Each item gains OPTIONAL:
  - `model: {code, name_fr, name_ar, description_fr, description_ar,
    compare_at_price?, badges?, highlights_fr?, highlights_ar?}`
  - `variant: {position, values: [{axis_code, axis_kind, axis_label_fr,
    axis_label_ar, value_code, value_label_fr, value_label_ar, hex?,
    position}]}`
  - images scoped to the colour value.
- `contentHashOf` must include these fields so a model edit re-pushes its
  variants.
- Update `actions.json`, the contract README (with the *why*), new conformance
  cases, and both receivers (PHP + Node). A receiver that does not know 1.2 must
  keep working. If the audit shows receivers reject unknown keys, gate the new
  keys on the receiver's `ping` contract version.
- Web orders are unchanged: each line already points at a variant's
  `external_id`.

**Non-negotiables:** applied migrations are never edited. `stock_move` is never
updated or deleted. No `number` for money or quantity. Every error is a French
sentence a shopkeeper can read. Tests run against real PostgreSQL and cover
generation idempotency, grid reception, feed shape and hash change, and the old
contract still passing. `npx tsc --build` and `npm test` pass at every step.
