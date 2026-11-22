import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { audit } from "@/lib/audit";
import { DomainError } from "./catalog";
import type { Actor } from "./orders";

type Priority = "low" | "medium" | "high" | "critical";

export async function createTicket(actor: Actor, input: { subject: string; body: string; subscriptionId?: string | null; priority: Priority }) {
  return db().transaction(async (tx) => {
    if (input.subscriptionId) {
      const s = await tx.query.subscriptions.findFirst({ where: and(eq(schema.subscriptions.id, input.subscriptionId), eq(schema.subscriptions.userId, actor.userId)) });
      if (!s) throw new DomainError("Service not found");
    }
    const [t] = await tx.insert(schema.tickets).values({
      userId: actor.userId, subscriptionId: input.subscriptionId ?? null, subject: input.subject, priority: input.priority,
    }).returning();
    await tx.insert(schema.ticketMessages).values({ ticketId: t!.id, authorId: actor.userId, isStaff: false, body: input.body });
    await audit({ actorId: actor.userId, impersonatorId: actor.impersonatorId, ip: actor.ip, action: "ticket.created", entity: "ticket", entityId: t!.id }, tx);
    return t!;
  });
}

/** Loads a ticket the actor may see: owner, or staff. */
export async function getTicket(ticketId: string, viewer: { userId: string; isStaff: boolean }) {
  const t = await db().query.tickets.findFirst({ where: eq(schema.tickets.id, ticketId) });
  if (!t || (!viewer.isStaff && t.userId !== viewer.userId)) return null;
  const messages = await db().select({
    id: schema.ticketMessages.id, body: schema.ticketMessages.body, isStaff: schema.ticketMessages.isStaff,
    createdAt: schema.ticketMessages.createdAt, author: schema.users.name,
  }).from(schema.ticketMessages).innerJoin(schema.users, eq(schema.users.id, schema.ticketMessages.authorId))
    .where(eq(schema.ticketMessages.ticketId, t.id)).orderBy(schema.ticketMessages.createdAt);
  const customer = await db().query.users.findFirst({ where: eq(schema.users.id, t.userId), columns: { name: true, email: true } });
  return { ...t, messages, customer };
}

export async function replyTicket(actor: Actor & { isStaff: boolean }, ticketId: string, body: string) {
  await db().transaction(async (tx) => {
    const [t] = await tx.select().from(schema.tickets).where(eq(schema.tickets.id, ticketId)).for("update");
    if (!t || (!actor.isStaff && t.userId !== actor.userId)) throw new DomainError("Ticket not found", "not_found");
    await tx.insert(schema.ticketMessages).values({ ticketId, authorId: actor.userId, isStaff: actor.isStaff, body });
    await tx.update(schema.tickets).set({ status: actor.isStaff ? "answered" : "customer_reply", updatedAt: new Date(), closedAt: null })
      .where(eq(schema.tickets.id, ticketId));
    await audit({ actorId: actor.userId, impersonatorId: actor.impersonatorId, ip: actor.ip, action: "ticket.replied", entity: "ticket", entityId: ticketId, data: { staff: actor.isStaff } }, tx);
  });
}

export async function closeTicket(actor: Actor & { isStaff: boolean }, ticketId: string) {
  const where = actor.isStaff ? eq(schema.tickets.id, ticketId) : and(eq(schema.tickets.id, ticketId), eq(schema.tickets.userId, actor.userId));
  const res = await db().update(schema.tickets).set({ status: "closed", closedAt: new Date(), updatedAt: new Date() }).where(where).returning({ id: schema.tickets.id });
  if (!res.length) throw new DomainError("Ticket not found", "not_found");
  await audit({ actorId: actor.userId, impersonatorId: actor.impersonatorId, ip: actor.ip, action: "ticket.closed", entity: "ticket", entityId: ticketId });
}

export async function listTickets(filter: { userId?: string; status?: string }, limit = 100) {
  const conds = [];
  if (filter.userId) conds.push(eq(schema.tickets.userId, filter.userId));
  if (filter.status && filter.status !== "all") conds.push(eq(schema.tickets.status, filter.status as never));
  return db().select({
    id: schema.tickets.id, number: schema.tickets.number, subject: schema.tickets.subject, status: schema.tickets.status,
    priority: schema.tickets.priority, updatedAt: schema.tickets.updatedAt, customer: schema.users.email,
  }).from(schema.tickets).innerJoin(schema.users, eq(schema.users.id, schema.tickets.userId))
    .where(conds.length ? and(...conds) : undefined).orderBy(desc(schema.tickets.updatedAt)).limit(limit);
}
