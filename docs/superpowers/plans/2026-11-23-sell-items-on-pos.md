# Sell Stock Items on the POS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An inventory item can be switched to "Sell on POS" with a price, menu category, sold-per unit and photo, and it then sells on the POS like any product, deducting stock.

**Architecture:** Each sellable item owns one hidden *item-managed* product (`products.source_item_id`). It has one variant "Each" whose recipe is 1 × the chosen unit of the item. A shared `upsertProduct` (extracted from `saveProduct`) writes it, so duplicate-name checks, recipe building and audit stay in one place. The POS, orders, payments, refunds and reports are not touched.

**Tech Stack:** Next.js 16.4 (App Router, cacheComponents), TypeScript strict, Drizzle ORM + PostgreSQL, next-intl 4.15, shadcn/ui, Vitest, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-23-sell-items-on-pos-design.md`

## Global Constraints

- Managed product: `kitchen_station = "none"`, `deduct_stock = true`, a single variant named `"Each"` with `is_default = true`, and a recipe of exactly one line: the item, `qty = "1"` in the chosen `unitKey`.
- On = `products.is_active = true`, off = `false`. A managed product is never deleted.
- `setItemSale` requires `menu.manage`. Price is ≥ 0 with at most 4 decimals (the existing `price()` rule in `lib/validators/menu.ts`). `unitKey` uses the `base` / `g:<code>` / `iu:<id>` convention (`lib/domain/units.ts`).
- Audit action `item.sale`, with before and after, written in the same transaction.
- `saveProduct` refuses managed products with the message `Edit this from its inventory item.` (a `ValidationError`). Image upload and remove, and branch prices, stay allowed.
- New UI text goes under the `ItemSale` namespace in both `messages/en.json` and `messages/km.json` (parity test). Links and routers come from `@/i18n/navigation`.
- Migration is add-only: `drizzle/0020_*` from `pnpm db:generate`.
- Stage files by explicit path, never `git add -A`. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Water counted in ml, sold "per bottle".** One sale must deduct 1,000 ml (the unit factor), not 1 ml. Pinned in Task 1, test `deducts the unit factor`.
2. **Turning on an item whose name matches an existing menu product.** Must give a clear conflict error, not a database crash. Pinned in Task 1, test `name clash is a clear error`.
3. **Renaming an item to a name a menu product already has.** Must refuse with the same clear error, and leave the item unchanged. Pinned in Task 2, test `rename clash refuses`.
4. **Re-enabling after switching off.** Must reuse the same product, keeping its photo and sales history; no duplicate product. Pinned in Task 1, test `off then on reuses the product`.
5. **A cashier opening the item page.** Must not see the Sell on POS card. The server action must refuse too. Pinned in Task 1 (`menu.manage` required) and Task 3 (card hidden without `menu.manage`).

---

### Task 0: Precondition — clean base

**Files:** none.

- [ ] **Step 1:** Run `git status --short`. If files other than this plan show as modified or untracked, they belong to other work (the UI redesign, the login fix). Stop and report BLOCKED: the owner commits those first.
- [ ] **Step 2:** Run `git switch -c feat/sell-items-on-pos`.

### Task 1: Data, service and settings query

**Files:**
- Modify:
  - `db/schema/menu.ts` (add `sourceItemId` to `products`, plus partial unique index `products_source_item_uq`);
  - `lib/services/menu.ts` (extract `upsertProduct`, guard `saveProduct`).
- Create:
  - `drizzle/0020_*.sql` (generated);
  - `lib/services/item-sale.ts`;
  - `lib/validators/item-sale.ts`.
- Modify: `lib/queries/menu.ts` (add `getItemSale`).
- Test: `tests/integration/item-sale.test.ts`.

**Interfaces:**
- Produces:
  - `products.sourceItemId: string | null` (uuid, FK `items.id`).
  - `upsertProduct(tx: Executor, ctx: AppContext, id: string | null, data: ParsedProductInput, extra?: { sourceItemId?: string }): Promise<Product>` in `lib/services/menu.ts`. This is the current `saveProduct` body. `saveProduct` becomes: `requireMenuManage`, parse, load the product if `id` is set, and throw `ValidationError("Edit this from its inventory item.")` if `sourceItemId` is set. Then `inTransaction(… upsertProduct …)`.
  - `itemSaleInput` (Zod) and `type ItemSaleInput = { enabled: boolean; price: string; categoryId: string | null; unitKey: string }` in `lib/validators/item-sale.ts`.
  - `setItemSale(ctx: AppContext, itemId: string, input: ItemSaleInput): Promise<{ productId: string }>` in `lib/services/item-sale.ts`.
  - `getItemSale(ctx: AppContext, itemId: string): Promise<{ productId: string; enabled: boolean; price: string; categoryId: string | null; unitKey: string; imageUrl: string | null } | null>` in `lib/queries/menu.ts`. Returns `null` when the item has no managed product. `unitKey` is the item unit option whose factor equals the recipe line's `unitFactor` (use `itemUnitOptions` from `lib/services/inventory.ts`). `imageUrl` comes via `getStorage().url(imageKey)`, as `getPosMenu`'s image map does.

- [ ] **Step 1: Write failing tests** in `tests/integration/item-sale.test.ts`. Use `createWorld`, `createItem` (`tests/integration/helpers/fixtures.ts`) and `withRollback`. For the sale tests, copy the setup pattern of `tests/integration/reports.test.ts`: opening stock, `openShift`, `saveOrder`, `payOrder`.

  | Test | Expectation |
  |---|---|
  | `enabling creates a POS product at the price` | water item (`pcs`) → `setItemSale(owner, id, { enabled: true, price: "0.75", categoryId: null, unitKey: "base" })`. `getPosMenu(owner)` has a product named like the item, one variant `"Each"` at `"0.75"`. |
  | `deducts the unit factor` | item `ml` with packaging `bottle` = 1000, sold per `iu:<bottleId>`, plus a latte product. Pay one order with 1 latte and 1 water. The water's sale movement has `qtyBase = "-1000.0000"` at the item's average cost, and the latte's recipe is also deducted. |
  | `switching off hides it and keeps history` | enable, sell once, `enabled: false`. `getPosMenu` no longer lists it, and the past order line still exists. |
  | `off then on reuses the product` | enable, disable, enable. Exactly one product has this `sourceItemId`, with the same id each time. |
  | `name clash is a clear error` | an existing product "Water" plus item "Water" → enabling rejects with `ConflictError` (message contains `already exists`). |
  | `saveProduct refuses a managed product` | `saveProduct(owner, productId, …)` rejects with `Edit this from its inventory item.`. |
  | `photo upload still works` | `uploadProductImage(owner, productId, JPG, storage)` succeeds (copy the image setup from `tests/integration/menu-images.test.ts`), and `getItemSale` returns a non-null `imageUrl`. |
  | `needs menu.manage` | a cashier ctx → rejects with `ForbiddenError`. |
  | `other org's item is refused` | a random uuid → `NotFoundError`. |
  | `inactive item can't be enabled` | an item with `isActive = false` → `ValidationError`. |
  | `getItemSale reads back the settings` | it returns `enabled`, `price`, `categoryId` and `unitKey: "iu:<bottleId>"` as saved. |

