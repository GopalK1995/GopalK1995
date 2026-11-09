// Payment status machine. payments.status: created | pending | paid | failed | refunded | cancelled.
// Rules: forward only, except that a failed attempt can still be followed by a successful retry on the same link/order, and a
// paid payment can be refunded. Everything else is ignored (late or replayed events never move a payment backwards).
export type PayStatus = "created" | "pending" | "paid" | "failed" | "refunded" | "cancelled";

const NEXT: Record<PayStatus, readonly PayStatus[]> = {
  created: ["pending", "paid", "failed", "cancelled"],
  pending: ["paid", "failed", "cancelled"],
  failed: ["paid", "pending", "cancelled"],
  paid: ["refunded"],
  refunded: [],
  cancelled: [],
};

export const canTransition = (from: PayStatus, to: PayStatus): boolean => from !== to && NEXT[from].includes(to);
export const isPayStatus = (s: unknown): s is PayStatus => typeof s === "string" && s in NEXT;
/** Statuses where money has moved or the link is closed: no new link may be created for the same payment row. */
export const isSettled = (s: PayStatus): boolean => s === "paid" || s === "refunded";
