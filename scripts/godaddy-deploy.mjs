#!/usr/bin/env node
/**
 * SSH deploy to GoDaddy VPS after git push. Reads Desktop/GoDaddy.env + Supabase.env.
 */
import { Client } from "ssh2";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DESKTOP = path.dirname(ROOT);
const LOCAL_CFG = path.join(ROOT, ".local", "godaddy-vps.json");
const BOOTSTRAP = path.join(ROOT, "scripts/server/bootstrap-vps.sh");
const NGINX_SITE = path.join(ROOT, "scripts/server/vndrly.ai.nginx.conf");

function parseEnvFile(filePath) {
  const out = {};
  if (!existsSync(filePath)) return out;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq !== -1) {
      out[t.slice(0, eq).trim().toLowerCase()] = t.slice(eq + 1).trim();
      continue;
    }
    const parts = t.split(/\s+/);
    if (parts.length >= 2) {
      out[parts[0].toLowerCase()] = parts.slice(1).join(" ");
    }
  }
  return out;
}

function isRealIp(v) {
  if (!v) return false;
  if (/YOUR\.IP|HERE|PLACEHOLDER|X\.X/i.test(v)) return false;
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(String(v).trim());
}

function isRealSecret(v) {
  if (!v) return false;
  return !/YOUR_|PASSWORD|HERE|PLACEHOLDER/i.test(String(v));
}

function loadDeployConfig() {
  const gd = parseEnvFile(process.env.GODADDY_ENV || path.join(DESKTOP, "GoDaddy.env"));
  const local = existsSync(LOCAL_CFG)
    ? JSON.parse(readFileSync(LOCAL_CFG, "utf8"))
    : {};

  const hostCandidate = gd.vps_ip || gd.host || gd.ip || local.ip;
  const host = isRealIp(hostCandidate) ? hostCandidate : null;
  const user = gd.ssh_user || gd.user_ssh || local.sshUser || "root";
  const passCandidate =
    gd.ssh_pass || gd.ssh_password || gd.vps_pass || gd.pass_ssh || gd.pass;
  const password = isRealSecret(passCandidate) ? passCandidate : null;
  const port = Number(gd.ssh_port || local.sshPort || 22);

  const supabasePath = process.env.SUPABASE_ENV || path.join(DESKTOP, "Supabase.env");
  let dbPassword = gd.supabase_password;
  if (!dbPassword && existsSync(supabasePath)) {
    const raw = readFileSync(supabasePath, "utf8");
    const m = raw.match(/password is:\s*(\S+)/i);
    if (m) dbPassword = m[1];
  }

  if (!host) {
    throw new Error(
      "Missing VPS IP. Run: pnpm run setup:vps (or add vps_ip to Desktop/GoDaddy.env)",
    );
  }
  if (!password) {
    throw new Error(
      "Missing SSH password. Add ssh_pass to Desktop/GoDaddy.env (VPS admin password from GoDaddy setup).",
    );
  }
  if (!dbPassword) {
    throw new Error("Missing Supabase password in Desktop/Supabase.env");
  }

  return { host, user, password, port, dbPassword };
}

function sshExec(conn, command) {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stderr = "";
      stream
        .on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`SSH failed (${code}): ${stderr}`));
        })
        .on("data", (d) => process.stdout.write(d));
      stream.stderr.on("data", (d) => {
        stderr += d.toString();
        process.stderr.write(d);
      });
    });
  });
}

function sshConnect(cfg) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on("ready", () => resolve(conn))
      .on("error", reject)
      .connect({
        host: cfg.host,
        port: cfg.port,
        username: cfg.user,
        password: cfg.password,
        readyTimeout: 60000,
      });
  });
}

function b64(s) {
  return Buffer.from(s, "utf8").toString("base64");
}

