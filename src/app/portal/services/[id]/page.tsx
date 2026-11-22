import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { randomToken } from "@/lib/crypto";
import { previewPlanChange } from "@/lib/services/orders";
import { Alert, Badge, Money, fmtDate, fmtDateTime } from "@/components/ui";
import { ActionForm, Submit } from "@/components/form";
import { CYCLE_LABEL, type Cycle } from "@/lib/billing-math";
import { autoRenewAction, cancelAction, changePlanAction } from "../../actions";

export const dynamic = "force-dynamic";

const MSG: Record<string, [string, "success" | "info"]> = {
  paid: ["Payment received — thank you! Provisioning has started; details appear here within moments.", "success"],
  "change-scheduled": ["Your plan change is scheduled and takes effect at the next renewal.", "info"],
};

export default async function ServicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const [{ id }, { msg }] = await Promise.all([params, searchParams]);
  const u = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sub = await db().query.subscriptions.findFirst({ where: and(eq(schema.subscriptions.id, id), eq(schema.subscriptions.userId, u.id)) });
  if (!sub) notFound();
  const [product, plan, pendingPlan, allPlans, addons, invoices] = await Promise.all([
    db().query.products.findFirst({ where: eq(schema.products.id, sub.productId) }),
    db().query.plans.findFirst({ where: eq(schema.plans.id, sub.planId) }),
    sub.pendingPlanId ? db().query.plans.findFirst({ where: eq(schema.plans.id, sub.pendingPlanId) }) : null,
    db().select().from(schema.plans).where(and(eq(schema.plans.productId, sub.productId), eq(schema.plans.active, true))).orderBy(schema.plans.tier),
    db().select().from(schema.addons).where(and(eq(schema.addons.productId, sub.productId), eq(schema.addons.active, true))),
    db().select().from(schema.invoices).where(eq(schema.invoices.subscriptionId, sub.id)).orderBy(desc(schema.invoices.issuedAt)),
  ]);
  const actor = { userId: u.id };
  const changes = sub.status === "active"
    ? await Promise.all(allPlans.filter((p) => p.id !== sub.planId).map(async (p) => {
        const pv = await previewPlanChange(actor, sub.id, p.code, sub.addonCodes).catch(() => null);
        return { plan: p, pv };
      }))
    : [];
  const m = msg ? MSG[msg] : undefined;
  const live = sub.status === "provisioning";

  return (
    <div className="space-y-6">
      {live && <meta httpEquiv="refresh" content="3" />}
      <Link href="/portal" className="muted hover:underline">← My services</Link>
      {m && <Alert kind={m[1]}>{m[0]}</Alert>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="h1">{product!.name} — {plan!.name}</h1><p className="muted">Reference {sub.externalRef ?? "pending"} · since {fmtDate(sub.createdAt)}</p></div>
        <Badge value={sub.status} />
      </div>
      {sub.status === "failed" && <Alert kind="error">We could not set up this service. Our team has been notified and will contact you; any payment will be refunded. You can also <Link className="underline" href="/portal/tickets/new">open a ticket</Link>.</Alert>}
      {sub.status === "suspended" && <Alert kind="error">This service is suspended because the renewal payment failed. Please contact support to update your payment method.</Alert>}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="h2 mb-3">Service details</h2>
          {live ? <p className="muted">⏳ Provisioning in progress… this page refreshes automatically.</p> : (
            <dl className="grid grid-cols-[150px_1fr] gap-y-2 text-sm">
              {Object.entries(sub.serviceDetails).map(([k, v]) => (<div key={k} className="contents"><dt className="text-ink-500">{k}</dt><dd className="font-mono">{v}</dd></div>))}
            </dl>
          )}
          <dl className="mt-4 grid grid-cols-[150px_1fr] gap-y-2 border-t border-slate-100 pt-4 text-sm">
            {Object.entries(plan!.specs).map(([k, v]) => (<div key={k} className="contents"><dt className="text-ink-500">{k}</dt><dd>{v}</dd></div>))}
            <dt className="text-ink-500">Add-ons</dt><dd>{sub.addonCodes.length ? addons.filter((a) => sub.addonCodes.includes(a.code)).map((a) => a.name).join(", ") : "None"}</dd>
          </dl>
        </section>

        <section className="card space-y-3">
          <h2 className="h2">Billing</h2>
          <p className="text-sm"><Money className="text-xl font-bold" fils={sub.pricePerCycleFils} /> / {CYCLE_LABEL[sub.cycle as Cycle].toLowerCase()}</p>
          <p className="text-sm">Current period: {fmtDate(sub.currentPeriodStart)} → {fmtDate(sub.currentPeriodEnd)}</p>
          {pendingPlan && <p className="text-sm text-amber-800">Scheduled change to <b>{pendingPlan.name}</b> at next renewal.</p>}
          {["active", "cancel_pending"].includes(sub.status) && (
            <div className="flex flex-wrap gap-2 pt-2">
              <ActionForm action={autoRenewAction}>
                <input type="hidden" name="subscriptionId" value={sub.id} /><input type="hidden" name="autoRenew" value={String(!sub.autoRenew)} />
                <Submit className="btn-secondary">{sub.autoRenew ? "Turn off auto-renew" : "Turn on auto-renew"}</Submit>
              </ActionForm>
              <ActionForm action={cancelAction}>
                <input type="hidden" name="subscriptionId" value={sub.id} /><input type="hidden" name="cancel" value={String(sub.status === "active")} />
                <Submit className={sub.status === "active" ? "btn-danger" : "btn-secondary"}>{sub.status === "active" ? "Cancel at period end" : "Keep my service"}</Submit>
              </ActionForm>
            </div>
          )}
        </section>
      </div>

      {changes.length > 0 && (
        <section className="card">
          <h2 className="h2 mb-1">Upgrade or downgrade</h2>
          <p className="muted mb-4">Upgrades apply immediately and you pay only the prorated difference. Downgrades take effect at your next renewal.</p>
          <div className="grid gap-3 md:grid-cols-3">
            {changes.map(({ plan: p, pv }) => (
              <ActionForm key={p.id} action={changePlanAction} className="rounded-lg border border-slate-200 p-4">
                <input type="hidden" name="subscriptionId" value={sub.id} />
                <input type="hidden" name="planCode" value={p.code} />
                <input type="hidden" name="idempotencyKey" value={randomToken(24)} />
                {sub.addonCodes.map((c) => <input key={c} type="hidden" name="addon" value={c} />)}
                <p className="font-semibold">{p.name}</p>
                <p className="muted text-xs">{Object.values(p.specs).slice(0, 3).join(" · ")}</p>
                {pv && (pv.mode === "upgrade_now"
                  ? <p className="my-3 text-sm">Pay now <b><Money fils={pv.chargeFils} /></b>, then <Money fils={pv.quote.subtotalFils} /> per cycle</p>
                  : <p className="my-3 text-sm">From next renewal: <b><Money fils={pv.quote.subtotalFils} /></b> per cycle</p>)}
                <Submit className="btn-secondary w-full">{pv?.mode === "upgrade_now" ? "Upgrade now" : "Schedule downgrade"}</Submit>
              </ActionForm>
            ))}
          </div>
        </section>
      )}

      <section className="card overflow-x-auto p-0">
        <h2 className="h2 p-5 pb-2">Invoices for this service</h2>
        <table className="table"><thead><tr><th>#</th><th>Date</th><th>Amount</th><th></th></tr></thead>
          <tbody>{invoices.map((i) => (<tr key={i.id}><td>INV-{String(i.number).padStart(6, "0")}</td><td>{fmtDateTime(i.issuedAt)}</td><td><Money fils={i.totalFils} /></td><td className="text-right"><Link className="text-brand-700" href={`/portal/invoices/${i.id}`}>View</Link></td></tr>))}</tbody>
        </table>
      </section>
      <p className="muted">Need help with this service? <Link className="font-semibold text-brand-700" href={`/portal/tickets/new?service=${sub.id}`}>Open a support ticket</Link></p>
    </div>
  );
}
