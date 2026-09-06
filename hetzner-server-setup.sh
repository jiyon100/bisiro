#!/bin/bash
# ============================================================
# AutoReply PH — Hetzner Server Setup Script
# ============================================================
# Run this ONCE on a fresh Hetzner Ubuntu 24.04 server (as root).
#
# What this does:
#   1. Updates the system
#   2. Creates a non-root user for running the app (security best practice)
#   3. Installs Node.js (for your Express backend)
#   4. Installs PostgreSQL (FREE — this replaces DO's $15/mo managed database)
#   5. Creates your app's database + database user
#   6. Sets up a firewall (only allows SSH, HTTP, HTTPS)
#   7. Installs PM2 (keeps your Node app running 24/7, restarts on crash)
#   8. Installs Nginx (reverse proxy — lets Facebook reach your app on port 443)
#   9. Sets up FREE SSL certificate via Let's Encrypt
#   10. Sets up automated daily database backups (free, local — upgrade to
#       Hetzner Storage Box later for offsite backups)
#
# BEFORE RUNNING:
#   - Replace the placeholder values in the "CONFIGURE THESE" section below
#   - Make sure you have a domain name pointed at your server's IP
#     (Facebook webhooks require HTTPS with a real domain, not just an IP)
#
# HOW TO RUN:
#   1. SSH into your new Hetzner server: ssh root@YOUR_SERVER_IP
#   2. Upload this script (or paste its contents into a file called setup.sh)
#   3. chmod +x setup.sh
#   4. ./setup.sh
# ============================================================

set -e  # stop the script immediately if any command fails

# ---------- CONFIGURE THESE ----------
APP_USER="autoreply"                  # non-root user that will run your app
DB_NAME="autoreply_ph"                # your app's database name
DB_USER="autoreply_app"               # database user your app connects as
DB_PASSWORD="CHANGE_THIS_PASSWORD"    # use a strong random password!
DOMAIN="yourdomain.com"               # your domain (must point to this server's IP)
EMAIL="you@example.com"               # used for SSL certificate renewal notices
# --------------------------------------

echo "=== Step 1: Updating system ==="
apt-get update && apt-get upgrade -y

echo "=== Step 2: Creating non-root app user ==="
if ! id "$APP_USER" &>/dev/null; then
    adduser --disabled-password --gecos "" "$APP_USER"
    usermod -aG sudo "$APP_USER"
    echo "Created user: $APP_USER"
else
    echo "User $APP_USER already exists, skipping"
fi

echo "=== Step 3: Installing Node.js (LTS) ==="
curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
apt-get install -y nodejs
node -v
npm -v

echo "=== Step 4: Installing PostgreSQL ==="
apt-get install -y postgresql postgresql-contrib
systemctl enable postgresql
systemctl start postgresql

echo "=== Step 5: Creating database and app user ==="
sudo -u postgres psql <<EOF
CREATE DATABASE ${DB_NAME};
CREATE USER ${DB_USER} WITH ENCRYPTED PASSWORD '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
ALTER DATABASE ${DB_NAME} OWNER TO ${DB_USER};
EOF
echo "Database '${DB_NAME}' and user '${DB_USER}' created."

echo "=== Step 6: Setting up firewall (UFW) ==="
apt-get install -y ufw
ufw allow OpenSSH
ufw allow 'Nginx Full'   # opens ports 80 (HTTP) and 443 (HTTPS)
ufw --force enable
ufw status

echo "=== Step 7: Installing PM2 (process manager) ==="
npm install -g pm2
# Configure PM2 to start on boot, running as the app user
env PATH=$PATH:/usr/bin pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" | tail -n 1 | bash

echo "=== Step 8: Installing Nginx (reverse proxy) ==="
apt-get install -y nginx

# Create an Nginx config that forwards requests to your Node app (port 3000)
cat > /etc/nginx/sites-available/autoreply <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

ln -sf /etc/nginx/sites-available/autoreply /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx

echo "=== Step 9: Installing FREE SSL certificate (Let's Encrypt) ==="
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m "${EMAIL}" --redirect
echo "SSL certificate installed. Certbot will auto-renew it."

echo "=== Step 10: Setting up automated daily database backups ==="
mkdir -p /home/$APP_USER/backups
cat > /home/$APP_USER/backup-db.sh <<EOF
#!/bin/bash
# Daily PostgreSQL backup script
TIMESTAMP=\$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_DIR="/home/$APP_USER/backups"
PGPASSWORD='${DB_PASSWORD}' pg_dump -U ${DB_USER} -h localhost ${DB_NAME} | gzip > "\$BACKUP_DIR/${DB_NAME}_\$TIMESTAMP.sql.gz"

# Delete backups older than 14 days to save disk space
find "\$BACKUP_DIR" -name "*.sql.gz" -mtime +14 -delete
EOF
chmod +x /home/$APP_USER/backup-db.sh
chown -R $APP_USER:$APP_USER /home/$APP_USER/backups /home/$APP_USER/backup-db.sh

# Run the backup daily at 2 AM via cron
(crontab -u $APP_USER -l 2>/dev/null; echo "0 2 * * * /home/$APP_USER/backup-db.sh") | crontab -u $APP_USER -

echo ""
echo "============================================================"
echo " SETUP COMPLETE"
echo "============================================================"
echo "Database name:     ${DB_NAME}"
echo "Database user:     ${DB_USER}"
echo "Database password: (the one you set above — keep it secret!)"
echo ""
echo "Your app's DATABASE_URL for .env file:"
echo "  postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}"
echo ""
echo "Next steps:"
echo "  1. Switch to the app user:  su - ${APP_USER}"
echo "  2. Upload/clone your Node.js app code"
echo "  3. Create your .env file with the DATABASE_URL above"
echo "  4. npm install"
echo "  5. Start your app with PM2: pm2 start server.js --name autoreply"
echo "  6. pm2 save   (so it restarts automatically on reboot)"
echo ""
echo "Daily backups will run at 2 AM, saved to /home/${APP_USER}/backups"
echo "============================================================"
