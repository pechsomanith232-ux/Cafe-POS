# Café POS — business logic and how to use it

This document explains **what the system does and why** (the business rules), and then **how to do each job** in the app. It is written for the team: developers, testers, and the people who will run the café.

- Short staff cheat-sheet: [user-guide.md](user-guide.md)
- Full technical spec: [../plan.md](../plan.md)
- Server setup: [deploy-coolify.md](deploy-coolify.md), [operations.md](operations.md), [restore.md](restore.md)

---

## Part 1 — The ideas behind the system

### 1.1 What the system is for

A café sells drinks and food made from ingredients. The owner wants to know three things at any time:

1. **How much did we sell, and how much profit did we make?**
2. **How much stock do we have, and what is it worth?**
3. **Who owes whom?** (what we owe suppliers, what customers owe us)

The system answers all three from the same records, so the numbers always agree with each other.

### 1.2 Five rules that never bend

| Rule | What it means in practice |
|---|---|
| **Stock history is never edited** | Every stock change is a new line in a ledger (a "movement"). A mistake is fixed with another movement, never by changing an old one. The database itself refuses edits and deletes. |
| **The server does the maths** | The till shows totals, but the server recalculates every price, discount, tax and total before saving. A tampered browser can't change a price. |
| **Sensitive actions need a reason and leave a trace** | Voids, refunds, big discounts, stock adjustments, price changes and cash differences are written to the **audit log** with who, when, why and who approved. |
| **Every branch is separate** | Stock, shifts, orders, exchange rates and price overrides belong to one branch. Staff only see the branches they are assigned to. |
| **History keeps its own prices** | An order stores the price and cost as they were at the time of sale. Changing a price or recipe later never changes old orders or old reports. |

### 1.3 Words used in this document

- **Item** — something you keep in stock: milk, beans, cups, bottled water.
- **Product** — something you sell: Latte, Croissant.
- **Variant** — a size or version of a product: Latte *Regular*, Latte *Large*.
- **Modifier** — an option added to a product: *Oat milk*, *Extra shot*.
- **Recipe** — the list of items (and how much of each) that one variant or modifier uses.
- **Movement** — one line in the stock ledger: stock in or stock out.
- **Shift** — one cashier's working session on one register, from opening the drawer to counting it.
- **Base unit** — the smallest unit an item is counted in: `ml`, `g` or `pcs`.

---

## Part 2 — Business rules, with examples

### 2.1 Units of measure

Every item has **one base unit** and can have extra packaging units.

> **Fresh Milk**: base unit `ml`. Packaging: `bottle = 1,000 ml`, `case = 12,000 ml`.

- You can **buy, count and adjust** in any unit of the item ("2 case").
- The system **always stores** the quantity in the base unit (24,000 ml), and also remembers what you typed.
- On screen, large quantities are shown in a readable way: 30,500 ml → "2 case 6 bottle 500 ml".

### 2.2 Stock cost: weighted average cost (WAC)

Each item has an **average cost per base unit, per branch**. It changes only when stock comes **in** with a cost.

```
if nothing on hand:   new average = cost of the incoming stock
otherwise:            new average = (on hand × old average + qty in × cost in) ÷ (on hand + qty in)
```

Stock going **out** (sale, waste, transfer out) is always valued at the **current average**. That value is the **cost of goods sold (COGS)** used in the profit report.

**Worked example (milk, in ml):**

| Step | What happened | Qty | Cost per ml | On hand | Average cost per ml |
|---|---|---|---|---|---|
| 1 | Buy 1 case for $18.00 | +12,000 | 0.0015 | 12,000 | 0.001500 |
| 2 | Sell a latte (uses 200 ml) | −200 | 0.0015 | 11,800 | 0.001500 |
| 3 | Buy 1 case for $21.00 | +12,000 | 0.00175 | 23,800 | **0.001626** |
| 4 | Throw away 800 ml (waste) | −800 | 0.001626 | 23,000 | 0.001626 |

Step 3: (11,800 × 0.0015 + 12,000 × 0.00175) ÷ 23,800 = 38.70 ÷ 23,800 = 0.001626.

Other cost rules:

