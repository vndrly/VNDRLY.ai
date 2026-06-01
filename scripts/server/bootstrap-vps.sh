#!/usr/bin/env bash
# One-time VPS bootstrap for vndrly.ai (Ubuntu/Debian). Run as root over SSH.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/vndrly}"
APP_USER="${APP_USER:-vndrly}"
REPO_URL="${REPO_URL:-https://github.com/jelerick2/VNDRLY.ai.git}"
NODE_MAJOR="${NODE_MAJOR:-22}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git nginx certbot python3-certbot-nginx ufw build-essential

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt "$NODE_MAJOR" ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable
  corepack prepare pnpm@9.15.9 --activate
fi

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

id "$APP_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$APP_USER"
mkdir -p "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$(dirname "$APP_DIR")"

if [[ ! -d "$APP_DIR/.git" ]]; then
  sudo -u "$APP_USER" git clone "$REPO_URL" "$APP_DIR"
fi

cat >/etc/nginx/sites-available/vndrly.ai <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name vndrly.ai www.vndrly.ai;

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        root /var/www/vndrly/artifacts/vndrly/dist/public;
        try_files $uri $uri/ /index.html;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/vndrly.ai /etc/nginx/sites-enabled/vndrly.ai
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl restart nginx

ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

cat >/etc/systemd/system/vndrly-api.service <<SYSTEMD
[Unit]
Description=VNDRLY API
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env.production
ExecStart=/usr/bin/node --enable-source-maps $APP_DIR/artifacts/api-server/dist/index.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SYSTEMD

systemctl daemon-reload
echo "Bootstrap complete. Next: write $APP_DIR/.env.production, build, enable service, certbot."
