// Flat config. Guards (T002): tenant slug literals, hex colours, service_role.
// LEGACY_* lists are the files that violated a guard when it was introduced; they are reported as warnings
// so the debt stays visible. Owning tasks must clean the file and delete it from the list.
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const SLUG = "/(lawsome|kaveri|shola)/i";
const HEX = "/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i";

const slugRule = () => ({
  selector: `:matches(Literal[value=${SLUG}], TemplateElement[value.raw=${SLUG}])`,
  message: "Tenant slug literals (lawsome|kaveri|shola) are only allowed in src/lib/demo/** and src/lib/data/mock/**.",
});
const hexRule = {
  selector: `Literal[value=${HEX}]`,
  message: "Hex colours are not allowed here; use design tokens (CSS variables / Tailwind classes).",
};
const serviceRule = {
  selector: ":matches(Literal[value=/service_role|SUPABASE_SERVICE_ROLE_KEY/], TemplateElement[value.raw=/service_role|SUPABASE_SERVICE_ROLE_KEY/])",
  message: "service_role may only be referenced in src/lib/db/service.ts.",
};
const syntax = (level, ...rules) => [level, ...rules.map(({ selector, message }) => ({ selector, message }))];

const LEGACY_SLUG = [
  "src/app/(app)/accounts/_components/firm.ts",
  "src/app/(app)/inbox/page.tsx",
  "src/app/(app)/integrations/_components/meta.ts",
  "src/app/(app)/leads/_lib/sales.ts",
  "src/app/admin/**/_components/config-tab.tsx",
  "src/app/admin/_components/data.ts",
  "src/app/layout.tsx",
  "src/app/login/page.tsx",
  "src/components/shell/providers.tsx",
  "src/lib/auth/actions.ts",
  "src/lib/data/types.ts",
  "src/lib/support-log.ts",
  "src/lib/tenancy.ts",
  "src/lib/vertical.ts",
];
const LEGACY_HEX = ["src/app/admin/_components/support-form.tsx", "src/app/layout.tsx"];

const config = [
  { ignores: [".next*/**", "node_modules/**", "coverage/**", "preview/**", ".cfgtest/**", "cypress/downloads/**", "next-env.d.ts", "eslint.config.mjs"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Pre-existing violations in app code (T002 may not edit it): reported as warnings, owners fix them.
      "react-hooks/rules-of-hooks": "warn",
      "react/no-unescaped-entities": "warn",
      "@next/next/no-html-link-for-pages": "warn",
    },
  },
  // Guard: tenant slugs everywhere except demo/mock.
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs}"],
    ignores: ["src/lib/demo/**", "src/lib/data/mock/**", "src/**/__tests__/**", "src/test/**", "cypress/**", "scripts/**", "supabase/**"],
    rules: { "no-restricted-syntax": syntax("error", slugRule()) },
  },
  // Guard: hex colours in components and app (slug + hex both apply here).
  {
    files: ["src/components/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"],
    ignores: ["src/**/__tests__/**"],
    rules: { "no-restricted-syntax": syntax("error", slugRule(), hexRule, serviceRule) },
  },
  // Guard: service_role everywhere in src except the single allowed module.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/db/service.ts", "src/components/**", "src/app/**", "src/lib/demo/**", "src/lib/data/mock/**", "src/**/__tests__/**", "src/test/**"],
    rules: { "no-restricted-syntax": syntax("error", slugRule(), serviceRule) },
  },
  {
    files: ["src/lib/demo/**", "src/lib/data/mock/**"],
    rules: { "no-restricted-syntax": syntax("error", serviceRule) },
  },
  // Legacy debt: warn only (see header).
  {
    files: LEGACY_SLUG,
    rules: { "no-restricted-syntax": syntax("warn", slugRule(), serviceRule) },
  },
  {
    files: LEGACY_HEX,
    rules: { "no-restricted-syntax": syntax("warn", slugRule(), hexRule, serviceRule) },
  },
  // Cypress files use chai-style expressions.
  {
    files: ["cypress/**/*.{ts,tsx}"],
    rules: { "@typescript-eslint/no-unused-expressions": "off", "@typescript-eslint/no-namespace": "off" },
  },
];

export default config;