- A **transfer in** from another branch arrives at the sending branch's average cost.
- A **refund that puts stock back** returns it at the cost of the original sale.
- A **positive adjustment without a cost** uses the current average, so the average doesn't move.
- **Negative stock is allowed** by default: a café can't refuse a sale because the system thinks the milk ran out. The till shows a warning and reports flag it. An owner can switch this off per branch (Settings → POS).

### 2.3 Recipes and automatic stock deduction

When an order is **paid**, the system deducts ingredients:

```
for each order line:  (variant recipe + recipes of the chosen modifiers) × quantity
```

- A modifier's recipe can have **negative lines** for swaps. *Oat milk* = `+180 ml oat milk` and `−180 ml fresh milk`.
- Things you buy and resell (bottled water) use a one-line recipe: `1 pcs` of that item.
- A product **without a recipe** is sold normally; nothing is deducted.
- Stock is deducted at **payment**, not when the order is saved, held or sent to the kitchen.
- Changing a recipe only affects **future** sales.

**Switching deduction off.** Sometimes you don't want to track stock for something (hot water, a free refill):

| Level | Setting | Effect |
|---|---|---|
| Product | *Deduct stock on sale* switch | Off = no variant of this product deducts stock |
| Variant | *Follow product / Yes / No* | Overrides the product for this one size |
| Modifier | Switch per option | Off = this option's recipe is ignored |

If a line doesn't deduct, the system still records what it **would** have cost (recipe × current average), marked as *theoretical* cost, so the profit report stays meaningful. The setting is saved on each order line, so changing it later doesn't affect past orders or their refunds.

### 2.4 Money: USD and riel together

- All prices and totals are in **USD** (the base currency).
- Each branch has its own **exchange rate** for riel (default 4,100 per USD), and the history of rates is kept.
- The till shows the total in both. The riel total is rounded to the **nearest 100 riel**.
- One order can be paid with **several payments** in different methods and currencies.
- The cashier chooses which currency the **change** is given in.

**Example 1 — change in riel.** Total $4.75, rate 4,100. The customer pays $5 and wants change in riel.
Change = $0.25 = 1,025 riel → rounded to **1,000 riel**. The small rounding difference is recorded, so the drawer still balances.

**Example 2 — split payment.** Total $10.00. The customer pays $5 cash and 20,500 riel (= $5.00). Paid in full, no change.

Payment methods (set per branch): Cash, KHQR, Card, Bank transfer, Charge to account. KHQR and card are recorded manually with a reference; the system does not talk to the bank.

### 2.5 Discounts

- A discount can be on **one line** or on the **whole order**, as a **percent** or a **fixed amount**, with a reason.
- Each role has a **maximum percent** it may give on its own. Defaults: Cashier 10%, Manager 50%, Owner and Admin 100%.
- **Above your limit**, the till asks for a **manager PIN**.
- An order-level discount is spread across the lines in proportion to their value, so "profit by product" stays correct.

### 2.6 Tax

Off by default (rate 0). Per branch you can set a rate (for example VAT 10%) and whether menu prices **already include** tax or tax is **added on top**. The tax amount is stored on every line and order.

### 2.7 Life of an order

```
open ──Hold──► held ──Resume──► open
open ──Pay in full──► paid ──Refund──► partially refunded / refunded
open or held ──Void (manager PIN)──► voided
```

| Action | When | Stock | Needs |
|---|---|---|---|
| **Hold** | Customer isn't ready to pay | No change | — |
| **Send to kitchen** | Start preparing before payment | No change | — |
| **Pay** | Normal sale | **Ingredients deducted** | An open shift |
| **Void** | Cancel **before** payment | No change (nothing was deducted) | Manager PIN + reason |
| **Refund** | Give money back **after** payment | Optional restock, per line | Manager PIN + reason |

- **You can't sell without an open shift.**
- Order numbers run per branch per day: `B1-20261108-0042`. The last part is also the **queue number** called out to the customer.
- A refund can be **full or partial** (choose lines and quantities), paid back in any method and currency. Cash refunds are rounded to what can physically be paid.
- **Restock on refund** is ticked by default only for simple resale items (an unopened bottle of water). A prepared drink is not put back in stock, because the ingredients are already used.

### 2.8 Shifts and the cash drawer

1. **Open**: the cashier counts the drawer and enters the opening float in each currency.
2. **During the shift**: sales, refunds, and **cash in / cash out** (always with a reason).
3. **Close**: the cashier counts the drawer again.

