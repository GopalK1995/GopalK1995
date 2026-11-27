// Password policy aligned to NIST SP 800-63B 5.1.1.2 (AUD-029 / SEC-027): length, no composition rules, a local deny-list check.
//  * minimum 12 characters (counted as Unicode code points), no required letter/digit/symbol mix;
//  * long passphrases and any printable character (spaces, unicode) are accepted up to the bcrypt limit of 72 bytes that
//    Supabase Auth enforces, so a 64-character passphrase always passes;
//  * rejected when it is on the local common/breached list or a trivial variant of it (case, leet speak, trailing digits,
//    repeats, keyboard runs) or when it contains the account's own e-mail name;
//  * no outbound lookups: the check is fully local and pure (edge safe). Supabase's own leaked-password protection is a
//    dashboard toggle and stays an owner action (see docs/security/mfa-and-passwords.md).
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX_BYTES = 72;
export type PasswordProblem = "short" | "long" | "common" | "context" | "mismatch";

/** Whole-password matches (12+ characters, normalised: lower case, leet decoded, separators removed). */
const COMMON_FULL = new Set([
  "passwordpassword", "password1234", "password12345", "password123456", "password1234567", "passw0rd1234", "iloveyou1234", "iloveyou12345",
  "qwertyuiop12", "qwertyuiopas", "qwertyuiop123", "qwertyuiopasdf", "qwertyuiopasdfghjkl", "qwertyuiop1234", "qwertyuiopasdfghjklzxcvbnm",
  "1q2w3e4r5t6y", "1q2w3e4r5t6y7u", "1qaz2wsx3edc", "1qazxsw23edc", "zaq12wsxcde3", "asdfghjklqwer", "asdfghjkl123", "asdfghjkl1234", "zxcvbnmasdfg",
  "123456789012", "1234567890123", "12345678901234", "123456789123", "123123123123", "111111111111", "000000000000", "abcdefghijkl", "abcdefghijklmnop",
  "abcdefg12345", "abc123abc123", "letmein12345", "letmein123456", "welcome12345", "welcome123456", "welcome1234567", "administrator", "administrator1", "administrator123",
  "changeme1234", "changemenow", "changeme12345", "trustno1trustno1", "monkey123456", "dragon123456", "football1234", "baseball1234", "superman1234", "sunshine1234",
  "princess1234", "mustang12345", "shadow123456", "master123456", "michael12345", "jennifer1234", "charlie12345", "freedom12345", "whatever1234", "starwars1234",
  "starwars12345", "batman123456", "pokemon12345", "liverpool1234", "manchester123", "chelsea12345", "arsenal12345", "cricket12345", "bangalore1234", "bangalore123",
  "chennai12345", "mumbai123456", "hyderabad123", "india1234567", "india12345678", "india@123456", "india@1234567", "password@123", "password@1234", "password@12345",
  "password#1234", "password!1234", "admin@123456", "admin@1234567", "admin1234567", "admin12345678", "welcome@12345", "welcome@123456", "test12345678", "testing12345",
  "test@1234567", "guest12345678", "default12345", "secret123456", "private12345", "sachin100100", "krishna12345", "krishna@1234", "ganesh123456", "sairam123456",
  "godisgreat123", "jaishreeram1", "omnamahshivaya", "omnamahshivay", "growthcrm1234", "growthcrm12345", "growth-crm123", "synthan12345", "synthan@1234", "synthancrm1234", "crmcrmcrmcrm",
  "thequickbrownfox", "thequickbrown", "correcthorsebatterystaple", "correcthorse", "iamtheowner123", "mypassword1234", "mypassword123", "mypassword12345", "myp@ssw0rd1234",
  "yourpassword1", "yourpassword12", "newpassword123", "newpassword1234", "newpassword12345", "temp12345678", "temporary1234", "temporary123", "changeit1234",
  "p@ssw0rd1234", "p@ssword1234", "qazwsxedcrfv", "qazwsxedc123", "qwertyasdfgh", "qwerty123456", "qwerty1234567", "qwerty12345678", "qwertyuiop[]", "asdfasdfasdf", "qweqweqweqwe",
]);
/** Stems that make a weak password whatever is added after them (digits, symbols, a short suffix). */
const COMMON_STEMS = [
  "password", "passw0rd", "qwerty", "qwertyuiop", "asdfgh", "zxcvbn", "letmein", "welcome", "iloveyou", "admin", "administrator", "changeme", "trustno1", "abc123",
  "monkey", "dragon", "football", "baseball", "sunshine", "princess", "master", "shadow", "superman", "batman", "starwars", "freedom", "whatever", "login", "secret",
  "synthan", "growthcrm", "welcome1", "test", "testing", "guest", "default", "temporary", "temp", "india", "bangalore", "chennai", "krishna",
];
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };
const KEYBOARD_ROWS = ["qwertyuiopasdfghjklzxcvbnm", "1234567890", "abcdefghijklmnopqrstuvwxyz", "zyxwvutsrqponmlkjihgfedcba", "0987654321", "poiuytrewqlkjhgfdsamnbvcxz"];