async function main() {
  const cfg = loadDeployConfig();
  const localEnv = existsSync(path.join(ROOT, ".env.local"))
    ? readFileSync(path.join(ROOT, ".env.local"), "utf8")
    : "";

  let sessionSecret = "vndrly-prod-session-change-me";
  const secMatch = localEnv.match(/^SESSION_SECRET=(.+)$/m);
  if (secMatch && !secMatch[1].includes("local-dev")) {
    sessionSecret = secMatch[1].trim();
  }

  let anthropicKey = "";
  const akMatch = localEnv.match(/^AI_INTEGRATIONS_ANTHROPIC_API_KEY=(.+)$/m);
  if (akMatch) anthropicKey = akMatch[1].trim();

  const sendgridKey =
    localEnv.match(/^SENDGRID_API_KEY=(.+)$/m)?.[1]?.trim() || "";
  const sendgridFrom =
    localEnv.match(/^SENDGRID_FROM_EMAIL=(.+)$/m)?.[1]?.trim() ||
    localEnv.match(/^OPS_ALERT_EMAIL=(.+)$/m)?.[1]?.trim() ||
    "admin@vndrly.ai";

  const supabaseUrl =
    localEnv.match(/^SUPABASE_URL=(.+)$/m)?.[1]?.trim() ||
    "https://bihjmgbdzbhcnsuhzzwo.supabase.co";
  const supabaseServiceKey =
    localEnv.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)?.[1]?.trim() ||
    localEnv.match(/^SUPABASE_SERVICE_KEY=(.+)$/m)?.[1]?.trim() ||
    "";
  const storageBucket =
    localEnv.match(/^SUPABASE_STORAGE_BUCKET=(.+)$/m)?.[1]?.trim() ||
    "vndrly-objects";

  const dbUrl = `postgresql://postgres:${cfg.dbPassword}@db.bihjmgbdzbhcnsuhzzwo.supabase.co:5432/postgres`;
  const prodEnvLines = [
    "NODE_ENV=production",
    "PORT=8080",
    "BASE_PATH=/",
    `DATABASE_URL=${dbUrl}`,
    `SESSION_SECRET=${sessionSecret}`,
    `SUPABASE_URL=${supabaseUrl}`,
    supabaseServiceKey ? `SUPABASE_SERVICE_ROLE_KEY=${supabaseServiceKey}` : "",
    `SUPABASE_STORAGE_BUCKET=${storageBucket}`,
    "AI_INTEGRATIONS_ANTHROPIC_BASE_URL=https://api.anthropic.com",
    anthropicKey ? `AI_INTEGRATIONS_ANTHROPIC_API_KEY=${anthropicKey}` : "",
    sendgridKey ? `SENDGRID_API_KEY=${sendgridKey}` : "",
    sendgridKey ? `SENDGRID_FROM_EMAIL=${sendgridFrom}` : "",
    "OPS_ALERT_EMAIL=admin@vndrly.ai",
  ].filter(Boolean);

  const bootstrapB64 = b64(readFileSync(BOOTSTRAP, "utf8").replace(/\r\n/g, "\n"));
  const nginxB64 = b64(readFileSync(NGINX_SITE, "utf8").replace(/\r\n/g, "\n"));
  const prodEnvB64 = b64(prodEnvLines.join("\n") + "\n");

  console.log(`Deploying to ${cfg.user}@${cfg.host}:${cfg.port} ...`);
  const conn = await sshConnect(cfg);

  try {
    const script = `
set -e
APP_DIR=/var/www/vndrly
if [ ! -d "$APP_DIR/.git" ]; then
  echo "First deploy — bootstrapping VPS..."
  echo ${JSON.stringify(bootstrapB64)} | base64 -d | sudo bash
fi
cd "$APP_DIR"
echo ${JSON.stringify(prodEnvB64)} | base64 -d | sudo tee .env.production >/dev/null
sudo chown vndrly:vndrly .env.production
sudo chmod 600 .env.production
sudo -u vndrly git remote set-url origin https://github.com/vndrly/VNDRLY.ai.git
sudo -u vndrly git fetch origin main
sudo -u vndrly git reset --hard origin/main
export CI=true
sudo -u vndrly env HOME=/home/vndrly pnpm install --frozen-lockfile || sudo -u vndrly env HOME=/home/vndrly pnpm install
sudo -u vndrly env HOME=/home/vndrly BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/vndrly run build
sudo -u vndrly env HOME=/home/vndrly pnpm --filter @workspace/api-server run build
sudo systemctl daemon-reload
sudo systemctl enable vndrly-api 2>/dev/null || true
sudo systemctl restart vndrly-api
echo ${JSON.stringify(nginxB64)} | base64 -d | sudo tee /etc/nginx/sites-available/vndrly.ai >/dev/null
sudo ln -sf /etc/nginx/sites-available/vndrly.ai /etc/nginx/sites-enabled/vndrly.ai
sudo nginx -t
sudo systemctl reload nginx
if ! sudo certbot certificates 2>/dev/null | grep -q vndrly.ai; then
  sudo certbot --nginx -d vndrly.ai -d www.vndrly.ai --non-interactive --agree-tos -m admin@vndrly.ai --redirect || true
fi
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:8080/api/healthz >/dev/null 2>&1; then
    curl -fsS http://127.0.0.1:8080/api/healthz && echo " API OK"
    break
  fi
  sleep 2
done
if ! curl -fsS http://127.0.0.1:8080/api/healthz >/dev/null 2>&1; then
  echo "API health check failed after deploy" >&2
  exit 1
fi
`;
    await sshExec(conn, script);
    console.log("\nDeploy finished.");
  } finally {
    conn.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
