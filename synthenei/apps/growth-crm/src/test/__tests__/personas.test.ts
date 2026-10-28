import { describe, expect, it } from "vitest";
import { HOME_FOR } from "@/lib/auth/roles";
import type { Role } from "@/lib/data/types";
import { PERSONAS } from "../../../cypress/support/personas";

describe("cypress personas stay in sync with HOME_FOR", () => {
  it("every role persona home equals HOME_FOR[role]", () => {
    for (const [key, p] of Object.entries(PERSONAS)) {
      if (!p.role) continue;
      expect(p.home, key).toBe(HOME_FOR[p.role as Role]);
    }
  });
});
