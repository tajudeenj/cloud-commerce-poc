"use server";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { audit } from "@/lib/audit";
import { clientIp, createSession, currentUser, destroySession, hashPassword, verifyPassword } from "@/lib/auth";
import { rateLimit, rateLimitBlocked, rateLimitHit } from "@/lib/rate-limit";
import { runAction, str, type FormState } from "@/lib/action";

/** Only allow same-site relative redirects (prevents open-redirect via ?next=). */
function safeNext(n: string, fallback: string) {
  return /^\/(?!\/)[\w\-/?=&.%]*$/.test(n) ? n : fallback;
}

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email").max(254);
const passwordSchema = z.string().min(10, "Password must be at least 10 characters").max(128)
  .regex(/[A-Z]/, "Password needs an uppercase letter").regex(/[a-z]/, "Password needs a lowercase letter").regex(/\d/, "Password needs a number");

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAction(async () => {
    const email = emailSchema.parse(str(fd, "email"));
    const password = z.string().min(1).max(128).parse(str(fd, "password"));
    const ip = await clientIp();
    const WINDOW = 15 * 60_000;
    // Only failed attempts count, per IP and per account (credential-stuffing and brute-force protection).
    if (rateLimitBlocked(`login:ip:${ip}`, 30, WINDOW) || rateLimitBlocked(`login:email:${email}`, 8, WINDOW)) {
      return { error: "Too many attempts. Please wait a few minutes and try again." };
    }
    const user = await db().query.users.findFirst({ where: sql`lower(${schema.users.email}) = ${email}` });
    const ok = await verifyPassword(user?.passwordHash ?? null, password);
    if (!user || !ok || user.disabled) {
      rateLimitHit(`login:ip:${ip}`, WINDOW);
      rateLimitHit(`login:email:${email}`, WINDOW);
      await audit({ actorId: user?.id ?? null, ip, action: "auth.login_failed", entity: "user", data: { email } });
      return { error: "Invalid email or password." };
    }
    await createSession(user.id);
    await audit({ actorId: user.id, ip, action: "auth.login", entity: "user", entityId: user.id });
    redirect(safeNext(str(fd, "next"), user.role === "admin" ? "/admin" : "/portal"));
  });
}

export async function registerAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAction(async () => {
    const ip = await clientIp();
    if (!rateLimit(`register:${ip}`, 10, 60 * 60_000).ok) return { error: "Too many sign-ups from this network. Try later." };
    const input = z.object({
      name: z.string().trim().min(2, "Enter your full name").max(100),
      email: emailSchema,
      password: passwordSchema,
    }).parse({ name: str(fd, "name"), email: str(fd, "email"), password: str(fd, "password") });
    const exists = await db().query.users.findFirst({ where: sql`lower(${schema.users.email}) = ${input.email}` });
    if (exists) return { error: "An account with this email already exists. Please sign in." };
    const [user] = await db().insert(schema.users).values({
      email: input.email, name: input.name, passwordHash: await hashPassword(input.password),
    }).returning();
    await audit({ actorId: user!.id, ip, action: "auth.registered", entity: "user", entityId: user!.id });
    await createSession(user!.id);
    redirect(safeNext(str(fd, "next"), "/portal"));
  });
}

export async function logoutAction() {
  const u = await currentUser();
  await destroySession();
  if (u) await audit({ actorId: u.id, impersonatorId: u.impersonatorId, action: "auth.logout", entity: "user", entityId: u.id });
  redirect("/");
}

export async function stopImpersonationAction() {
  const u = await currentUser();
  if (!u?.impersonatorId) redirect("/");
  const admin = await db().query.users.findFirst({ where: and(eq(schema.users.id, u.impersonatorId), eq(schema.users.role, "admin")) });
  await destroySession();
  if (!admin) redirect("/login");
  await createSession(admin.id);
  await audit({ actorId: admin.id, action: "auth.impersonation_ended", entity: "user", entityId: u.id, ip: await clientIp() });
  redirect("/admin/customers");
}
