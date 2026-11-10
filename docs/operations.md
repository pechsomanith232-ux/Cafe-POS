# Operations

Day-to-day running of the production system. Setup is in [deploy-coolify.md](deploy-coolify.md), backups in [restore.md](restore.md).

## Deploy

Push to `main`. Coolify builds the image and swaps containers when the new one is healthy. Migrations run automatically at start.

Rules for migrations, so a rollback is always possible:

- Add columns and tables first; remove old ones in a later release, after nothing uses them.
- New columns need a default or must be nullable.
- Generate with `pnpm db:generate`, commit the SQL in `drizzle/`, and run `pnpm test:int` before pushing.

## Roll back

Coolify → the app → Deployments → pick the previous successful deployment → **Redeploy**. The database is not rolled back; that is why migrations must stay backward-compatible. If the data itself is wrong, see [restore.md](restore.md).

## Backups

Daily at 2 AM to S3 (14 kept) plus 3 local copies. Test a restore monthly. A failed backup sends a Coolify notification: fix it the same day.

## Monitoring

- Coolify notifications: failed deploys, failed backups, server disk usage.
- Uptime check on `https://pos.<domain>/api/health` (200 = app and database both up; 503 = app up, database unreachable).
- Logs: Coolify → the app → Logs. Server errors shown to users carry an error id that matches a log line.

## Add a branch

1. Settings → Branches → **New branch** (code like `B3`, name, address, receipt header/footer, tax).
   The new branch gets a register, payment methods and the default exchange rate automatically; you join it with your own role.
2. Settings → POS: check the exchange rate, registers and tables for that branch.
3. Settings → Users: give staff a role at the branch.
4. Inventory → Items: enter opening stock and reorder levels for the branch (or send a stock transfer from another branch).
5. Menu → Products: set branch prices or switch products off where needed.

## Reset a password or PIN

- Password: Settings → Users → the user → **Reset password**. This signs them out everywhere. Tell them to change it under My account.
- Manager PIN: Settings → Users → the user → **Set PIN**; a user can also set their own under My account.
- After 5 wrong PINs, approvals for that person are locked for 5 minutes. Just wait.
- Owner locked out with no other admin: run `pnpm db:seed` against production through an SSH tunnel with a **new** `SEED_OWNER_EMAIL` (see deploy-coolify.md §4). It creates a second owner and leaves existing users alone.

## A staff member leaves

Settings → Users → the user → deactivate. Their history stays; they can no longer sign in or approve with their PIN.

## Monthly checklist

- [ ] Test restore done and logged
- [ ] Server updates applied (`sudo apt upgrade`, reboot if asked), Coolify updated
- [ ] Disk space under 70% (`df -h`)
- [ ] Review the audit log for voids, refunds and stock adjustments
- [ ] Stock count posted
