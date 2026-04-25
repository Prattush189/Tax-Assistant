# Production Deploy Guide

## Persistent storage (READ THIS FIRST)

The app keeps **everything** in one SQLite file: users, chats, messages,
profiles, bank statements, and the per-key Gemini search-quota counters
(`search_quota` table — drives the dashboard you see on the admin page).

By default the DB lives at `<repo>/data/tax-assistant.db`, and `.gitignore`
excludes `/data/`. So if your deploy pipeline does any of:

- fresh `git clone` into a new directory each deploy
- `git clean -fdx` (wipes ignored files)
- runs on ephemeral storage (Vercel/Netlify/Railway free tier)

…the DB file is gone after every push and **all counters reset to 0**.

**Fix:** point `DB_PATH` to a stable absolute path outside the deploy directory.

```bash
# in your production .env
DB_PATH=/var/lib/tax-assistant/tax-assistant.db
```

`mkdir -p /var/lib/tax-assistant` once on the server (and `chown` it to the
PM2 user). The boot log prints `[db] using SQLite file: <path>` so you can
verify it lands where you expect.

## Server: aaPanel + Apache + PM2

### Prerequisites

Enable Apache proxy modules on the server (run once):

```bash
sudo a2enmod proxy proxy_http
sudo systemctl restart apache2
```

### PM2 Start

```bash
cd /path/to/tax-assistant
npm run build
pm2 start ecosystem.config.cjs --env production
pm2 save  # persist across server reboots
```

### Apache VirtualHost config

Add to the VirtualHost block for ai.smartbizin.com:

```apache
ProxyPreserveHost On

# Route only /api/* to Express — all other requests served from dist/
ProxyPass /api http://127.0.0.1:4001/api
ProxyPassReverse /api http://127.0.0.1:4001/api

# Disable response buffering for SSE — without this, chat streaming won't work
<Location /api/chat>
  ProxyBufferSize 4096
  ProxyBusyBuffersSize 4096
</Location>

# Serve Vite build output
DocumentRoot /www/wwwroot/ai.smartbizin.com/dist
<Directory /www/wwwroot/ai.smartbizin.com/dist>
  Options -Indexes
  AllowOverride All
  Require all granted
  FallbackResource /index.html
</Directory>
```
