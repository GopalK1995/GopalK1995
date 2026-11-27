import { describe, expect, it } from "vitest";
import { isTestAccount, withoutTestAccounts } from "../test-accounts";

const m = (name: string, email: string, userId = "u") => ({ name, email, userId });
describe("test account rule", () => {
  it("hides plus-addressed personas named Test ...", () => {
    expect(isTestAccount(m("Test Sales Rep", "gkrish1012+rep@gmail.com"))).toBe(true);
    expect(isTestAccount(m("Test Data", "gkrish1012+data@gmail.com"))).toBe(true);
  });
  it("keeps real people, a plain Test name, and a real plus-address", () => {
    expect(isTestAccount(m("Krishna (Owner)", "gkrish510@gmail.com"))).toBe(false);
    expect(isTestAccount(m("Test Kumar", "kumar@firm.in"))).toBe(false);
    expect(isTestAccount(m("Asha", "asha+crm@firm.in"))).toBe(false);
  });
  it("never hides the signed-in user from themselves", () => {
    const xs = [m("Test Viewer", "a+v@x.in", "me"), m("Test Rep", "a+r@x.in", "other"), m("Real", "r@x.in", "r")];
    expect(withoutTestAccounts(xs, "me").map((x) => x.userId)).toEqual(["me", "r"]);
    expect(withoutTestAccounts(xs).map((x) => x.userId)).toEqual(["r"]);
  });
});
