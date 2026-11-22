import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { hash, verify } from "@node-rs/argon2";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { hmacSha256, randomToken } from "@/lib/crypto";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IMPERSONATION_TTL_MS = 30 * 60 * 1000;
// OWASP-recommended argon2id parameters (m=19 MiB, t=2, p=1).
const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export type SessionUser = {
  id: string; email: string; name: string; role: "customer" | "admin";
  impersonatorId: string | null; impersonatorName: string | null;
};

export function cookieName() {
  // __Host- prefix binds the cookie to this exact host over HTTPS (no Domain, Path=/).
  return env().COOKIE_SECURE ? "__Host-sid" : "sid";
}

const tokenHash = (token: string) => hmacSha256(env().SESSION_SECRET, token);

export async function hashPassword(pw: string) {
  return hash(pw, ARGON);
}

// Pre-computed hash so unknown-email logins cost the same as wrong-password logins (no user enumeration by timing).
let dummyHash: Promise<string> | undefined;
export async function verifyPassword(stored: string | null, pw: string) {
  if (!stored) {
    await verify(await (dummyHash ??= hash("timing-equaliser", ARGON)), pw).catch(() => false);
    return false;
  }
  return verify(stored, pw).catch(() => false);
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim().slice(0, 64);
}

export async function createSession(userId: string, impersonatorId: string | null = null) {
  const token = randomToken(32);
  const ttl = impersonatorId ? IMPERSONATION_TTL_MS : SESSION_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);
  await db().insert(schema.sessions).values({ idHash: tokenHash(token), userId, impersonatorId, expiresAt });
  const jar = await cookies();
  jar.set(cookieName(), token, {
    httpOnly: true, secure: env().COOKIE_SECURE, sameSite: "lax", path: "/", expires: expiresAt,
  });
  // Opportunistic cleanup of expired sessions (cheap, indexed).
  void db().delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date())).catch(() => undefined);
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(cookieName())?.value;
  if (token) await db().delete(schema.sessions).where(eq(schema.sessions.idHash, tokenHash(token)));
  jar.delete(cookieName());
}

/** Resolves the current user once per request (React cache). */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(cookieName())?.value;
  if (!token || token.length > 128) return null;
  const imp = sql<string | null>`(select name from users u2 where u2.id = ${schema.sessions.impersonatorId})`;
  const rows = await db()
    .select({
      id: schema.users.id, email: schema.users.email, name: schema.users.name, role: schema.users.role,
      disabled: schema.users.disabled, impersonatorId: schema.sessions.impersonatorId, impersonatorName: imp,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.idHash, tokenHash(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  const r = rows[0];
  if (!r || r.disabled) return null;
  return { id: r.id, email: r.email, name: r.name, role: r.role, impersonatorId: r.impersonatorId, impersonatorName: r.impersonatorName };
});

export async function requireUser(next = "/portal"): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) redirect(`/login?next=${encodeURIComponent(next)}`);
  return u;
}

export async function requireAdmin(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) redirect("/login?next=/admin");
  if (u.role !== "admin") redirect("/portal");
  return u;
}
