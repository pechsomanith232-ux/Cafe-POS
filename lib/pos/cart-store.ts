"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Discount } from "@/lib/domain/pricing";
import type { OrderDetail } from "@/lib/queries/pos";

// POS cart (plan §6). Lives in the browser until it is saved (Hold / Send to
// kitchen); the server recalculates every total on save. Kept in
// sessionStorage so an accidental refresh doesn't lose the cart.

export type CartModifier = { id: string; groupId: string; name: string; priceDelta: string };
export type CartLineState = {
  key: string;
  id?: string;
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  unitPrice: string;
  qty: number;
  modifiers: CartModifier[];
  note: string;
  discount: (NonNullable<Discount> & { reason?: string | null }) | null;
  /** Sent to the kitchen: locked until Phase 6 (line void with PIN). */
  sent: boolean;
};

type CartState = {
  /** "branchId:userId" the cart belongs to; a different branch or user starts empty. */
  owner: string | null;
  orderId: string | null;
  orderNo: string | null;
  queueNo: number | null;
  orderType: "dine_in" | "takeaway";
  tableId: string | null;
  note: string;
  orderDiscount: (NonNullable<Discount> & { reason?: string | null }) | null;
  lines: CartLineState[];
  add: (line: Omit<CartLineState, "key" | "sent">) => void;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  setLineDiscount: (key: string, d: CartState["orderDiscount"]) => void;
  setOrderDiscount: (d: CartState["orderDiscount"]) => void;
  setOrderType: (t: CartState["orderType"]) => void;
  setTable: (id: string | null) => void;
  setNote: (note: string) => void;
  load: (order: OrderDetail) => void;
  clear: () => void;
  claim: (owner: string) => void;
};

let seq = 0;
const key = () => `l${Date.now().toString(36)}${++seq}`;
const empty = { owner: null as string | null, orderId: null, orderNo: null, queueNo: null, orderType: "takeaway" as const, tableId: null, note: "", orderDiscount: null, lines: [] };

const sameLine = (a: Omit<CartLineState, "key" | "sent">, b: CartLineState) =>
  !b.sent && !b.discount && !a.discount && a.variantId === b.variantId && a.note === b.note && a.unitPrice === b.unitPrice
  && a.modifiers.map((m) => m.id).sort().join() === b.modifiers.map((m) => m.id).sort().join();

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      ...empty,
      // Same item with the same options and no discount/note → bump the quantity.
      add: (line) => set((s) => {
        const i = s.lines.findIndex((l) => sameLine(line, l));
        if (i >= 0) return { lines: s.lines.map((l, j) => (j === i ? { ...l, qty: Math.min(999, l.qty + line.qty) } : l)) };
        return { lines: [...s.lines, { ...line, key: key(), sent: false }] };
      }),
      setQty: (k, qty) => set((s) => ({ lines: s.lines.map((l) => (l.key === k && !l.sent ? { ...l, qty: Math.max(1, Math.min(999, qty)) } : l)) })),
      remove: (k) => set((s) => ({ lines: s.lines.filter((l) => l.key !== k || l.sent) })),
      setLineDiscount: (k, d) => set((s) => ({ lines: s.lines.map((l) => (l.key === k && !l.sent ? { ...l, discount: d } : l)) })),
      setOrderDiscount: (d) => set({ orderDiscount: d }),
      setOrderType: (t) => set((s) => ({ orderType: t, tableId: t === "takeaway" ? null : s.tableId })),
      setTable: (id) => set({ tableId: id }),
      setNote: (note) => set({ note }),
      load: (o) => set({
        orderId: o.id, orderNo: o.orderNo, queueNo: o.queueNo, orderType: o.orderType as CartState["orderType"], tableId: o.tableId, note: o.note ?? "",
        orderDiscount: o.discountType ? { type: o.discountType as "percent" | "amount", value: o.discountValue!, reason: o.discountReason } : null,
        lines: o.lines.map((l) => ({
          key: l.id, id: l.id, variantId: l.variantId, productId: l.productId, productName: l.productName, variantName: l.variantName,
          unitPrice: l.unitPrice, qty: l.qty, note: l.note ?? "", discount: l.discount, sent: l.sent,
          modifiers: l.modifiers.map((m) => ({ id: m.modifierId, groupId: m.groupId, name: m.name, priceDelta: m.priceDelta })),
        })),
      }),
      clear: () => set((s) => ({ ...empty, owner: s.owner })),
      claim: (owner) => set((s) => (s.owner === owner ? s : { ...empty, owner })),
    }),
    {
      name: "pos-cart",
      storage: createJSONStorage(() => sessionStorage),
      skipHydration: true,
      partialize: (s) => ({ owner: s.owner, orderId: s.orderId, orderNo: s.orderNo, queueNo: s.queueNo, orderType: s.orderType, tableId: s.tableId, note: s.note, orderDiscount: s.orderDiscount, lines: s.lines }),
    },
  ),
);

/** The cart as saveOrder input. */
export function cartToInput(s: Pick<CartState, "orderId" | "orderType" | "tableId" | "note" | "orderDiscount" | "lines">, branchId: string, registerId: string) {
  return {
    id: s.orderId, branchId, registerId, orderType: s.orderType, tableId: s.orderType === "dine_in" ? s.tableId : null, note: s.note || null,
    orderDiscount: s.orderDiscount,
    lines: s.lines.map((l) => ({ id: l.id, variantId: l.variantId, qty: l.qty, modifierIds: l.modifiers.map((m) => m.id), note: l.note || null, discount: l.discount })),
  };
}