```
expected cash = opening float + cash received − change given − cash refunds
                + cash in − cash out + cash payments from account customers
difference    = counted − expected          (per currency)
```

- A difference **above the threshold** (default $1.00) needs a **reason** and a **manager PIN**.
- An order that is still open blocks closing: pay it, hold it (it moves to the next shift) or void it.
- **X report** = the numbers so far, shift still open. **Z report** = the final numbers at close.

### 2.9 Buying stock

There are two ways to buy.

**A. On credit (the supplier sends an invoice).**

1. Enter a **goods receipt**: supplier, invoice number, date, payment terms (days), and the lines.
2. Extra costs (delivery) are **shared across the lines by value** before the cost is calculated. This is the *landed cost*.
3. **Post** it. Stock goes up, average cost updates, and the receipt becomes money you **owe**, with a due date.
4. Later, record a **supplier payment**. It is applied to the oldest unpaid invoices first (you can change that). Paying part of an invoice is fine: status goes *unpaid → partial → paid*.
5. Paying more than you owe leaves a **credit** with that supplier for next time.

> **Example.** 2 cases of milk at $18 + $2 delivery → landed cost $38 for 24,000 ml = $0.001583 per ml.
> A $50 invoice paid $20 then $30 goes *partial*, then *paid*.

**B. Direct purchase (pay on the spot, for example at the market).**

- Supplier is optional; you can just type "Central Market".
- **Post & Pay** in one step: stock goes up and the receipt is marked paid immediately.
- Tick **Paid from the drawer** if the cash came from the till. The system then records a cash-out on the open shift, so the drawer count still matches.
- Direct purchases never appear in "what we owe".

**After posting, a receipt can't be edited.** To send goods back, record a **supplier return**: stock goes down at the cost it came in at, and you get a credit (or, for a direct purchase, a refund).

**AP aging** shows what you owe each supplier, grouped by how late it is: *Current, 1–30, 31–60, 61–90, 90+ days overdue*.

### 2.10 Customers on account

- Give a customer a **credit limit**. Staff with permission can then choose **Charge to account** at payment.
- A charge that would push the customer **over the limit** is refused.
- Record **customer payments** later; they clear the oldest charges first.
- **AR aging** shows who owes you, in the same buckets as suppliers.

### 2.11 More than one branch

- One organization, many branches. **Menu and items are shared**; stock, prices overrides, shifts and orders are per branch.
- A branch can have its **own price** for a variant, or mark it **unavailable**.
- A user can work at several branches with a **different role in each**. The branch switcher is at the top of the sidebar.
- Owners, admins and accountants can run reports for **All branches**.

**Stock transfers** move stock between branches: *draft → sent → received*.
Stock leaves the sender at its average cost. The receiver confirms what actually arrived; anything missing is recorded as **transfer loss**. Value is conserved: *value sent = value received + loss*.

### 2.12 Low stock, adjustments and counts

- **Reorder level**: per item per branch. Below it, the item appears in the low-stock list, the dashboard and the sidebar badge. *Suggested reorder* adds the last supplier and last cost.
- **Stock adjustment**: for waste, damage, expired goods, staff meals or corrections. Draft first, then **post**. Reason required.
- **Stock count**: the system takes a snapshot of what it thinks you have, you enter what is really on the shelf (in any unit), and posting writes the differences as movements.

### 2.13 Who can do what

Access is a **role per branch**. Each role is a set of permissions, editable under Settings → Roles (the Owner role is locked).

| Role | Can do (defaults) |
|---|---|
| **Owner / Admin** | Everything |
| **Manager** | Sell, approve voids/refunds/discounts/cash differences, stock, menu, purchasing and paying suppliers, customers, reports, audit log. Not settings, users or roles |
| **Cashier** | Sell, hold, discount up to 10%, open and close shifts, cash in/out |
| **Barista / Kitchen** | Sell, hold, kitchen screen |
| **Stock Keeper** | Items, adjustments, counts, transfers, receiving goods, direct purchases, stock reports |
| **Accountant** | Pay suppliers, customers and their payments, all financial reports (all branches), audit log |

Two layers protect every action: the menu **hides** what you can't do, and the server **checks again** when you try.

