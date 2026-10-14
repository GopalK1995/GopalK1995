# Self-hosted n8n

Docker Compose stack: n8n + Postgres + Caddy (automatic HTTPS via Let's Encrypt).

## Deploy (any Linux VPS with Docker, ports 80/443 open)

1. Point a DNS A record (e.g. `n8n.yourdomain.com`) at the server's IP.
2. Copy this folder to the server, then:
   ```bash
   cp .env.example .env
   # edit .env: set N8N_HOST, then generate secrets:
   #   openssl rand -hex 24   -> POSTGRES_PASSWORD
   #   openssl rand -hex 32   -> N8N_ENCRYPTION_KEY
   docker compose up -d
   ```
3. Open `https://<N8N_HOST>` and create the owner account.

## Operations

- Logs: `docker compose logs -f n8n`
- Upgrade: bump `N8N_VERSION`, then `docker compose pull && docker compose up -d`
- Backup: `docker compose exec -T postgres pg_dump -U n8n n8n > n8n-backup.sql`
  and keep a copy of `.env` (the encryption key is required to restore credentials).
- Local test without a domain: set `N8N_HOST=localhost`; Caddy serves a local self-signed cert.
