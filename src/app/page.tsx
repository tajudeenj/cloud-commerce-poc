import Link from "next/link";
import { listProducts, startingPrices } from "@/lib/services/catalog";
import { getContent } from "@/lib/services/admin";
import { Money } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [products, content] = await Promise.all([listProducts(), getContent()]);
  const from = await startingPrices(products.map((p) => p.id));
  return (
    <div className="space-y-14">
      <section className="rounded-2xl bg-gradient-to-br from-ink-900 to-slate-800 px-8 py-16 text-white">
        {content["hero.badge"] && <span className="mb-4 inline-block rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold">{content["hero.badge"]}</span>}
        <h1 className="max-w-3xl text-4xl font-bold leading-tight md:text-5xl">{content["hero.title"]}</h1>
        <p className="mt-4 max-w-2xl text-lg text-slate-300">{content["hero.subtitle"]}</p>
        <div className="mt-8 flex gap-3">
          <Link href="/products/vps" className="btn-primary px-6 py-3">Deploy a VPS</Link>
          <a href="#products" className="btn border border-white/30 px-6 py-3 text-white hover:bg-white/10">View all services</a>
        </div>
      </section>

      <section id="products" aria-labelledby="products-h">
        <h2 id="products-h" className="h1 mb-6">Cloud services</h2>
        <div className="grid gap-6 md:grid-cols-3">
          {products.map((p) => (
            <Link key={p.id} href={`/products/${p.slug}`} className="card group flex flex-col transition hover:-translate-y-0.5 hover:border-brand-500 hover:shadow-md">
              <span className="text-xs font-semibold uppercase tracking-wide text-brand-700">{p.category}</span>
              <h3 className="mt-1 text-xl font-bold">{p.name}</h3>
              <p className="muted mt-2 flex-1">{p.tagline}</p>
              <p className="mt-6 text-sm text-ink-500">from <Money className="text-2xl font-bold text-ink-900" fils={from.get(p.id) ?? 0} /> / month</p>
              <span className="mt-4 text-sm font-semibold text-brand-700 group-hover:underline">Configure →</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-4">
        {[
          ["Local data residency", "Your data stays in Umniah data centers in Jordan."],
          ["Billing your way", "Monthly, quarterly or annual — save up to 15%."],
          ["Self-service portal", "Upgrade, downgrade, renew or cancel anytime."],
          ["24/7 support", "Ticketing with critical-incident response in 1 hour."],
        ].map(([t, d]) => (
          <div key={t} className="card"><h3 className="font-semibold">{t}</h3><p className="muted mt-1">{d}</p></div>
        ))}
      </section>
    </div>
  );
}