- [ ] **Step 2: Run** `pnpm exec vitest run --project integration tests/integration/item-sale.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Add the schema column and index, then run `pnpm db:generate --name item_sale` to create `drizzle/0020_item_sale.sql`.
- [ ] **Step 4: Refactor** `saveProduct` into `upsertProduct` plus the guard, as described under Interfaces. `upsertProduct` writes `sourceItemId` from `extra` on insert and never clears it. Existing menu tests must still pass.
- [ ] **Step 5: Implement `setItemSale`.**
  - `requirePermission(ctx, ctx.branchId, "menu.manage")`, then parse `itemSaleInput`.
  - In `inTransaction`:
    - load and lock the item with `loadItem(tx, ctx, itemId, true)`;
    - refuse an inactive item when `enabled`;
    - find the product where `sourceItemId = item.id` (lock it), and its active variant id;
    - call `upsertProduct` with name = item name, kitchen station `none`, `deductStock: true`, `isActive: enabled`, no modifier groups, and one variant `{ id: existingVariantId, name: "Each", price, isDefault: true, deductStock: null, recipe: [{ itemId, unitKey, qty: "1" }] }`. Pass `{ sourceItemId: item.id }`.
    - `writeAudit` with `item.sale`.
- [ ] **Step 6: Implement `getItemSale`.**
- [ ] **Step 7: Run** the new tests plus `pnpm exec vitest run --project integration tests/integration/menu.test.ts tests/integration/menu-images.test.ts`. Expected: all PASS. Then `pnpm typecheck`.
- [ ] **Step 8: Commit** `feat(menu): item-managed POS products for sellable stock items`.

### Task 2: Keep the managed product in step with its item

**Files:**
- Modify: `lib/services/inventory.ts` (`updateItem`).
- Test: `tests/integration/item-sale.test.ts` (add tests).

**Interfaces:**
- Consumes: `products.sourceItemId` (Task 1).

- [ ] **Step 1: Write failing tests:**
  - `renaming the item renames its product`: after `updateItem` with a new name, the managed product has that name.
  - `rename clash refuses`: with product "Cola" existing, renaming a sellable item to "Cola" rejects with `ConflictError`, and the item keeps its old name.
  - `deactivating the item hides its product`: after `updateItem` with `isActive: false`, the managed product is inactive.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Update `updateItem`.**
  - Inside its transaction, if a managed product exists and the name changed, check for a duplicate case-insensitively, excluding the managed product itself. If one exists, throw `ConflictError(\`A product named "<name>" already exists.\`)`. Otherwise update the product name.
  - If `isActive` becomes false, set the product `isActive = false`.
- [ ] **Step 4: Run** the file plus `tests/integration/inventory-services.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(inventory): keep item-managed products in sync with their item`.

### Task 3: Sell on POS card, actions and menu badge

**Files:**
- Create: `components/inventory/item-sale-card.tsx` (client).
- Modify:
  - `app/[locale]/(app)/inventory/actions.ts` (add `setItemSaleAction`);
  - `app/[locale]/(app)/inventory/items/[id]/page.tsx`;
  - `lib/queries/menu.ts` (`listProducts` adds `fromItemId`);
  - `app/[locale]/(app)/menu/products/products-table.tsx` (badge);
  - `app/[locale]/(app)/menu/products/[id]/page.tsx` (managed: show a notice linking to the item instead of the form);
  - `messages/en.json`, `messages/km.json`.
- Test:
  - `tests/unit/messages.test.ts` (parity, existing);
  - `tests/integration/permission-matrix.test.ts` (add a case);
  - `tests/e2e/item-sale.spec.ts`.

**Interfaces:**
- Consumes: `setItemSale`, `getItemSale`, `ItemSaleInput` (Task 1); `ProductImageCard({ productId, imageUrl, canEdit })` from `components/menu/product-extras.tsx`.
- Produces: `setItemSaleAction(itemId: string, input: ItemSaleInput): Promise<ActionResult<{ productId: string }>>`. It wraps `setItemSale`, then calls `revalidatePath("/[locale]/(app)/inventory", "layout")` and `revalidatePath("/[locale]/pos", "page")`. The i18n guard test checks both patterns.

- [ ] **Step 1: Write failing tests.**
  - Add a permission-matrix case `{ name: "make an item sellable", needs: ["menu.manage"], run: (f) => setItemSaleAction(f.item.id, { enabled: true, price: "1.00", categoryId: null, unitKey: "base" }) }`.
  - Create `tests/e2e/item-sale.spec.ts`. It signs in, opens the seeded "Fresh Milk" item page (`tests/e2e/global-setup.ts`), turns on Sell on POS at price 1.50 per base unit and saves. It opens `/en/pos`, opens a shift if asked, taps the "Fresh Milk" tile, pays exactly, and checks that the cart total showed `$1.50`.
  - A second E2E test: signed in as a user without `menu.manage`, the item page has no element with text from `ItemSale.title`. Create the user in that spec's own setup with `insertAuthUser` and the Cashier role, or skip it if the e2e seed has no cashier; the permission-matrix case already covers the server side.
- [ ] **Step 2: Run** `pnpm exec vitest run --project integration tests/integration/permission-matrix.test.ts` and `pnpm exec playwright test tests/e2e/item-sale.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `setItemSaleAction`.**
- [ ] **Step 4: Build the item page card.** The page loads `getItemSale` and the menu categories (`listMenuCategories`). `ItemSaleCard` renders only when `hasPermission(ctx, ctx.branchId, "menu.manage")`. It contains:
  - a shadcn `Switch` (enabled);
  - a price `Input`;
  - a category `Select` (with a "No category" option);
  - a sold-per `Select` from the item's unit options (base, global and packaging; the page already has `item.units` and `item.baseUnit`);
  - Save, showing `toast` success or error.
  - When `getItemSale` returned a product, `ProductImageCard` is shown below with `canEdit`.
  - All text uses `useTranslations("ItemSale")`: title, description, enabled, price, category, noCategory, unit, save, saved, photoHint.
- [ ] **Step 5: Add the menu side.**
  - `listProducts` selects `fromItemId: products.sourceItemId`.
  - The table shows `<Badge variant="secondary">From inventory item</Badge>` when set. Keep the badge English, like its neighbours on this untranslated page.
  - The product page for a managed product shows a short notice with a `Link` to `/inventory/items/<id>` instead of `ProductForm`. Branch prices and the image card stay.
- [ ] **Step 6: Run** the permission matrix, the i18n guard, `messages.test.ts`, `pnpm typecheck`, `pnpm lint` and the new E2E. Expected: all PASS.
- [ ] **Step 7: Commit** `feat(inventory): Sell on POS card with price, unit and photo`.

### Task 4: Verification

- [ ] **Step 1: Run** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:int` and `pnpm test:e2e`, then `pnpm build`. If the stale `.next/dev/types` breaks the build, move it aside and restore it afterwards. Expected: all PASS. The known flaky `pos.test.ts` "exchange rate" test may fail once; rerun it alone.
- [ ] **Step 2: Run** `pnpm db:migrate` on the dev database, so the owner's `cafe_pos` gets the new column.
- [ ] **Step 3:** Report the summary: files changed and test results.
