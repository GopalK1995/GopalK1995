import { defineConfig } from "cypress";
import react from "@vitejs/plugin-react";
import path from "node:path";

const baseUrl = process.env.CYPRESS_BASE_URL ?? "http://localhost:3202";

export default defineConfig({
  // Read by cy.loginReal via Cypress.expose(); values come from the shell, never from files.
  expose: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    PROD_SUPABASE_REF: process.env.PROD_SUPABASE_REF ?? "evybdanqxgkjoybrvzru",
    ALLOW_PROD: process.env.CYPRESS_ALLOW_PROD ?? "",
  },
  e2e: {
    baseUrl,
    specPattern: "cypress/e2e/**/*.cy.ts",
    supportFile: "cypress/support/e2e.ts",
    video: false,
    screenshotOnRunFailure: true,
    defaultCommandTimeout: 10000,
    pageLoadTimeout: 90000,
  },
  component: {
    specPattern: ["cypress/component/**/*.cy.{ts,tsx}", "cypress/support/ct/**/*.cy.{ts,tsx}"],
    supportFile: "cypress/support/component.ts",
    indexHtmlFile: "cypress/support/component-index.html",
    video: false,
    devServer: { framework: "react", bundler: "vite", viteConfig: { plugins: [react()], resolve: { alias: { "@": path.resolve(__dirname, "src") } } } },
  },
});
