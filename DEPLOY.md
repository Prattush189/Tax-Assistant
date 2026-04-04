# Production Deploy Guide

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
