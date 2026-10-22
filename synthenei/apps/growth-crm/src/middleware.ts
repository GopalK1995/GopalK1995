import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SUPPORT_COOKIE, WS_COOKIE, signSession, verifySession, verifySupport } from "./lib/auth/session";
const ADMIN_IDLE_MS = 30 * 60e3;
import { HOME_FOR, ROLE_LABEL, accessFor } from "./lib/auth/roles";
import { resolveActive } from "./lib/auth/context";
import { WS_MAX_AGE, cookieOpts } from "./lib/auth/cookies";
import { moduleForPath } from "./lib/vertical";
import { cfgCookieName, decodeCfgCookie } from "./lib/config/cookie-codec";
import { resolveEffective } from "./lib/config/resolve-pure";

const PUBLIC = ["/login", "/admin/login"];

export async function middleware(req: NextRequest) {
  const { pathname, search, searchParams } = req.nextUrl;
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const isAdminPath = pathname === "/admin" || pathname.startsWith("/admin/");
  // RSC requests (Link prefetch / client navigation) to a route this role cannot open get an empty 204: no payload
  // and no browser console error. A non-RSC response makes the router fall back to a full load, which then
  // renders the 403 page.
  // Next strips the RSC/_rsc markers before middleware; router fetches still carry `next-url` and are not documents.
  const isPrefetch = req.headers.has("next-url") && req.headers.get("sec-fetch-dest") !== "document";
  const forbid = (page: string, role = "") => {
    if (isPrefetch) return new NextResponse(null, { status: 204 });
    const url = new URL("/forbidden", req.url); url.searchParams.set("page", page); if (role) url.searchParams.set("role", role);
    return NextResponse.rewrite(url, { status: 403 });
  };

  const isClientLink = pathname.startsWith("/g/");
  if (PUBLIC.includes(pathname) || isClientLink) {
    if (session && (pathname === "/login" || isClientLink) && !session.platformAdmin) return NextResponse.redirect(new URL("/", req.url));
    if (session && pathname === "/admin/login" && session.platformAdmin) return NextResponse.redirect(new URL("/admin", req.url));
    return NextResponse.next();
  }
  if (!session) {
    const url = new URL(isAdminPath ? "/admin/login" : "/login", req.url);
    if (pathname !== "/" && pathname !== "/admin") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  // Platform admins: 30-minute idle timeout, sliding (each request re-signs the session).
  if (session.platformAdmin) {
    if (Date.now() - session.iat > ADMIN_IDLE_MS) {
      const res = NextResponse.redirect(new URL("/admin/login?error=idle", req.url));
      res.cookies.delete(SESSION_COOKIE); res.cookies.delete(SUPPORT_COOKIE);
      return res;
    }
  }
  const touch = async (res: NextResponse) => {
    if (session.platformAdmin) res.cookies.set(SESSION_COOKIE, await signSession({ ...session, iat: Date.now() }), cookieOpts(60 * 60 * 12));
    return res;
  };
  if (isAdminPath) return session.platformAdmin ? touch(NextResponse.next()) : forbid("/admin");
  if (pathname === "/forbidden") return NextResponse.next();

  // Deep link with ?ws=: switch if member, 403 otherwise.
  const wsParam = searchParams.get("ws");
  if (wsParam && !session.platformAdmin) {
    if (!session.memberships.some((m) => m.ws === wsParam)) return forbid("/workspace");
    const clean = new URL(req.url); clean.searchParams.delete("ws");
    const res = NextResponse.redirect(clean);
    res.cookies.set(WS_COOKIE, wsParam, cookieOpts(WS_MAX_AGE));
    return res;
  }

  const support = session.platformAdmin ? await verifySupport(req.cookies.get(SUPPORT_COOKIE)?.value) : null;
  const active = resolveActive(session, req.cookies.get(WS_COOKIE)?.value, support);
  if (!active) return NextResponse.redirect(new URL(session.platformAdmin ? "/admin" : "/login?error=no_profile", req.url));
  if (pathname === "/" && HOME_FOR[active.role] !== "/") return NextResponse.redirect(new URL(HOME_FOR[active.role], req.url));
  if (!accessFor(active.role, pathname)) return forbid(pathname, ROLE_LABEL[active.role]);
  // Module switches (tenant config) are enforced here, server-side, as well as hidden in the nav.
  const mod = moduleForPath(pathname);
  // Demo sessions keep config in a signed cookie, which the edge can read; real sessions are checked in requireActive().
  const cfgCookie = mod && session.demo ? await decodeCfgCookie(active.tenant.id, req.cookies.get(cfgCookieName(active.tenant.id))?.value) : null;
  if (mod && resolveEffective(active.tenant.id, cfgCookie?.ovr).modules[mod] === false) {
    if (isPrefetch) return new NextResponse(null, { status: 204 });
    const url = new URL("/forbidden", req.url); url.searchParams.set("page", pathname); url.searchParams.set("off", "1");
    return NextResponse.rewrite(url, { status: 403 });
  }
  // Pass the path to server components (requireActive uses it for the module guard).
  const fwd = new Headers(req.headers); fwd.set("x-pathname", pathname);
  return touch(NextResponse.next({ request: { headers: fwd } }));
}

export const config = { matcher: ["/((?!_next/|api/|icon|favicon|.*\\.(?:png|svg|jpg|ico|woff2?)$).*)"] };
