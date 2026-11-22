# Architecture & Design Decisions

## 1. Shape of the POC

```
Browser ──► proxy.ts (CSP nonce, visitor id)
          ──► Next.js App Router
                ├─ Server Components (read)        ─┐
                ├─ Server Actions (write, Zod)      ├─► lib/services/*  ──► PostgreSQL (Drizzle)
                └─ Route handlers (gateway callback)┘          │
                                                               ├─► adapters/crm.ts ──────► CRM (prices, customers)
                                                               ├─► adapters/payment.ts ──► Payment gateway
                                                               └─► jobs table (outbox) ──► worker ──► adapters/provisioning.ts
```

All business rules live in `lib/services` and never in UI code, so the same services can be lifted into the Java (Spring Boot) Commerce Core of the target architecture without changing the frontend contract.

## 2. Key decisions

| Concern | Decision | Why |
|---|---|---|
| Money | Integer **fils** (1 JOD = 1000) end to end; `bigint` columns; pure functions in `billing-math.ts` | No floating-point drift; JOD has 3 decimals |
| Pricing authority | Server-side `quote()` only; client never sends amounts; unknown CRM price → fail closed | Prevents price tampering and selling at an unknown price |
| CRM pricing | TTL cache with single-flight de-duplication; invalidated on admin price change | Protects CRM under load; one in-flight request per code |
| Checkout idempotency | Client idempotency key + unique index + `ON CONFLICT DO NOTHING` | Double-clicks/retries never create duplicate orders |
| Payment callback | HMAC-SHA256 over canonical fields, constant-time compare, 15-min freshness, amount re-check, row lock (`SELECT … FOR UPDATE`) | Forged, replayed, tampered or concurrent callbacks cannot double-fulfil |
| Card data | Captured only on the gateway's hosted page; platform stores an opaque token | Minimal PCI DSS scope (SAQ-A style) |
| Provisioning | Transactional **outbox** (`jobs`) + worker with `FOR UPDATE SKIP LOCKED`, leases, exponential back-off, max attempts, `Idempotency-Key` = job id | Safe across replicas and crashes; no lost or duplicated provisioning |
| Compensation | Permanent provisioning failure → subscription `failed` + audit event | Clear customer status; support/finance can refund |
| Upgrades / downgrades | Upgrade = immediate prorated charge; downgrade = scheduled for renewal | Avoids credits/refunds mid-cycle; standard cloud practice |
| Renewals | Per-subscription transaction, idempotent reference per period, token charge before lock | Re-running the sweep never double-renews |
| Sessions | 32-byte opaque token in `HttpOnly`, `SameSite=Lax`, `__Host-` cookie; only an HMAC of it is stored | DB leak does not leak sessions |
| Passwords | Argon2id (OWASP params); constant-time path for unknown emails; failed-attempt throttling per IP and per account | Brute-force and user-enumeration resistance |
| Impersonation | Admin-only, customer targets only, reason required, 30-min session, banner, audited start/end, every action carries `impersonator_id` | "Login as client" without losing accountability |
| Audit trail | Append-only table enforced by a DB trigger; sensitive keys redacted | Tamper-evident; never stores secrets |
| Web security | Nonce-based CSP with `strict-dynamic`, HSTS, frame-deny, `nosniff`, Zod validation on every action, parameterised SQL only, React output escaping, open-redirect guard | OWASP Top 10 / ASVS L2 baseline for Umniah PT |
| DB resilience | Bounded pool, statement/query timeouts, indexed hot paths | Predictable behaviour under heavy load |
| SEO | Server-rendered pages, per-product metadata, JSON-LD `Product/Offer`, `sitemap.xml`, `robots.txt` | RFQ SEO requirement |

## 3. RFQ requirement → POC feature

| RFQ requirement | Where in the POC |
|---|---|
| Low-code customisable CMS / products without hard coding | `/admin/catalog` (products, plans, add-ons, specs, regions/OS, prices), `/admin/content` |
| REST API integration | `lib/adapters/*` with `http` mode, timeouts, retries, idempotency keys |
| Billing via Visa/Mastercard + 3rd-party gateway | Hosted page flow, signed callback, token charges |
| Monthly / quarterly / annual | `billing-math.ts` cycles with commitment discounts |
| Dynamic price from CRM | `getPrices()` → CRM adapter (mock = `crm_price_book`) |
| Custom features / add-ons | Configurator + add-ons per product |
| Ticketing (admin view / reply / close) | `/portal/tickets`, `/admin/tickets` |
| Renew / upgrade / downgrade / cancel / modify | Service page + renewal worker |
| History, invoices, payments, status | `/portal/billing`, printable invoices, service status |
| Discounts / promo codes / coupons | `/admin/coupons`, guarded redemption counter |
| Multiple services per account | One user → many subscriptions |
| Analytics incl. cart abandonment | `/admin` dashboard: revenue, MRR, funnel, abandoned checkouts |
| Logging & audit trail | `audit_log` (append-only) + `/admin/audit` |
| Login as client | `/admin/customers` → audited impersonation |
| SEO | Metadata, JSON-LD, sitemap, robots |
| Open-source, Ubuntu + PostgreSQL | 100% OSS; Docker image on Debian slim; PostgreSQL |

## 4. POC → production roadmap

| Area | POC | Production (per proposal) |
|---|---|---|
| Commerce core | Next.js server services | Java 25 + Spring Boot 4 core (same service contracts) |
| Billing engine | Built-in subscription logic | Kill Bill (dunning, credits, tax, usage billing) |
| Orchestration | Outbox + in-process worker | Temporal workflows |
| Identity | Built-in sessions | Keycloak (MFA, passkeys, SSO for staff) |
| CMS | Admin content + catalog | Payload CMS block-based page builder |
| Ticketing | Built-in | Zammad (SLA timers, email channel) |
| Rate limiting / cache | In-memory (single instance) | Valkey (shared across replicas) |
| Analytics | Event table + dashboard | Matomo funnels + Apache Superset |
| Localisation | English | Arabic/English with RTL |
| Platform | Docker Compose | RKE2 Kubernetes, CloudNativePG HA, Argo CD, OpenTelemetry/Grafana, OpenBao |
