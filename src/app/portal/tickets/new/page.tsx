import { and, eq, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ActionForm, Submit } from "@/components/form";
import { newTicketAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function NewTicket({ searchParams }: { searchParams: Promise<{ service?: string }> }) {
  const { service = "" } = await searchParams;
  const u = await requireUser();
  const subs = await db().select({ id: schema.subscriptions.id, product: schema.products.name, plan: schema.plans.name, ref: schema.subscriptions.externalRef })
    .from(schema.subscriptions).innerJoin(schema.products, eq(schema.products.id, schema.subscriptions.productId)).innerJoin(schema.plans, eq(schema.plans.id, schema.subscriptions.planId))
    .where(and(eq(schema.subscriptions.userId, u.id), ne(schema.subscriptions.status, "cancelled")));
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="h1">Open a support ticket</h1>
      <ActionForm action={newTicketAction} className="card space-y-4">
        <div><label className="label" htmlFor="subscriptionId">Related service</label>
          <select id="subscriptionId" name="subscriptionId" className="input" defaultValue={service}>
            <option value="">General / billing question</option>
            {subs.map((s) => <option key={s.id} value={s.id}>{s.product} — {s.plan} {s.ref ? `(${s.ref})` : ""}</option>)}
          </select></div>
        <div><label className="label" htmlFor="priority">Priority</label>
          <select id="priority" name="priority" className="input" defaultValue="medium">
            <option value="low">Low — question or minor issue</option><option value="medium">Medium — partial impact</option>
            <option value="high">High — significant degradation</option><option value="critical">Critical — service down</option>
          </select></div>
        <div><label className="label" htmlFor="subject">Subject</label><input id="subject" name="subject" className="input" required maxLength={150} /></div>
        <div><label className="label" htmlFor="body">Description</label><textarea id="body" name="body" className="input min-h-40" required maxLength={10000} /></div>
        <Submit>Submit ticket</Submit>
      </ActionForm>
    </div>
  );
}
