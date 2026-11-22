import { requireAdmin } from "@/lib/auth";
import { catalogForAdmin } from "@/lib/services/admin";
import { ActionForm, Submit } from "@/components/form";
import { createPlanAction, updateAddonAction, updatePlanAction, updateProductAction } from "../actions";

export const dynamic = "force-dynamic";
const jod = (f: number | null) => (f === null ? "" : (f / 1000).toFixed(3));
const specsText = (s: Record<string, string>) => Object.entries(s).map(([k, v]) => `${k}: ${v}`).join("\n");

export default async function Catalog() {
  await requireAdmin();
  const products = await catalogForAdmin();
  return (
    <div className="space-y-8">
      <div><h1 className="h1">Products & pricing</h1>
        <p className="muted">No-code catalog management. Prices are written to the CRM price book (mock) and go live immediately — the storefront reads them dynamically.</p></div>
      {products.map((p) => (
        <section key={p.id} className="card space-y-5">
          <ActionForm action={updateProductAction} className="grid gap-3 md:grid-cols-2">
            <input type="hidden" name="id" value={p.id} />
            <div><label className="label">Product name</label><input name="name" className="input" defaultValue={p.name} required /></div>
            <div><label className="label">Tagline</label><input name="tagline" className="input" defaultValue={p.tagline} /></div>
            <div className="md:col-span-2"><label className="label">Description</label><textarea name="description" className="input" defaultValue={p.description} rows={2} /></div>
            <div><label className="label">Regions (comma or line separated)</label><textarea name="regions" className="input" defaultValue={(p.options.regions ?? []).join(", ")} rows={2} /></div>
            <div><label className="label">Operating systems</label><textarea name="os" className="input" defaultValue={(p.options.os ?? []).join(", ")} rows={2} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={p.active} className="accent-brand-600" /> Visible in store</label>
            <div className="text-right"><Submit className="btn-secondary">Save product</Submit></div>
          </ActionForm>

          <div><h3 className="font-semibold">Plans</h3>
            <div className="mt-2 grid gap-3 lg:grid-cols-2">
              {p.plans.map((pl) => (
                <ActionForm key={pl.id} action={updatePlanAction} className="rounded-lg border border-slate-200 p-3">
                  <input type="hidden" name="id" value={pl.id} />
                  <p className="mb-2 font-mono text-xs text-ink-500">{pl.code} · tier {pl.tier} · CRM {pl.crmPriceCode}</p>
                  <div className="grid grid-cols-[1fr_120px] gap-2">
                    <input name="name" className="input" defaultValue={pl.name} required aria-label="Plan name" />
                    <input name="price" className="input" defaultValue={jod(pl.monthlyFils)} required aria-label="Monthly price JOD" />
                  </div>
                  <textarea name="specs" className="input mt-2 font-mono text-xs" rows={4} defaultValue={specsText(pl.specs)} aria-label="Specs" />
                  <div className="mt-2 flex items-center justify-between"><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={pl.active} className="accent-brand-600" /> Active</label><Submit className="btn-secondary py-1">Save</Submit></div>
                </ActionForm>
              ))}
              <ActionForm action={createPlanAction} className="rounded-lg border border-dashed border-brand-500 p-3">
                <input type="hidden" name="productId" value={p.id} />
                <p className="mb-2 text-sm font-semibold text-brand-700">+ New plan</p>
                <div className="grid grid-cols-3 gap-2">
                  <input name="code" className="input" placeholder="CODE" required aria-label="Code" />
                  <input name="tier" className="input" placeholder="Tier" type="number" min={0} defaultValue={p.plans.length + 1} aria-label="Tier" />
                  <input name="price" className="input" placeholder="JOD/mo" required aria-label="Price" />
                </div>
                <input name="name" className="input mt-2" placeholder="Plan name" required aria-label="Plan name" />
                <textarea name="specs" className="input mt-2 font-mono text-xs" rows={3} placeholder={"vCPU: 2\nRAM: 4 GB"} aria-label="Specs" />
                <div className="mt-2 text-right"><Submit className="btn-primary py-1">Create plan</Submit></div>
              </ActionForm>
            </div></div>

          {p.addons.length > 0 && <div><h3 className="font-semibold">Add-ons</h3>
            <div className="mt-2 grid gap-3 lg:grid-cols-2">{p.addons.map((a) => (
              <ActionForm key={a.id} action={updateAddonAction} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-3">
                <input type="hidden" name="id" value={a.id} />
                <input name="name" className="input flex-1" defaultValue={a.name} required aria-label="Add-on name" />
                <input name="price" className="input w-28" defaultValue={jod(a.monthlyFils)} required aria-label="Monthly price JOD" />
                <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="active" defaultChecked={a.active} className="accent-brand-600" /> Active</label>
                <Submit className="btn-secondary py-1">Save</Submit>
              </ActionForm>))}</div></div>}
        </section>
      ))}
    </div>
  );
}
