import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge proxy: per-request CSP nonce (Next.js applies it to its own scripts) and an anonymous
 * visitor id for funnel analytics. No auth decisions here — those are enforced server-side per route.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");

  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);

  let newVid: string | undefined;
  if (!request.cookies.get("vid")) {
    newVid = crypto.randomUUID();
    const existing = headers.get("cookie");
    headers.set("cookie", existing ? `${existing}; vid=${newVid}` : `vid=${newVid}`);
  }

  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", csp);
  if (newVid) res.cookies.set("vid", newVid, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  return res;
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico|api/health).*)" }],
};
