import { describe, expect, it } from "vitest";
import { idInput, replayInput } from "../schemas";

describe("demo endpoint ids", () => {
  it("accepts demo-1 and demo-12 and uuids, rejects junk", () => {
    expect(idInput.safeParse({ id: "demo-1" }).success).toBe(true);
    expect(idInput.safeParse({ id: "demo-12" }).success).toBe(true);
    expect(idInput.safeParse({ id: "00000000-0000-4000-8000-000000000000" }).success).toBe(true);
    expect(idInput.safeParse({ id: "demo-d" }).success).toBe(false);
    expect(idInput.safeParse({ id: "demo-1234" }).success).toBe(false);
    expect(replayInput.safeParse({ endpointId: "demo-1", deliveryId: 3 }).success).toBe(true);
  });
});
