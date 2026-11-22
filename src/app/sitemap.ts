import type { MetadataRoute } from "next";
import { listProducts } from "@/lib/services/catalog";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const products = await listProducts();
  return [{ url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    ...products.map((p) => ({ url: `${base}/products/${p.slug}`, changeFrequency: "weekly" as const, priority: 0.8 }))];
}
