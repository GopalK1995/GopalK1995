# MFA and password policy (AUD-029)

## What the app now does
- **MFA (TOTP) is required** for: owner, sales_manager, and any role whose grants include a manage, export or admin permission (today that also covers `data`). Sales reps, marketing and viewer stay optional. Platform admins are always required (unchanged).
- After password sign-in, a required user with **no verified factor** is sent to `/auth/mfa?enrol=1` (QR code plus 6-digit confirmation). A user **with** a factor must reach AAL2 before the app cookie is issued. Existing 12-hour cookies are re-checked at the next session refresh (`/auth/refresh`).
- The enrolment page works with the password session alone, so an owner who has no factor yet is never locked out; they enrol and continue. Abandoned (unverified) factors are replaced.
- **Per-tenant setting** (optional) at `tenant_config.config.security`:
  `{ "mfa": "privileged" | "all", "mfaGraceUntil": "YYYY-MM-DD" }`. `all` requires every member. The grace date lets privileged users who have no factor yet sign in until that date (capped at 30 days ahead; later dates are ignored). Users who already have a factor are always challenged. Without the setting the default is `privileged`, strict, no grace. A failed lookup keeps the default.
- Write the setting through the existing config path (owner via tenant_config RLS, platform admin via `admin_set_tenant_config`); the `security` block is accepted by the config validator. No migration is needed.

## Passwords (NIST SP 800-63B)
- Minimum **12** characters (Unicode code points), no composition rules, spaces and any unicode allowed, maximum 72 bytes (Supabase/bcrypt limit; a 64-character passphrase passes).
- Rejected: entries on a local common/breached list and trivial variants (case, leet speak, trailing digits or symbols, repeats, keyboard runs), and passwords containing the account's own e-mail name. All local; no outbound lookups (no HaveIBeenPwned call).
- Applied on set-password, which is the single landing for invite acceptance and password reset. The page shows the length message and a live character count.

## Owner actions (not done by code)
1. **Supabase dashboard -> Authentication -> Providers/Policies (Password security):** switch on **Leaked password protection** (HaveIBeenPwned), set **Minimum password length to 12**, and leave required characters empty. This also covers any path that bypasses the app. Advisor `auth_leaked_password_protection` should then clear. (Leaked-password protection is a Pro-plan feature.)
2. **Supabase dashboard -> Authentication -> MFA:** confirm TOTP enrolment and verification are enabled.
3. Before deploy, have the owner ready with an authenticator app; on first sign-in after deploy the owner is routed to enrolment. If you want a softer rollout, set `security.mfaGraceUntil` first.
4. Existing passwords are not forced to change; the policy applies the next time someone sets or resets a password.

## Not covered
- Passkeys (WebAuthn) as an alternative factor; recovery codes; step-up (AAL2) re-prompts inside individual sensitive server actions. Follow-ups.
