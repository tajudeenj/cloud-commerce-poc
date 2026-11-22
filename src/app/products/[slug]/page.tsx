import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getProduct } from "@/lib/services/catalog";
import { track } from "@/lib/services/analytics";
import { currentUser } from "@/lib/auth";
import { randomToken } from "@/lib/crypto";
import { getPrices } from "@/lib/adapters/crm";
import { Configurator } from "./configurator";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = await getProduct(slug);
  if (!p) return { title: "Not found" };
  return { title: `${p.name} — ${p.tagline}`, description: p.description, alternates: { canonical: `/products/${p.slug}` } };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) notFound();
  const [user, jar, prices] = await Promise.all([
    currentUser(), cookies(),
    getPrices([...product.plans.map((p) => p.crmPriceCode), ...product.addons.map((a) => a.crmPriceCode)]),
  ]);
  const vid = jar.get("vid")?.value;
  if (vid) await track({ userId: user?.id, visitorId: vid, type: "product_view", data: { product: slug } });

  const jsonLd = {
    "@context": "https://schema.org", "@type": "Product", name: product.name, description: product.description,
    offers: product.plans.map((p) => ({ "@type": "Offer", name: p.name, priceCurrency: "JOD", price: ((prices.get(p.crmPriceCode) ?? 0) / 1000).toFixed(3) })),
  };

  return (
    <div className="space-y-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">{product.category}</p>
        <h1 className="mt-1 text-3xl font-bold">{product.name}</h1>
        <p className="mt-2 max-w-3xl text-ink-700">{product.description}</p>
      </header>
      <Configurator
        productSlug={product.slug}
        options={product.options}
        hostnameLabel={product.provisioningType === "vps" ? "Server hostname (optional)" : "Your domain"}
        plans={product.plans.map((p) => ({ code: p.code, name: p.name, specs: p.specs, monthlyFils: prices.get(p.crmPriceCode) ?? 0 }))}
        addons={product.addons.map((a) => ({ code: a.code, name: a.name, description: a.description, monthlyFils: prices.get(a.crmPriceCode) ?? 0 }))}
        initialKey={randomToken(24)}
        signedIn={!!user}
      />
    </div>
  );
}