/** Lower-case, strip spaces and separators (so "pass word-1234" and "password1234" are one entry). */
const squash = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s_\-.,:;'"`~^*+=|\/]/g, "");
const leetDecode = (s: string) => s.replace(/[013457@$!]/g, (c) => LEET[c] ?? c);
const stripTail = (s: string) => s.replace(/[^a-z]+$/, "");

function isRepeatingUnit(s: string): boolean {
  for (let u = 1; u <= 6 && u * 2 <= s.length; u++) {
    const unit = s.slice(0, u);
    if (unit.repeat(Math.ceil(s.length / u)).slice(0, s.length) === s) return true;
  }
  return false;
}
function isKeyboardRun(s: string): boolean {
  // Almost the whole password is one run along a keyboard row, the alphabet or the digits (forwards or backwards).
  const t = s.replace(/[^a-z0-9]/g, "");
  if (t.length < PASSWORD_MIN - 2) return false;
  return KEYBOARD_ROWS.some((row) => { for (let i = 0; i + 8 <= t.length; i++) { if (row.includes(t.slice(i, i + 8)) && t.length - 8 <= 4) return true; } return false; });
}

/** True when the password is on the local common/breached list or a trivial variant of it. Pure, no network. */
export function isCommonPassword(pw: string): boolean {
  const flat = squash(pw);
  if (!flat) return true;
  if (COMMON_FULL.has(flat) || COMMON_FULL.has(squash(leetDecode(pw)))) return true;
  if (isRepeatingUnit(flat) || isKeyboardRun(flat)) return true;
  const decoded = squash(leetDecode(pw));
  for (const cand of [flat, decoded]) {
    const letters = stripTail(cand);
    // "Password2024!!" style: a known stem plus at most a short tail of digits and symbols. Long passphrases that merely contain a stem stay valid.
    for (const stem of COMMON_STEMS) if (cand.startsWith(stem) && cand.length - stem.length <= 8 && /^[^a-z]*$/.test(cand.slice(stem.length))) return true;
    if (COMMON_STEMS.includes(letters) && cand.length - letters.length <= 8) return true;
    if (COMMON_STEMS.some((s) => cand === s + s || cand === s + s + s)) return true;
  }
  return false;
}

/** Context-specific words (NIST 5.1.1.2): the local part of the user's own e-mail address when it is long enough to matter. */
function containsContext(pw: string, ctx?: { email?: string | null }): boolean {
  const local = squash((ctx?.email ?? "").split("@")[0] ?? "");
  return local.length >= 5 && squash(pw).includes(local);
}

/** Error code for a new password, or null when it is acceptable. Order: length, size, deny-list, context, then confirmation. */
export function passwordProblem(pw: string, confirm?: string, ctx?: { email?: string | null }): PasswordProblem | null {
  if ([...pw].length < PASSWORD_MIN) return "short";
  if (new TextEncoder().encode(pw).length > PASSWORD_MAX_BYTES) return "long";
  if (isCommonPassword(pw)) return "common";
  if (containsContext(pw, ctx)) return "context";
  if (confirm !== undefined && pw !== confirm) return "mismatch";
  return null;
}
