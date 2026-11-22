"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { clientIp, requireUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { runAction, str, uuid, type FormState } from "@/lib/action";
import { changePlan, setAutoRenew, setCancellation } from "@/lib/services/orders";
import { closeTicket, createTicket, replyTicket } from "@/lib/services/tickets";

async function actor() {
  const u = await requireUser();
  return { u, a: { userId: u.id, impersonatorId: u.impersonatorId, ip: await clientIp() } };
}

export async function changePlanAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAction(async () => {
    const { a } = await actor();
    const id = uuid.parse(str(fd, "subscriptionId"));
    const planCode = z.string().regex(/^[A-Z0-9-]{1,40}$/).parse(str(fd, "planCode"));
    const addonCodes = z.array(z.string().regex(/^[A-Z0-9-]{1,40}$/)).max(20).parse(fd.getAll("addon"));
    const key = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).parse(str(fd, "idempotencyKey"));
    const { redirectUrl } = await changePlan(a, id, planCode, addonCodes, key);
    redirect(redirectUrl);
  });
}

export async function cancelAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAction(async () => {
    const { a } = await actor();
    const id = uuid.parse(str(fd, "subscriptionId"));
    const cancel = str(fd, "cancel") === "true";
    await setCancellation(a, id, cancel);
    revalidatePath(`/portal/services/${id}`);
    return { ok: cancel ? "Cancellation scheduled for the end of the current period." : "Cancellation withdrawn — your service will continue." };
  });
}

export async function autoRenewAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAction(async () => {
    const { a } = await actor();
    const id = uuid.parse(str(fd, "subscriptionId"));
    const on = str(fd, "autoRenew") === "true";
    await setAutoRenew(a, id, on);
    revalidatePath(`/portal/services/${id}`);
    return { ok: on ? "Auto-renewal enabled." : "Auto-renewal disabled — the service will end at the period end." };
  });
}

const ticketInput = z.object({
  subject: z.string().trim().min(4, "Subject is too short").max(150),
  body: z.string().trim().min(10, "Please describe the issue (min 10 characters)").max(10_000),
  priority: z.enum(["low", "medium", "high", "critical"]),
  subscriptionId: z.string().uuid().optional().or(z.literal("")),
});

export async function newTicketAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAction(async () => {
    const { u, a } = await actor();
    if (!rateLimit(`ticket:${u.id}`, 10, 60 * 60_000).ok) return { error: "Ticket limit reached — please update an existing ticket." };
    const input = ticketInput.parse({ subject: str(fd, "subject"), body: str(fd, "body"), priority: str(fd, "priority"), subscriptionId: str(fd, "subscriptionId") });
    const t = await createTicket(a, { ...input, subscriptionId: input.subscriptionId || null });
    redirect(`/portal/tickets/${t.id}`);
  });
}

export async function replyTicketAction(_: FormState, fd: FormData): Promise<FormState> {
  return runAction(async () => {
    const { u, a } = await actor();
    if (!rateLimit(`reply:${u.id}`, 60, 60 * 60_000).ok) return { error: "Too many messages — please wait." };
    const id = uuid.parse(str(fd, "ticketId"));
    const body = z.string().trim().min(1, "Message is empty").max(10_000).parse(str(fd, "body"));
    await replyTicket({ ...a, isStaff: false }, id, body);
    revalidatePath(`/portal/tickets/${id}`);
    return { ok: "Message sent." };
  });
}

export async function closeTicketAction(fd: FormData) {
  const { a } = await actor();
  const id = uuid.parse(str(fd, "ticketId"));
  await closeTicket({ ...a, isStaff: false }, id);
  revalidatePath(`/portal/tickets/${id}`);
}