**Manager PIN.** Approvals use a 4–6 digit PIN, separate from the password. The approver picks their name and types their PIN on the cashier's screen. After **5 wrong PINs in 5 minutes**, approvals for that person are locked until the 5 minutes pass.

There is **no public sign-up**. Accounts are created by someone with the *users.manage* permission.

---

## Part 3 — How to use it

### 3.1 First-time setup (owner)

Do these once, in this order. Each step depends on the one before.

1. **Sign in** with the owner account, then **My account** → change the password and set your **manager PIN**.
2. **Settings → Branches** → rename the first branch; add address, receipt header and footer, and tax if you charge it.
3. **Settings → POS** → check the **exchange rate**, payment methods, tables, and the cash-difference threshold.
4. **Settings → Users** → create each staff member, choose their branch and role. Give managers a PIN.
5. **Inventory → Items** → create your items. For each: base unit, packaging units, then **opening stock** (quantity and cost) and a **reorder level**.
6. **Purchasing → Suppliers** → add suppliers and their payment terms.
7. **Menu → Modifiers** → create option groups (Milk, Extras) with their recipes.
8. **Menu → Products** → create products, their variants and prices, attach modifier groups, and fill in each **recipe**. The screen shows cost and margin as you type.

To try the system with realistic data instead, see "Demo data" in the [README](../README.md).

### 3.2 A normal day at the till (cashier)

| Step | Where | What to do |
|---|---|---|
| Start | **POS** | Count the drawer, type the float in USD and riel, **Open shift** |
| Sell | POS | Tap products. Choose size and options if asked. Use **−/+** to change quantity |
| Type of order | Above the cart | Dine-in (pick a table) or takeaway |
| Discount | Cart line → **Discount**, or the order discount | Percent or amount, with a reason. A PIN is asked above your limit |
| Not paying yet | **Hold**, or **Kitchen** | Find held bills under **Orders** |
| Pay | **Pay** (F8) | Pick method and currency → quick-cash button, **Exact**, or type an amount and **Add** → repeat for a split → choose the change currency → **Complete payment** |
| Receipt | After payment | **Print receipt**, then **New order** |
| Cancel before paying | Open the bill → void | Reason + manager PIN |
| Money back after paying | **Menu → Recent orders & refunds → Refund** | Choose items and quantity, restock or not, method, reason, manager PIN |
| Cash in / out | **Menu → Cash in / out** | Amount, currency and a reason |
| Bought something with till cash | **Menu → Quick purchase** | Enter the items, tick *Paid from the drawer* |
| End | **Menu → Close shift** | Count each currency, type it in, give a reason if it's off, print the **Z report** |

Keyboard: **F2** search, **F8** pay, **F9** hold.

### 3.3 Kitchen and bar

Open **Kitchen**. Orders appear within about 3 seconds, with a sound. Filter by station (bar or kitchen). Tap a line to move it:

**pending → preparing → ready → served**

Colour shows how long the customer has waited: green under 5 minutes, amber under 10, red after that.

### 3.4 Stock jobs (stock keeper)

| Job | Where | Steps |
|---|---|---|
| Receive a delivery on credit | Purchasing → Receipts → **New receipt** | Supplier, invoice no., date, terms, lines in any unit, extra costs → **Save draft** or **Post** |
| Market run, paid now | Purchasing → Receipts → Quick purchase | Lines, payment method, *Paid from the drawer* if so → **Post & Pay** |
| Send goods back | Open the posted receipt → **Return to supplier** | Choose lines and quantities, give a reason |
| Waste, damage, staff meal | Inventory → Adjustments → New | Reason, items, quantities (negative = out) → **Post** |
| Stock count | Inventory → Counts → New | Whole branch or one category → enter counted quantities → **Post** |
| Move stock to another branch | Inventory → Transfers → New | Choose the branch and items → **Send**. The other branch opens it and confirms what arrived |
| See what happened to an item | Inventory → Movements | Filter by item, type and date; shows a running balance |
| What to reorder | Sidebar badge, or Reports → Suggested reorder | Items below their reorder level |

### 3.5 Money jobs (manager, accountant)

