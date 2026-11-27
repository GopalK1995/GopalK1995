// One rule for "this is a QA persona, not a customer's colleague". Live member lists hide them; nothing is deleted or changed in the database.
// A persona is a plus-addressed mailbox (name+role@host) whose display name starts with "Test ". Both must hold, so a real person called "Test" or a real
// plus-address is never hidden. The signed-in user is never hidden from themselves.
const TEST_NAME = /^test\b/i;
export const isTestAccount = (m: { name?: string | null; email?: string | null }): boolean => {
  const local = (m.email ?? "").split("@")[0] ?? "";
  return TEST_NAME.test((m.name ?? "").trim()) && local.includes("+");
};
export const withoutTestAccounts = <T extends { name?: string | null; email?: string | null; userId?: string }>(xs: T[], selfId?: string): T[] =>
  xs.filter((m) => !isTestAccount(m) || (selfId !== undefined && m.userId === selfId));
