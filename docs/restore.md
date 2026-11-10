# Restoring a database backup

Do this once after setup and then every month, into a **temporary** database, so you know the backups work. The same steps recover production after a disaster.

## Test restore (safe, changes nothing in production)

1. Download the newest backup from the S3 bucket (Coolify: database → Backups → download), or use a local copy on the server under `/data/coolify/backups/`.
2. Copy it into the PostgreSQL container and restore into a new database:
   ```bash
   docker cp ./backup.dmp <postgres-container>:/tmp/backup.dmp
   docker exec -it <postgres-container> createdb -U <user> restore_test
   docker exec -it <postgres-container> pg_restore -U <user> -d restore_test --no-owner /tmp/backup.dmp
   ```
   If the file is plain SQL (`.sql`), use `psql -U <user> -d restore_test -f /tmp/backup.sql` instead of `pg_restore`.
3. Check that it is real and recent:
   ```bash
   docker exec -it <postgres-container> psql -U <user> -d restore_test -c "select count(*), max(created_at) from orders" -c "select count(*) from stock_movements"
   ```
   The newest order should be from just before the backup time.
4. Clean up:
   ```bash
   docker exec -it <postgres-container> dropdb -U <user> restore_test
   docker exec -it <postgres-container> rm /tmp/backup.dmp
   ```
5. Write the date of the test in your log.

## Real restore (production is lost or damaged)

Everything entered after the backup is gone. First find out what happened: if only one thing is wrong, a correction in the app (adjustment, refund) is usually better than a restore.

1. Stop the app in Coolify, so nobody sells during the restore.
2. Take a backup of the damaged database anyway ("Backup now"). You may want it later.
3. Restore into a **new** database as in the test above (for example `cafe_pos_restored`), and check it.
4. Change the app's `DATABASE_URL` to the new database name and deploy. The app applies any missing migrations when it starts.
5. Sign in, check today's dashboard and stock, then tell staff which orders must be re-entered (use paper receipts or the payment provider's history).
6. Keep the damaged database for a week, then drop it.

## Product images

Images live in their own R2 bucket and are not part of the database backup. Turn on object versioning for that bucket if you want protection against accidental deletion.