| Job | Where | Steps |
|---|---|---|
| Pay a supplier | Purchasing → Payments → New | Supplier, amount, method, date. Oldest invoices are selected first; change the split if you want |
| See what we owe | Purchasing → Aging, or Reports → AP aging | Pick an "as of" date; click a supplier for its invoices |
| Supplier history | Suppliers → a supplier | Invoices, payments and running balance |
| Open a customer account | Customers → New | Name, phone, **credit limit** |
| Take a customer payment | Customers → a customer → payment | Amount and method; cash goes into the open shift's drawer |
| See who owes us | Customers → Aging | Same buckets as suppliers |

### 3.6 Reports

Every report has a **branch** filter (or *All* with permission), a **date range**, **CSV export** and a **print** view.

| Question | Report |
|---|---|
| How much did we sell today / this week? | Sales summary (by day and hour) |
| What sells best? | Sales by product / category / variant / modifier |
| How do customers pay? USD or riel? | Sales by payment method & currency |
| How is each cashier doing? | Sales by staff / shift |
| Are we making money? | **Profit / COGS** (net sales − cost = gross profit, margin %) |
| What is our stock worth? | Stock on hand / valuation |
| Where did the milk go? | Stock movement history; Waste & adjustments |
| Are recipes realistic? | Theoretical vs actual usage |
| What do we owe / are we owed? | AP aging, Supplier statement, AR aging, Customer statement |
| Any suspicious voids or refunds? | Void & refund log; Audit log |
| Which branch does better? | Branch comparison |

**How profit is calculated.** Net sales = gross sales − discounts − refunds (tax excluded). COGS = the cost of the sale movements, minus stock put back by refunds. Gross profit = net sales − COGS. Lines that don't deduct stock use their theoretical cost, and the report shows how much of the cost is *actual* and how much is *theoretical*.

### 3.7 When something goes wrong

| Situation | What to do |
|---|---|
| Wrong item rung up, **not paid yet** | Remove the line, or void the bill (manager PIN) |
| Wrong item, **already paid** | Refund that line (manager PIN), then ring up the right one |
| Stock number is wrong | Never edit history. Post an **adjustment** (reason: correction) or do a **count** |
| Posted a receipt with a mistake | Record a **supplier return** for the wrong lines, then enter a new receipt |
| Drawer is short or over | Close the shift with the real count and a reason; above the threshold a manager approves with their PIN |
| Till says "no open shift" | Open a shift on that register first |
| "Discounts need a manager's PIN" | The discount is above your limit; a manager approves |
| PIN locked | Wait 5 minutes |
| Forgot password | Someone with access to Settings → Users resets it |
| Stock shows negative | A sale was allowed without enough stock on record. Receive the missing delivery or post a count |
| Red "You're offline" bar | Nothing can be saved until the connection is back. Don't take payments in the app; note them on paper and enter them after |

---

## Part 4 — For developers: where each rule lives

| Rule | Code |
|---|---|
| Unit conversion and display | `lib/domain/units.ts` |
| Weighted average cost | `lib/domain/wac.ts`, applied in `lib/services/stock.ts` (`applyStockMovement`) |
| Prices, discounts, tax, totals | `lib/domain/pricing.ts`, used by `lib/services/orders.ts` (`saveOrder`) |
| Currency conversion, cash rounding, change | `lib/domain/currency.ts`, `lib/domain/money.ts` |
| Paying, recipe deduction, COGS, void, refund | `lib/services/payments.ts` |
| Shifts and expected cash | `lib/services/shifts.ts`, `lib/services/shift-cash.ts` |
| Goods receipts, landed cost, supplier payments, returns | `lib/services/purchasing.ts`, `lib/domain/landed.ts`, `allocation.ts`, `aging.ts` |
| Adjustments, counts, opening stock | `lib/services/inventory.ts` |
| Transfers | `lib/services/transfers.ts` |
| Customers and AR | `lib/services/customers.ts` |
| Permissions and default roles | `lib/permissions.ts`, `lib/permissions-catalog.ts` |
| Manager PIN and rate limit | `lib/services/pin.ts` |
| Audit log | `lib/services/audit.ts` |
| Reports | `lib/queries/reports/*` |

Every function in `lib/services/` follows the same pattern: check the permission, open **one** database transaction, lock the rows it will change, write the ledger and the audit entry, commit. Screens and server actions never write stock or money directly.

The worked examples in Part 2 are also automated tests (`tests/unit`, `tests/integration`), so if a rule changes, a test fails.
