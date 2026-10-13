import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SUPPORT_COOKIE, WS_COOKIE, verifySession, verifySupport } from "./lib/auth/session";
import { HOME_FOR, ROLE_LABEL, accessFor } from "./lib/auth/roles";
import { resolveActive } from "./lib/auth/context";
import { WS_MAX_AGE, cookieOpts } from "./lib/auth/cookies";

const PUBLIC = ["/login", "/admin/login"];

export async function middleware(req: NextRequest) {
  const { pathname, search, searchParams } = req.nextUrl;
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const isAdminPath = pathname === "/admin" || pathname.startsWith("/admin/");
  const forbid = (page: string, role = "") => {
    const url = new URL("/forbidden", req.url); url.searchParams.set("page", page); if (role) url.searchParams.set("role", role);
    return NextResponse.rewrite(url);
  };

  if (PUBLIC.includes(pathname)) {
    if (session && pathname === "/login" && !session.platformAdmin) return NextResponse.redirect(new URL("/", req.url));
    if (session && pathname === "/admin/login" && session.platformAdmin) return NextResponse.redirect(new URL("/admin", req.url));
    return NextResponse.next();
  }
  if (!session) {
    const url = new URL(isAdminPath ? "/admin/login" : "/login", req.url);
    if (pathname !== "/" && pathname !== "/admin") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  if (isAdminPath) return session.platformAdmin ? NextResponse.next() : forbid("/admin");
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
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/|api/|icon|favicon|.*\\.(?:png|svg|jpg|ico|woff2?)$).*)"] };
