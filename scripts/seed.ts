import "dotenv/config";
import { sql } from "drizzle-orm";
import { hash } from "@node-rs/argon2";
import { db, schema, closeDb } from "../src/lib/db";

/** Idempotent seed: safe to run repeatedly (upserts on natural keys). */
const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
const d = db();

const products = [
  {
    slug: "vps", name: "Cloud VPS", category: "Compute", provisioningType: "vps", sort: 1,
    tagline: "NVMe virtual servers in Jordan, live in under a minute",
    description: "Dedicated vCPU and RAM, NVMe storage, 10 Gbps uplink and full root access. Hosted in Umniah data centers for low latency and local data residency.",
    options: { regions: ["Amman-1", "Amman-2", "Irbid-1"], os: ["Ubuntu 24.04 LTS", "Ubuntu 26.04 LTS", "Debian 13", "Rocky Linux 10", "AlmaLinux 10", "Windows Server 2025"] },
    plans: [
      ["VPS-S", "VPS Small", 1, 6500, { vCPU: "2", RAM: "4 GB", "NVMe storage": "80 GB", Traffic: "20 TB" }],
      ["VPS-M", "VPS Medium", 2, 12900, { vCPU: "4", RAM: "8 GB", "NVMe storage": "160 GB", Traffic: "20 TB" }],
      ["VPS-L", "VPS Large", 3, 24900, { vCPU: "8", RAM: "16 GB", "NVMe storage": "320 GB", Traffic: "32 TB" }],
      ["VPS-XL", "VPS X-Large", 4, 47900, { vCPU: "16", RAM: "32 GB", "NVMe storage": "640 GB", Traffic: "32 TB" }],
    ],
    addons: [
      ["VPS-BACKUP", "Daily backups", "7-day automated snapshots", 1500],
      ["VPS-IPV4", "Additional IPv4", "One extra public IPv4 address", 1000],
      ["VPS-STOR100", "Extra 100 GB block storage", "Attachable NVMe volume", 3000],
      ["VPS-MON", "Managed monitoring", "24x7 health checks and alerts", 2500],
    ],
  },
  {
    slug: "email", name: "Business Email", category: "Productivity", provisioningType: "email", sort: 2,
    tagline: "Professional email on your own domain",
    description: "Secure, spam-filtered mailboxes on your domain with IMAP/SMTP, webmail, calendars and mobile sync.",
    options: { regions: ["Amman-1"] },
    plans: [
      ["MAIL-5", "Starter — 5 mailboxes", 1, 4900, { Mailboxes: "5", Storage: "10 GB each", Aliases: "Unlimited" }],
      ["MAIL-25", "Business — 25 mailboxes", 2, 17900, { Mailboxes: "25", Storage: "25 GB each", Aliases: "Unlimited" }],
      ["MAIL-100", "Enterprise — 100 mailboxes", 3, 54900, { Mailboxes: "100", Storage: "50 GB each", Aliases: "Unlimited" }],
    ],
    addons: [
      ["MAIL-ARCHIVE", "Email archiving", "10-year compliant archive", 3500],
      ["MAIL-ATP", "Advanced threat protection", "Sandboxing and link rewriting", 2900],
    ],
  },
  {
    slug: "dns", name: "Managed DNS", category: "Networking", provisioningType: "dns", sort: 3,
    tagline: "Anycast DNS with 100% uptime SLA",
    description: "Fast, resilient authoritative DNS with an API, record templates and DDoS-protected anycast name servers.",
    options: {},
    plans: [
      ["DNS-STD", "Standard — 5 zones", 1, 1500, { Zones: "5", Queries: "10M / month", API: "Yes" }],
      ["DNS-PRO", "Professional — 50 zones", 2, 7500, { Zones: "50", Queries: "100M / month", API: "Yes" }],
    ],
    addons: [
      ["DNS-SEC", "Managed DNSSEC", "Automatic key signing and rollover", 1000],
      ["DNS-GEO", "GeoDNS routing", "Location-aware responses", 2000],
    ],
  },
] as const;

for (const p of products) {
  const [prod] = await d.insert(schema.products).values({
    slug: p.slug, name: p.name, category: p.category, tagline: p.tagline, description: p.description,
    options: p.options as Record<string, string[]>, provisioningType: p.provisioningType, sort: p.sort,
  }).onConflictDoUpdate({ target: schema.products.slug, set: { name: p.name, tagline: p.tagline } }).returning();
  for (const [code, name, tier, price, specs] of p.plans) {
    await d.insert(schema.crmPriceBook).values({ code: `PB-${code}`, monthlyFils: price }).onConflictDoNothing();
    await d.insert(schema.plans).values({ productId: prod!.id, code, name, tier, specs, crmPriceCode: `PB-${code}` })
      .onConflictDoNothing({ target: schema.plans.code });
  }
  for (const [code, name, description, price] of p.addons) {
    await d.insert(schema.crmPriceBook).values({ code: `PB-${code}`, monthlyFils: price }).onConflictDoNothing();
    await d.insert(schema.addons).values({ productId: prod!.id, code, name, description, crmPriceCode: `PB-${code}` })
      .onConflictDoNothing({ target: schema.addons.code });
  }
}

const coupons = [
  { code: "WELCOME10", kind: "percent" as const, value: 10, maxRedemptions: 1000 },
  { code: "CLOUD5", kind: "fixed" as const, value: 5000, maxRedemptions: 200 },
];
for (const c of coupons) {
  const exists = await d.select().from(schema.coupons).where(sql`upper(${schema.coupons.code}) = ${c.code}`);
  if (!exists.length) await d.insert(schema.coupons).values(c);
}

const content = {
  "hero.title": "Cloud services built in Jordan, for Jordan",
  "hero.subtitle": "Deploy VPS, business email and managed DNS in minutes — local data centers, local support, transparent pricing in JOD.",
  "hero.badge": "New: annual plans save 15%",
};
for (const [key, value] of Object.entries(content)) {
  await d.insert(schema.siteContent).values({ key, value }).onConflictDoNothing();
}

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@cloud.local";
const adminPw = process.env.SEED_ADMIN_PASSWORD ?? "Admin#2026!";
const users = [
  { email: adminEmail, name: "Cloud Admin", role: "admin" as const, pw: adminPw },
  { email: "customer@demo.jo", name: "Demo Customer", role: "customer" as const, pw: "Customer#2026!" },
];
for (const u of users) {
  const exists = await d.select().from(schema.users).where(sql`lower(${schema.users.email}) = lower(${u.email})`);
  if (!exists.length) await d.insert(schema.users).values({ email: u.email, name: u.name, role: u.role, passwordHash: await hash(u.pw, ARGON) });
}

console.log("[seed] done — admin:", adminEmail, "| demo customer: customer@demo.jo / Customer#2026!");
await closeDb();
