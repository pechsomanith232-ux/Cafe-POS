# Deploying to a VPS with Coolify

One VPS runs everything: Coolify, the app (Docker image built from this repo) and PostgreSQL. Expect about an hour the first time.

Menu names in Coolify change between versions. If a label below doesn't match exactly, look for the closest one.

## 1. Server

1. Rent a VPS: **2 vCPU, 4 GB RAM, Ubuntu LTS**, region Singapore (closest to Cambodia).
2. Log in with your SSH key, then turn password logins off:
   ```bash
   sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
   sudo systemctl restart ssh
   ```
3. Automatic security updates and the server clock (so the 2 AM backup is 2 AM in Cambodia):
   ```bash
   sudo apt update && sudo apt install -y unattended-upgrades
   sudo dpkg-reconfigure -plow unattended-upgrades
   sudo timedatectl set-timezone Asia/Phnom_Penh
   ```
4. Install Coolify with the official script from <https://coolify.io/docs/installation>.
5. Firewall: allow 22, 80 and 443. Allow 8000 (Coolify dashboard) only from your own IP:
   ```bash
   sudo ufw allow 22 && sudo ufw allow 80 && sudo ufw allow 443
   sudo ufw allow from <your-ip> to any port 8000
   sudo ufw enable
   ```
   Docker publishes ports past ufw, so also restrict 8000 in your VPS provider's firewall, or give Coolify its own domain with HTTPS and close 8000.

## 2. Database

1. In Coolify: **New resource → Database → PostgreSQL 17**. Leave "publicly accessible" **off**.
2. Start it and copy the **internal** connection URL (`postgres://…@<container-name>:5432/…`).
3. **Backups** tab:
   - Add S3 storage first (Coolify → Storages): Cloudflare R2 or Backblaze B2 endpoint, bucket, access key and secret.
   - Schedule `0 2 * * *`, save to S3, keep **14** in S3 and **3** locally.
   - Press **Backup now** and check that a file appears in the bucket.
4. Do a test restore now, following [restore.md](restore.md). A backup you have never restored is not a backup.

## 3. App

1. **New resource → Application** from your GitHub repository, branch `main`, build pack **Dockerfile**, port **3000**.
2. Environment variables (same names as `.env.example`):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | the internal URL from step 2 |
   | `BETTER_AUTH_SECRET` | output of `openssl rand -base64 32` |
   | `BETTER_AUTH_URL` | `https://pos.<your-domain>` |
   | `STORAGE_DRIVER` | `s3` |
   | `S3_REGION`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL` | your R2 bucket for product images (a different bucket from the backups) |

3. Domain: point a DNS `A` record for `pos.<your-domain>` at the VPS, and enter `https://pos.<your-domain>` in the app's domain field. Coolify gets the Let's Encrypt certificate.
4. Health check: path `/api/health`, port 3000 (the image also has its own `HEALTHCHECK`).
5. Turn on **auto deploy** for pushes to `main`, then **Deploy**.

What happens on each deploy: the image is built, the new container starts, **applies pending database migrations**, and only then accepts requests. If a migration fails, the container exits and Coolify keeps the old version running.

## 4. First login

The image doesn't contain the seed script, so create the first owner from your laptop, once, through an SSH tunnel to the database.

On the server, find the database container's IP:

```bash
docker inspect <postgres-container> | grep IPAddress
```

On your laptop, open the tunnel and leave it running:

```bash
ssh -L 5433:<postgres-container-ip>:5432 root@<vps-ip>
```

In a second terminal, in this repo:

```bash
DATABASE_URL=postgres://<user>:<password>@localhost:5433/<db> SEED_OWNER_EMAIL=you@example.com SEED_OWNER_PASSWORD='<a long password>' pnpm db:seed
```

Open `https://pos.<your-domain>`, sign in, and change the password under **My account**.

Never run `pnpm db:reset` against production: it drops every table. It refuses when `NODE_ENV=production` or the host isn't `localhost`, but a tunnel looks like `localhost`, so close the tunnel as soon as the seed has finished.

## 5. Check the result

- `https://pos.<your-domain>/api/health` answers `200`.
- You can sign in over HTTPS, and a product image upload works.
- A backup file is in the S3 bucket, and the test restore worked.
- Coolify notifications (Settings → Notifications: email or Telegram) are on for failed deploys and failed backups.
- An uptime monitor (UptimeRobot, Better Stack…) checks `/api/health` every few minutes.
