# Sell stock items on the POS — design

Date: 2026-11-23. Status: approach A approved by the owner; this document awaits approval.

## Intent

A café sells two kinds of things in the same order: things it makes (coffee, food) and things it simply resells, such as a 500 ml bottle of water. Resold items must come off stock when they are sold. That already works when an item is wrapped in a product whose recipe is "1 of this item", but every such product has to be created and priced by hand, apart from the item. The owner wants to make an item sellable from the item itself, with a switch for sellable or not.

## Goals

- On an inventory item's page, a **Sell on POS** section has:
  - a switch (on = sellable);
  - a selling price (USD);
  - a menu category (where it appears on the POS);
  - the unit it is sold in (base unit or one of the item's packaging units).
- When the switch is on, the item appears on the POS like any product. One tap adds it to the order, at that price, next to coffee and food in the same order.
- Selling it deducts stock at the item's average cost. A refund with restock puts it back. Reports, shifts and receipts treat it like any product.
- A sellable item can have a **photo**, uploaded from the same Sell on POS section. It shows on its POS tile like product photos do.
- When the switch is off, the item disappears from the POS. Past orders and reports are unchanged.

## Non-goals

- No change to the POS screen, the order, payment or refund code, or the reports.
- No modifiers, variants or kitchen tickets for sellable items. The cashier taps and it's added.
- No per-branch price overrides from the item page. The existing branch price screen on the menu side still works for the linked product.

## Anti-goals (a failure even if it works)

- A sold item that does not deduct stock, or deducts the wrong amount (for example 1 ml instead of 1 bottle).
- Two places to change the same price, with the POS showing a stale one.
- Losing sales history when an item is made unsellable or deactivated.

## Approaches considered

- **A. A switch and price on the item; the system keeps a hidden one-item product in sync (chosen).** The POS, orders, stock deduction, cost, refunds and reports already work for products, so nothing on the selling side changes. The cost is a little linking code.
- **B. The POS sells items directly.** This needs a second path through orders, payments, refunds, kitchen tickets and every report. Much bigger and riskier, and no better for the cashier. Rejected.
- **C. A one-off "create product" shortcut on the item page.** Smallest, but the price and on/off then live on the product, so there are two places to manage. Rejected.

## Design

**Data.** `products` gains `source_item_id uuid null`, with a foreign key to `items.id` and a unique index (`products_source_item_uq`, partial: where not null). A product with `source_item_id` set is *item-managed*. Migration `drizzle/0020_*`, add-only, backward compatible.

**The managed product:**
- Name: the item's name. Menu category: the one chosen.
- `kitchen_station = "none"`, `deduct_stock = true`.
- One variant, named "Each", at the chosen price, `is_default = true`.
- Its recipe is one line: the item, with qty = 1 × the chosen unit's factor in base units. For example, a bottle of 1,000 ml gives 1000; `pcs` gives 1.
- On = `is_active = true`; off = `is_active = false`. The product is never deleted.

**Service** in `lib/services/menu.ts` (or a new `lib/services/item-sale.ts`): `setItemSale(ctx, itemId, input)`.
- Input: `{ enabled: boolean; price: string; categoryId: string | null; unitKey: string }`, validated with Zod. Price is ≥ 0 with at most 4 decimals; `unitKey` uses the existing `base` / `g:<code>` / `iu:<id>` convention from `lib/domain/units.ts`.
- Requires `menu.manage`, because prices are menu data. Runs in one transaction:
  - lock the item;
  - create or update its managed product, variant and recipe;
  - write an audit entry (`item.sale`) with before and after.
- Enabling a deactivated item is refused.
- Turning it on when another product already has the same name raises the existing "a product with this name exists" conflict as a validation error. The owner then renames one.

**Keeping it in sync:**
- Renaming an item (`updateItem`) also renames its managed product.
- Deactivating an item also deactivates its managed product.
- Saving a managed product through the normal menu product form (`saveProduct`) is refused with "Edit this from its inventory item", so the price lives in one place.
- The menu product list shows a "From inventory item" badge, linking to the item.
- Branch prices and availability (`setBranchVariantPrice`) stay allowed for managed products.

**UI.** The item page (`app/[locale]/(app)/inventory/items/[id]`) gets a "Sell on POS" card, shown only to users with `menu.manage`. It has the switch, price, menu category select, sold-per unit select, and Save.

**Photo.** Once the item has its managed product (first enabled), the card also shows the existing `ProductImageCard` (`components/menu/product-extras.tsx`) for that product.
- It reuses the existing upload and remove actions and the `uploadProductImage` / `removeProductImage` services (`lib/services/menu-images.ts`, `menu.manage`, max 2 MB). No new storage code is needed.
- The photo lives on the managed product (`products.image_key`), so the POS shows it without changes.
- The `saveProduct` guard must not block image actions. They go through `setProductImageKey`, which stays allowed for managed products.
- Turning selling off keeps the photo for when it's turned back on. New text goes into `messages/en.json` and `messages/km.json` under a new `ItemSale` namespace. The rest of the item page stays as it is today, untranslated.

**Reads.** `getPosMenu` needs no change, because managed products are ordinary active products. The item page reads the current settings: the managed product's active flag, price, category, and the unit taken from the recipe qty.

## Verification

- **Integration tests:**
  1. Enabling an item creates a product the POS menu returns at the right price.
  2. A mixed order (a latte plus a sellable item) paid on the POS deducts the item by the unit factor at average cost, plus the latte's recipe.
  3. Turning it off hides it from the POS menu and keeps past orders.
  4. Renaming the item renames the product.
  5. `saveProduct` on a managed product is refused.
  6. A user without `menu.manage` is refused.
  7. Uploading a photo for an item's managed product succeeds, and the POS menu returns it in its image map; the `saveProduct` guard doesn't block it.
  8. A wrong-branch or other-org item is refused.
- Unit, lint, typecheck and build stay green.
- E2E: an optional short test. Enable water, sell it on the POS, and check its stock went down by 1.

## Left to the builder

- Exact file split (service in `menu.ts` vs `item-sale.ts`), component structure, and message key names.

## Coordination

The UI redesign session's changes are uncommitted in the same working tree, and they touch `messages/en.json`, `messages/km.json` and shared UI components. Commit the redesign, and the pending login fix, before building this feature on a branch, so the two don't mix.
