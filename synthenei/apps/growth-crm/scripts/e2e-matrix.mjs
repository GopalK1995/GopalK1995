#!/usr/bin/env node
// L2 end-to-end matrix: personas x routes x widths against a running `next start`.
// Usage (from apps/growth-crm):
//   npm run build && PORT=3201 npx next start -p 3201 &   # production build, not dev
//   node scripts/e2e-matrix.mjs                            # BASE, OUT, WIDTHS, PERSONAS, SHOTS=0 to override
// Output: preview/l2/results.json + a pass/fail table on stdout; screenshots in preview/l2/<width>/.
// Assertions: HTTP status (200, or 403 where the role has no access), no console errors / page errors,
// no horizontal overflow, no Next.js runtime-error overlay text; plus the support-session flow and a
// workspace switch that must re-theme the app.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "/opt/node22/lib/node_modules/playwright");
const BASE = process.env.BASE ?? "http://localhost:3201";
const OUT = process.env.OUT ?? "preview/l2";
const WIDTHS = (process.env.WIDTHS ?? "1440,768,390").split(",").map(Number);
const HEIGHT = { 1440: 900, 768: 1024, 390: 844 };
const SHOTS = process.env.SHOTS !== "0";

// Mirrors src/lib/auth/roles.ts PAGE_ACCESS (null = 403). Keep in sync.
const R = ["owner", "sales_manager", "sales_rep", "marketing", "data", "viewer"];
const ACCESS = {
  "/": [1, 1, 0, 0, 0, 1], "/sales": [1, 1, 1, 0, 0, 0], "/leads": [1, 1, 1, 1, 1, 1], "/pipeline": [1, 1, 1, 1, 1, 1],
  "/accounts": [1, 1, 1, 1, 1, 1], "/campaigns": [1, 1, 0, 1, 1, 1], "/audience": [1, 1, 0, 1, 1, 1], "/analytics": [1, 1, 0, 1, 1, 1],
  "/inbox": [1, 1, 1, 1, 0, 0], "/tasks": [1, 1, 1, 1, 1, 0], "/ai": [1, 1, 1, 1, 1, 0], "/integrations": [1, 1, 0, 1, 1, 0],
  "/data-health": [1, 1, 0, 0, 1, 0], "/settings": [1, 1, 0, 0, 1, 0], "/profile": [1, 1, 1, 1, 1, 1],
};
const HOME = { owner: "/", sales_manager: "/", viewer: "/", sales_rep: "/sales", marketing: "/campaigns", data: "/data-health" };
const allowed = (role, path) => {
  const key = Object.keys(ACCESS).filter((k) => k === "/" ? path === "/" : path === k || path.startsWith(k + "/")).sort((a, b) => b.length - a.length)[0];
  return key ? !!ACCESS[key][R.indexOf(role)] : false;
};

// Detail ids per workspace dataset (deterministic seed).
const DETAIL = {
  tn: ["/leads/LD-1001", "/accounts/acc-ramanathan-and-associates", "/campaigns/cmp-hearing-day", "/integrations/whatsapp"],
  kaveri: ["/leads/KV-1001", "/accounts/acc-ukkadam-law-chambers", "/campaigns/cmp-kv-meta", "/integrations/whatsapp"],
};
const APP_ROUTES = Object.keys(ACCESS);
const ADMIN_ROUTES = ["/admin", "/admin/tenants", "/admin/tenants/lawsome", "/admin/users", "/admin/audit", "/admin/support?ws=lawsome-tn"];

const PERSONAS = [
  { key: "super", role: null, ds: null },
  { key: "owner-lawsome", role: "owner", ds: "tn" },
  { key: "rep-lawsome", role: "sales_rep", ds: "tn" },
  { key: "mkt-lawsome", role: "marketing", ds: "tn" },
  { key: "viewer-lawsome", role: "viewer", ds: "tn" },
  { key: "owner-kaveri", role: "owner", ds: "kaveri" },
].filter((p) => !process.env.PERSONAS || process.env.PERSONAS.split(",").includes(p.key));

const results = [];
const record = (r) => { results.push(r); if (!r.pass) console.log(`FAIL ${r.persona} ${r.width} ${r.path}: ${r.why}`); };

async function login(page, persona) {
  if (persona.key === "super") {
    await page.goto(`${BASE}/admin/login?step=code`, { waitUntil: "load" });
    await page.fill("input[name=code]", "482915");
    await page.locator("form button[type=submit], form button").last().click();
  } else {
    await page.goto(`${BASE}/login`, { waitUntil: "load" });
    await page.waitForTimeout(400);
    await page.click(`button[data-persona="${persona.key}"]`);
  }
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 60000 });
}

