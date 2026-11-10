# Café POS

Web-based point of sale for cafés: inventory with recipes and weighted average
cost, POS with USD/KHR payments, supplier credit, reports and multi-branch.
The full build spec is in [`plan.md`](./plan.md); its checkboxes show progress.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS + shadcn/ui ·
PostgreSQL 17 · Drizzle ORM · TanStack Query · Vitest.

## Requirements

Install these once:

- **Git**
- **Node.js 22 LTS** or newer
- **pnpm 10** — enable it once with `corepack enable`, or `npm install -g pnpm`
- **PostgreSQL 17**, either way:
  - **Docker Desktop** (recommended): `pnpm db:up` starts it for you, or
  - a **native PostgreSQL** install (17 or newer): create an empty database named `cafe_pos` and put your own password in the two URLs in `.env`. Skip `pnpm db:up`. Don't create `cafe_pos_test`, the tests do that themselves.
- Only for `pnpm test:e2e`: the Playwright browser, installed once with `pnpm exec playwright install chromium`

## First-time setup

```bash
git clone https://github.com/pechsomanith232-ux/Cafe-POS.git
cd Cafe-POS
pnpm install
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
pnpm db:up                    # Docker only: starts PostgreSQL 17 and waits until it is ready
pnpm db:migrate               # creates the tables
pnpm db:seed                  # roles, permissions, first branch and the Owner login
pnpm db:seed:demo             # optional: demo data (about 4 minutes)
pnpm dev                      # http://localhost:3000
```

Sign in with `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` from your `.env`
(default `owner@example.com` / `change-me-please`), then:

1. **My account** → change the password and set your manager PIN.
2. **Settings → Branches** → rename the first branch, add more.
3. **Settings → Users** → create staff accounts and give each a role per branch.
4. **Settings → Roles** → adjust what each role may do (the Owner role is locked).

There is no public sign-up: only users with `users.manage` can create accounts.
Check the server: <http://localhost:3000/api/health> should return
`{"status":"ok","db":"ok",...}`.

## Everyday commands

| Command | What it does |
|---|---|
| `pnpm dev` | Start the dev server |
| `pnpm db:up` / `pnpm db:down` | Start / stop PostgreSQL in Docker |
| `pnpm db:generate` | Generate a SQL migration after changing `db/schema/*` |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:seed` | Insert starting data |
| `pnpm db:seed:demo` | Demo data on a fresh database: 2 branches, 60 items, 40 products, 2 months of orders (about 4 minutes; run `pnpm db:reset` first) |
| `pnpm db:reset` | Drop everything, migrate, seed (**local only**: refuses in production or on a non-localhost database) |
| `pnpm test` | Unit tests (no database needed) |
| `pnpm test:int` | Integration tests against `TEST_DATABASE_URL` (wiped and migrated on each run) |
| `pnpm test:e2e` | Playwright: login → open shift → sell → split pay → refund → close shift, against `TEST_DATABASE_URL` (first time: `pnpm exec playwright install chromium`) |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript checks |
| `pnpm build` | Production build (standalone output for Docker) |

Optional image storage for local development (Phase 4):
`docker compose --profile storage up -d` starts MinIO on port 9000
(console on 9001).

## Demo data

`pnpm db:reset` then `pnpm db:seed:demo` fills the database by replaying two months of trading through the real services, so stock, costs, supplier balances and shift cash all add up. It creates staff logins `manager.b1@demo.local`, `cashier.b1@demo.local`, `barista.b1@demo.local` (and `.b2`). Their password is `DEMO_STAFF_PASSWORD` (default: the owner password) and the manager PIN is `DEMO_MANAGER_PIN` (default `1234`).

## Production

- [docs/deploy-coolify.md](docs/deploy-coolify.md) — VPS + Coolify, step by step
- [docs/restore.md](docs/restore.md) — testing and restoring backups
- [docs/operations.md](docs/operations.md) — deploy, roll back, add a branch, reset a password
- [docs/user-guide.md](docs/user-guide.md) — short guide for staff

## Project layout

```
app/                 Next.js routes (pages, layouts, API routes)
  api/health/        Health check for Docker / Coolify
components/ui/       shadcn/ui components
db/
  schema/            Drizzle schema, one file per module
  client.ts          createDb(url)
  index.ts           Shared app db client (reads DATABASE_URL)
  migrator.ts        runMigrations(url)
  migrate.ts, seed.ts, reset.ts   CLI scripts behind pnpm db:*
drizzle/             Generated SQL migrations (committed)
lib/
  domain/            Pure business maths (money, units, WAC, ...) — unit-tested
  services/          ALL writes (one transaction, permission check, audit)
  queries/           Read-only queries for pages
  validators/        Zod schemas shared by forms and services
  auth.ts            Better Auth config;  context.ts  getContext()
  permissions.ts     requirePermission / hasPermission / branchScope
  health.ts          Health check logic
tests/
  unit/              Fast tests, no database
  integration/       Tests against the test database; each test runs in a
                     transaction that is rolled back (withRollback)
docker-compose.yml   Local PostgreSQL (+ optional MinIO)
```

## Access control in one minute

- A user has **one role per branch** (e.g. Manager at B1, Cashier at B2).
  The branch switcher in the sidebar picks the active branch.
- Permissions live on roles (`lib/permissions-catalog.ts`, editable in
  Settings → Roles). Server code checks them with
  `requirePermission(ctx, branchId, "perm.key")`; the sidebar only hides links.
- Every query on branch data filters with `branchScope(ctx, table.branchId)`.
- Sensitive changes are written to the append-only **audit log**
  (Settings → Audit log), in the same transaction as the change.
- Manager approvals: the approver picks their name and enters their PIN.
  5 wrong PINs in 5 minutes lock approvals for that window.

## Engineering rules (short version)

See `plan.md` §2 for the full list. The important ones:

- Stock and money change **only** in `lib/services/*`, each in one transaction
  with a permission check, row locks and an audit-log entry.
- Use `numeric` in PostgreSQL and `decimal.js` (`lib/domain/money.ts`) in
  TypeScript — never floating point for money or quantities.
- The server recalculates every total; never trust totals from the browser.

## Troubleshooting

- **`pnpm test:int` says the database doesn't exist or can't connect** — run
  `pnpm db:up` and wait a few seconds for PostgreSQL to start.
- **Port 5432 already in use** — another PostgreSQL is running on your
  machine. Stop it, or change the port in `docker-compose.yml` and in `.env`.
- **Forgot the owner password** — run `pnpm db:reset` (local only; wipes data),
  or ask another user with `users.manage` to reset it in Settings → Users.
- **Started fresh but `cafe_pos_test` is missing** — the integration tests
  create it automatically on the next `pnpm test:int` run.
