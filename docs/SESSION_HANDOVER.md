# Session Handover

## Session 1 — 22 Nov 2026

### Context
POC for the Umniah Cloud eCommerce RFQ (UM.2026.PR261085.M.GH), built to accompany the technical and commercial proposal. The goal is a working demo of the RFQ's mandatory capabilities, structured so the business logic can later move into the Java Spring Boot core described in the proposal.

### Delivered
- **Storefront:** home page with editable hero and three products (Cloud VPS, Business Email, Managed DNS). The product configurator covers plan, billing cycle, region/OS, hostname, add-ons and coupons, with live server-side pricing. SEO: metadata, JSON-LD, sitemap, robots.
- **Checkout:** idempotent order creation and a test hosted payment gateway using a full-page POST and an HMAC-signed 303 redirect. Callback verification is signed, time-boxed and amount-checked, with a row lock so a payment is only fulfilled once. Saved card tokens are stored.
- **Provisioning:** an outbox `jobs` table processed by an in-process worker (SKIP LOCKED, leases, backoff, max attempts). Mock backends return IP/hostname details. A permanent failure triggers compensation.
- **Customer portal:** services list and detail, prorated upgrades, downgrades scheduled for renewal, cancel/resume at period end, auto-renew toggle, invoices (printable), payment history, orders, and support tickets.
- **Admin:** KPI dashboard (revenue, MRR, funnel, abandoned checkouts, daily revenue, by product), customers with audited login-as-client, subscriptions, tickets (reply and close), no-code catalog (products, plans, add-ons, prices), coupons, site content, jobs and a manual billing run, and the audit trail.
- **Security:** Argon2id passwords, HMAC-hashed opaque sessions in `__Host-` cookies, failed-login throttling, nonce-based CSP and security headers, Zod validation on every write, an append-only audit trigger, and redaction of sensitive fields.
- **Ops:** `/api/health`, multi-stage non-root Dockerfile, docker-compose (PostgreSQL 18), idempotent seed.
- **Tests:** 19 Vitest unit and integration tests against real PostgreSQL. A browser end-to-end run of the full flow passed with zero console or CSP errors.

### Decisions
- Next.js full-stack for the POC because it can be built and tested end to end quickly. The Java core stays as the production target, and the service contracts are kept stable for that move.
- Downgrades take effect at renewal (no mid-cycle credits). Upgrades are charged prorated immediately.
- Money is stored as integer fils throughout.

### Known limitations and next steps
1. Docker image and compose file are written but have not been built in this session (no Docker daemon was available). Run `docker compose up --build` once to verify.
2. Rate limiter and price cache are in-memory, which suits a single instance only. Move them to Valkey before scaling out.
3. Arabic/RTL localisation is not yet implemented.
4. No dunning or retry schedule for failed renewals yet; the subscription is suspended immediately.
5. Mock adapters stand in for Umniah CRM, payment gateway and provisioning. Swap to `http` mode once their API specs are received.
6. Next build is the Java Spring Boot core and Kill Bill, behind the same adapter interfaces.

### How to resume
`npm install` → `npm run db:setup` → `npm run dev` → demo script in README §3. Run `npm test` before any change.