async function visit(page, ctx, persona, width, path, expect) {
  const errors = [];
  const onConsole = (m) => { if (m.type() === "error" && !/caret-color/.test(m.text())) errors.push(m.text().slice(0, 240)); };
  const onPageError = (e) => errors.push(`pageerror: ${e.message}`);
  page.on("console", onConsole); page.on("pageerror", onPageError);
  let status = 0, why = "";
  try {
    const resp = await page.goto(BASE + path, { waitUntil: "load", timeout: 90000 });
    status = resp?.status() ?? 0;
    await page.waitForTimeout(900);
    const { overflow, runtime } = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      runtime: /Unhandled Runtime Error|Application error: a (server|client)-side exception/i.test(document.body.innerText),
    }));
    const okStatus = expect === 403 ? status === 403 : status === 200;
    if (!okStatus) why += `status ${status} (expected ${expect}) `;
    if (overflow > 0) why += `overflow ${overflow}px `;
    if (runtime) why += "runtime error overlay ";
    if (errors.length) why += `console: ${errors[0]}`;
    if (SHOTS) {
      const dir = `${OUT}/${width}`; mkdirSync(dir, { recursive: true });
      const name = `${persona.key}${path.replace(/[/?=&]+/g, "_") || "_root"}`;
      await page.screenshot({ path: `${dir}/${name}.png`, fullPage: width === 1440 });
    }
  } catch (e) { why += `exception ${String(e.message).slice(0, 160)}`; }
  page.off("console", onConsole); page.off("pageerror", onPageError);
  record({ persona: persona.key, width, path, status, expect, pass: !why, why: why.trim() });
}

async function supportFlow(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const step = (name, pass, why = "") => record({ persona: "super", width: 1440, path: `[support] ${name}`, status: 0, expect: 0, pass, why });
  try {
    await login(page, { key: "super" });
    const before = await page.goto(`${BASE}/leads`, { waitUntil: "load" });
    step("no business data without a session", !page.url().includes("/leads") || before?.status() === 403, `landed on ${page.url()}`);
    await page.goto(`${BASE}/admin/support?ws=lawsome-tn`, { waitUntil: "load" });
    await page.fill("textarea[name=reason], input[name=reason]", "Owner reported LinkedIn CSV import rejecting rows, ticket SUP-131");
    await page.locator("form:has([name=reason]) button[type=submit], form:has([name=reason]) button").last().click();
    await page.waitForURL((u) => !u.pathname.startsWith("/admin"), { timeout: 60000 });
    const banner = await page.getByText(/Support session by/).first().isVisible().catch(() => false);
    step("amber banner visible", banner);
    await page.goto(`${BASE}/leads`, { waitUntil: "load" });
    const exportBtn = page.getByRole("button", { name: /export/i }).first();
    const exportState = (await exportBtn.count()) ? await exportBtn.isDisabled() : true;
    step("export disabled during support", exportState);
    await page.goto(`${BASE}/settings`, { waitUntil: "load" });
    if (SHOTS) { mkdirSync(`${OUT}/1440`, { recursive: true }); await page.screenshot({ path: `${OUT}/1440/support-session-settings.png`, fullPage: true }); }
    await page.getByRole("button", { name: /End now/ }).first().click();
    await page.waitForURL((u) => u.pathname.startsWith("/admin"), { timeout: 60000 });
    step("End now returns to /admin", true);
  } catch (e) { step("flow", false, String(e.message).slice(0, 200)); }
  await ctx.close();
}

async function switchRetheme(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const hue = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--brand-h").trim());
  try {
    await login(page, { key: "mkt-lawsome" });
    const h1 = await hue();
    await page.locator("[data-testid=ws-switcher]:visible").first().click();
    if (SHOTS) { mkdirSync(`${OUT}/1440`, { recursive: true }); await page.screenshot({ path: `${OUT}/1440/switcher-open-mkt.png` }); }
    await page.click('[data-ws="kaveri-cbe"]');
    await page.waitForLoadState("load"); await page.waitForTimeout(1500);
    const h2 = await hue();
    if (SHOTS) await page.screenshot({ path: `${OUT}/1440/after-switch-kaveri.png`, fullPage: true });
    record({ persona: "mkt-lawsome", width: 1440, path: "[switch] lawsome-tn -> kaveri-cbe re-themes", status: 0, expect: 0, pass: h1 !== h2 && h2 === "178", why: `hue ${h1} -> ${h2}` });
  } catch (e) { record({ persona: "mkt-lawsome", width: 1440, path: "[switch]", status: 0, expect: 0, pass: false, why: String(e.message).slice(0, 200) }); }
  await ctx.close();
}

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
mkdirSync(OUT, { recursive: true });
for (const width of WIDTHS) {
  for (const persona of PERSONAS) {
    const ctx = await browser.newContext({ viewport: { width, height: HEIGHT[width] ?? 900 }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    try { await login(page, persona); } catch (e) { record({ persona: persona.key, width, path: "[login]", status: 0, expect: 0, pass: false, why: String(e.message).slice(0, 200) }); await ctx.close(); continue; }
    if (persona.key === "super") {
      for (const p of ADMIN_ROUTES) await visit(page, ctx, persona, width, p, 200);
    } else {
      for (const p of [...APP_ROUTES, ...DETAIL[persona.ds]]) {
        const target = p === "/" ? HOME[persona.role] : p; // "/" redirects to the role home
        await visit(page, ctx, persona, width, target, allowed(persona.role, target) ? 200 : 403);
      }
      await visit(page, ctx, persona, width, "/admin", 403); // tenant users never reach the admin console
    }
    await ctx.close();
  }
}
await supportFlow(browser);
await switchRetheme(browser);
await browser.close();

writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
const fails = results.filter((r) => !r.pass);
console.table(results.map((r) => ({ persona: r.persona, w: r.width, path: r.path, status: r.status, ok: r.pass ? "PASS" : "FAIL" })));
console.log(`\n${results.length - fails.length}/${results.length} passed. ${fails.length} failed. Results: ${OUT}/results.json`);
process.exit(fails.length ? 1 : 0);
