// Showcase gateway: deterministic, in memory, no network, no real keys. Used in demo mode and when the stored key secret is the
// documented mock value (never in production, see config.ts). The UI labels every connection on it "Showcase".
import { RazorpayApiError, type AccountProbe, type CreateLinkInput, type CreateOrderInput, type LinkResult, type OrderResult, type RazorpayGateway, type RefundInfo } from "./gateway";

export const RZP_MOCK_KEY_ID = "rzp_test_mockshowcase";
export const RZP_MOCK_KEY_SECRET = "rzp-mock-secret";

export interface MockRazorpay extends RazorpayGateway {
  readonly links: (CreateLinkInput & { id: string; cancelled: boolean })[];
  readonly orders: (CreateOrderInput & { id: string })[];
  /** Test hook: the next create call throws a vendor error with this HTTP status. */
  failNext(httpStatus: number): void;
}

export function makeMockGateway(): MockRazorpay {
  const links: MockRazorpay["links"] = [], orders: MockRazorpay["orders"] = [];
  let n = 0, failure: number | null = null;
  const guard = (): void => {
    if (failure === null) return;
    const s = failure; failure = null;
    throw new RazorpayApiError("BAD_REQUEST_ERROR", `Razorpay API error ${s}`, s, s >= 500 ? "server" : "bad_request", s >= 500);
  };
  return {
    kind: "mock", links, orders,
    failNext(s) { failure = s; },
    async probe(): Promise<AccountProbe> { return { ok: true, mode: "test" }; },
    async createPaymentLink(i): Promise<LinkResult> {
      guard();
      // like the vendor: a reference id is single use
      if (links.some((l) => l.referenceId === i.referenceId)) throw new RazorpayApiError("BAD_REQUEST_ERROR", "Razorpay API error BAD_REQUEST_ERROR", 400, "bad_request", false);
      const id = `plink_MOCK${String(++n).padStart(6, "0")}`;
      links.push({ ...i, id, cancelled: false });
      return { id, shortUrl: `mock://pay/${id}`, status: "created" };
    },
    async cancelPaymentLink(id) { const l = links.find((x) => x.id === id); if (l) l.cancelled = true; },
    async createOrder(i): Promise<OrderResult> { guard(); const id = `order_MOCK${String(++n).padStart(6, "0")}`; orders.push({ ...i, id }); return { id, status: "created" }; },
    async listRefunds(): Promise<RefundInfo[]> { return []; },
  };
}
