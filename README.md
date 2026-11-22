# Cloud eCommerce Platform — Proof of Concept

A working proof of concept for a cloud-services storefront and self-service portal (VPS, Business Email, Managed DNS) with subscription billing, payment gateway integration, provisioning orchestration, support ticketing, analytics and a no-code admin — built against RFQ **UM.2026.PR261085.M.GH**.

| | |
|---|---|
| **Stack** | Next.js 16 (App Router, React 19, TypeScript 7) · PostgreSQL 16+ (18 recommended) · Drizzle ORM · Tailwind CSS 4 · Zod 4 · Argon2id |
| **Integrations** | CRM pricing/customers, payment gateway (hosted page + tokens), provisioning backends — each behind an adapter with `mock` and `http` modes |
| **Tests** | 19 automated unit/integration tests (Vitest, real PostgreSQL) + full browser end-to-end run |

---

## 1. Run it on Windows (no Docker)

**Prerequisites:** [Node.js 22 LTS](https://nodejs.org) and [PostgreSQL 18](https://www.postgresql.org/download/windows/) (installer includes pgAdmin and `psql`).

1. Create the database (open *SQL Shell (psql)* from the Start menu, log in as `postgres`):
   ```sql
   CREATE ROLE cloudpoc LOGIN PASSWORD 'cloudpoc';
   CREATE DATABASE cloudpoc OWNER cloudpoc;
   CREATE DATABASE cloudpoc_test OWNER cloudpoc;
   ```
2. In PowerShell, from the project folder:
   ```powershell
   Copy-Item .env.example .env
   npm install
   npm run db:setup      # migrations + seed data (idempotent)
   npm run dev           # http://localhost:3000
   ```
3. Optional — production mode:
   ```powershell
   npm run build
   npm start
   ```
4. Optional — run the tests (uses `cloudpoc_test`, which is wiped on each run):
   ```powershell
   npm test
   ```

## 2. Run it with Docker (any OS)

```bash
cp .env.example .env
docker compose up --build      # http://localhost:3000
```

## 3. Demo script (10 minutes)

| Step | Where | What to show |
|---|---|---|
| 1 | `/` | Homepage — content is editable from admin (no deployment) |
| 2 | `/products/vps` | Configurator: plan, Annual (−15%), region/OS, add-ons, coupon `WELCOME10` — live pricing from CRM |
| 3 | Checkout → test gateway | Card `4111 1111 1111 1111` approves; `4000 0000 0000 0002` declines |
| 4 | `/portal/services/…` | Provisioning → **active** with IP/hostname from backend; invoice issued |
| 5 | Same page | **Upgrade now** (prorated charge) / **Schedule downgrade** (at renewal) / cancel at period end |
| 6 | `/portal/tickets/new` | Open a ticket linked to the service |
| 7 | Admin `/admin` | Revenue, MRR, funnel, cart abandonment |
| 8 | `/admin/tickets` | Reply and close the ticket |
| 9 | `/admin/catalog` | Change a price → storefront updates immediately; add a new plan without code |
| 10 | `/admin/customers` | **Login as client** (reason required, banner shown, fully audited) |
| 11 | `/admin/jobs` | Run billing cycle (renewals on saved card token) |
| 12 | `/admin/audit` | Append-only audit trail incl. impersonation |

**Demo accounts:** customer `customer@demo.jo` / `Customer#2026!` · admin `admin@cloud.local` / `Admin#2026!`
**Demo hook:** a VPS hostname containing `fail` simulates a backend provisioning failure (shows compensation).

## 4. Configuration

All settings are environment variables — see [`.env.example`](.env.example). Switch any integration to a real backend by setting its mode to `http`:

| Variable | Purpose |
|---|---|
| `CRM_MODE`, `CRM_BASE_URL`, `CRM_API_KEY` | Dynamic pricing (`GET /prices?codes=`) and customer upsert (`POST /customers`) |
| `PAYMENT_MODE`, `PAYMENT_GATEWAY_URL`, `PAYMENT_HMAC_SECRET` | Hosted payment page, signed callbacks, token charges (`POST /charges`) |
| `PROVISIONING_MODE`, `PROVISIONING_BASE_URL`, `PROVISIONING_API_KEY` | `POST/PUT/DELETE /{type}/services` with `Idempotency-Key` |
| `WORKER_ENABLED`, `WORKER_INTERVAL_MS` | In-process job worker and renewal scheduler |

> Values containing `#` or spaces must be quoted in `.env` (e.g. `SEED_ADMIN_PASSWORD="Admin#2026!"`).

## 5. Project layout

```
src/
  app/                 Routes: storefront, products/[slug], checkout, portal/*, admin/*, api/health
  lib/
    adapters/          crm.ts · payment.ts · provisioning.ts · http.ts (timeouts, retries, idempotency)
    services/          catalog · orders · worker · tickets · analytics · admin  (all business logic)
    db/schema.ts       PostgreSQL schema (money as integer fils; audit log append-only)
    billing-math.ts    Pure pricing / proration / date math (unit-tested)
    auth.ts            Argon2id, hashed opaque sessions, impersonation
  proxy.ts             Per-request CSP nonce + anonymous visitor id
  instrumentation.ts   Starts the background worker
drizzle/               SQL migrations
scripts/               migrate.ts · seed.ts
tests/                 Vitest unit + integration tests
docs/                  ARCHITECTURE.md · SESSION_HANDOVER.md
```

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for design decisions, the requirement-to-feature map and the production roadmap.
