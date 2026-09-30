#!/usr/bin/env node
/**
 * SSH deploy to GoDaddy VPS after git push. Reads API Keys and Secrets/GoDaddy.env + Supabase.env.
 */
import { Client } from "ssh2";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  ROOT,
  godaddyEnvPath,
  mapboxEnvPath,
  massiveEnvPath,
  openAiEnvPath,
  sendGridEnvPath,
  supabaseEnvPath,
  twilioEnvPath,
} from "./secrets-path.mjs";
import { buildApiMigrationAndRestartCommands } from "./plate-state-migration.mjs";
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
  const gd = parseEnvFile(godaddyEnvPath());
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

  const supabasePath = supabaseEnvPath();
  let dbPassword = gd.supabase_password;
  if (!dbPassword && existsSync(supabasePath)) {
    const raw = readFileSync(supabasePath, "utf8");
    const m = raw.match(/password is:\s*(\S+)/i);
    if (m) dbPassword = m[1];
  }

  if (!host) {
    throw new Error(
      "Missing VPS IP. Run: pnpm run setup:vps (or add vps_ip to API Keys and Secrets/GoDaddy.env)",
    );
  }
  if (!password) {
    throw new Error(
      "Missing SSH password. Add ssh_pass to API Keys and Secrets/GoDaddy.env (VPS admin password from GoDaddy setup).",
    );
  }
  if (!dbPassword) {
    throw new Error(
      "Missing Supabase password in API Keys and Secrets/Supabase.env",
    );
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

function shQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

function envValue(env, key) {
  return env[key] ?? env[key.toLowerCase()] ?? "";
}

async function main() {
  const cfg = loadDeployConfig();
  const localEnv = existsSync(path.join(ROOT, ".env.local"))
    ? readFileSync(path.join(ROOT, ".env.local"), "utf8")
    : "";

  let sessionSecret = process.env.SESSION_SECRET?.trim() ?? "";
  const secMatch = localEnv.match(/^SESSION_SECRET=(.+)$/m);
  if (secMatch && !secMatch[1].includes("local-dev")) {
    sessionSecret = secMatch[1].trim();
  }

  let anthropicKey = "";
  const akMatch = localEnv.match(/^AI_INTEGRATIONS_ANTHROPIC_API_KEY=(.+)$/m);
  if (akMatch) anthropicKey = akMatch[1].trim();

  const openAiEnv = parseEnvFile(openAiEnvPath());
  let openaiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  const oaiMatch = localEnv.match(/^OPENAI_API_KEY=(.+)$/m);
  if (!openaiKey && oaiMatch) openaiKey = oaiMatch[1].trim();
  if (!openaiKey) openaiKey = envValue(openAiEnv, "OPENAI_API_KEY").trim();

  const finnhubKey =
    localEnv.match(/^FINNHUB_API_KEY=(.+)$/m)?.[1]?.trim() ?? "";
  const alphaVantageKey =
    localEnv.match(/^ALPHA_VANTAGE_API_KEY=(.+)$/m)?.[1]?.trim() ?? "";
  const massivePath = massiveEnvPath();
  const massiveEnv = parseEnvFile(massivePath);
  const massiveRaw = existsSync(massivePath)
    ? readFileSync(massivePath, "utf8").trim()
    : "";
  const massiveKey =
    localEnv.match(/^MASSIVE_API_KEY=(.+)$/m)?.[1]?.trim() ??
    envValue(massiveEnv, "MASSIVE_API_KEY").trim() ??
    (/^[A-Za-z0-9_-]+$/.test(massiveRaw) ? massiveRaw : "");
  const mapboxEnv = parseEnvFile(mapboxEnvPath());
  const mapboxAccessToken =
    localEnv.match(/^MAPBOX_ACCESS_TOKEN=(.+)$/m)?.[1]?.trim() ??
    localEnv.match(/^MAPBOX_API_KEY=(.+)$/m)?.[1]?.trim() ??
    mapboxEnv.mapbox_access_token ??
    mapboxEnv.mapbox_api_key ??
    mapboxEnv.api ??
    "";
  const twilioEnv = parseEnvFile(twilioEnvPath());
  const twilioAccountSid =
    localEnv.match(/^TWILIO_ACCOUNT_SID=(.+)$/m)?.[1]?.trim() ??
    envValue(twilioEnv, "TWILIO_ACCOUNT_SID") ??
    "";
  const twilioApiKey =
    localEnv.match(/^TWILIO_API_KEY=(.+)$/m)?.[1]?.trim() ??
    envValue(twilioEnv, "TWILIO_API_KEY") ??
    "";
  const twilioApiSecret =
    localEnv.match(/^TWILIO_API_SECRET=(.+)$/m)?.[1]?.trim() ??
    envValue(twilioEnv, "TWILIO_API_SECRET") ??
    "";
  const twilioPhoneNumber =
    localEnv.match(/^TWILIO_PHONE_NUMBER=(.+)$/m)?.[1]?.trim() ??
    envValue(twilioEnv, "TWILIO_PHONE_NUMBER") ??
    "";
  const twilioMessagingServiceSid =
    localEnv.match(/^TWILIO_MESSAGING_SERVICE_SID=(.+)$/m)?.[1]?.trim() ??
    envValue(twilioEnv, "TWILIO_MESSAGING_SERVICE_SID") ??
    "";
  const twilioSenderRegistrationStatus =
    localEnv.match(/^TWILIO_SENDER_REGISTRATION_STATUS=(.+)$/m)?.[1]?.trim() ??
    envValue(twilioEnv, "TWILIO_SENDER_REGISTRATION_STATUS") ??
    "";
  const twilioA2pStatus =
    localEnv.match(/^TWILIO_A2P_STATUS=(.+)$/m)?.[1]?.trim() ??
    envValue(twilioEnv, "TWILIO_A2P_STATUS") ??
    "";
  const twilioTollFreeVerificationStatus =
    localEnv
      .match(/^TWILIO_TOLL_FREE_VERIFICATION_STATUS=(.+)$/m)?.[1]
      ?.trim() ??
    envValue(twilioEnv, "TWILIO_TOLL_FREE_VERIFICATION_STATUS") ??
    "";
  const sendGridEnv = parseEnvFile(sendGridEnvPath());
  const sendGridApiKey =
    localEnv.match(/^SENDGRID_API_KEY=(.+)$/m)?.[1]?.trim() ??
    envValue(sendGridEnv, "SENDGRID_API_KEY") ??
    "";
  const sendGridFromEmail =
    localEnv.match(/^SENDGRID_FROM_EMAIL=(.+)$/m)?.[1]?.trim() ??
    envValue(sendGridEnv, "SENDGRID_FROM_EMAIL") ??
    "";
  const sendGridFromName =
    localEnv.match(/^SENDGRID_FROM_NAME=(.+)$/m)?.[1]?.trim() ??
    envValue(sendGridEnv, "SENDGRID_FROM_NAME") ??
    "";
  const sendGridReplyTo =
    localEnv.match(/^SENDGRID_REPLY_TO=(.+)$/m)?.[1]?.trim() ??
    envValue(sendGridEnv, "SENDGRID_REPLY_TO") ??
    "support@vndrly.ai";
  const sendGridSandboxMode =
    localEnv.match(/^SENDGRID_SANDBOX_MODE=(.+)$/m)?.[1]?.trim() ??
    envValue(sendGridEnv, "SENDGRID_SANDBOX_MODE") ??
    "";
  const sendGridDomainAuthenticated =
    localEnv.match(/^SENDGRID_DOMAIN_AUTHENTICATED=(.+)$/m)?.[1]?.trim() ??
    envValue(sendGridEnv, "SENDGRID_DOMAIN_AUTHENTICATED") ??
    "";

  const supabaseEnv = parseEnvFile(supabaseEnvPath());
  const supabaseUrl =
    localEnv.match(/^SUPABASE_URL=(.+)$/m)?.[1]?.trim() ||
    envValue(supabaseEnv, "SUPABASE_URL") ||
    "https://bihjmgbdzbhcnsuhzzwo.supabase.co";
  const supabaseSecretKey =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    localEnv.match(/^SUPABASE_SECRET_KEY=(.+)$/m)?.[1]?.trim() ||
    envValue(supabaseEnv, "SUPABASE_SECRET_KEY") ||
    "";
  const supabaseServiceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    localEnv.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)?.[1]?.trim() ||
    localEnv.match(/^SUPABASE_SERVICE_KEY=(.+)$/m)?.[1]?.trim() ||
    envValue(supabaseEnv, "SUPABASE_SERVICE_ROLE_KEY") ||
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
    supabaseSecretKey ? `SUPABASE_SECRET_KEY=${supabaseSecretKey}` : "",
    supabaseServiceRoleKey
      ? `SUPABASE_SERVICE_ROLE_KEY=${supabaseServiceRoleKey}`
      : "",
    `SUPABASE_STORAGE_BUCKET=${storageBucket}`,
    "AI_INTEGRATIONS_ANTHROPIC_BASE_URL=https://api.anthropic.com",
    anthropicKey ? `AI_INTEGRATIONS_ANTHROPIC_API_KEY=${anthropicKey}` : "",
    openaiKey ? `OPENAI_API_KEY=${openaiKey}` : "",
    finnhubKey ? `FINNHUB_API_KEY=${finnhubKey}` : "",
    alphaVantageKey ? `ALPHA_VANTAGE_API_KEY=${alphaVantageKey}` : "",
    massiveKey ? `MASSIVE_API_KEY=${massiveKey}` : "",
    mapboxAccessToken ? `MAPBOX_ACCESS_TOKEN=${mapboxAccessToken}` : "",
    mapboxAccessToken ? `VITE_MAPBOX_ACCESS_TOKEN=${mapboxAccessToken}` : "",
    twilioAccountSid ? `TWILIO_ACCOUNT_SID=${twilioAccountSid}` : "",
    twilioApiKey ? `TWILIO_API_KEY=${twilioApiKey}` : "",
    twilioApiSecret ? `TWILIO_API_SECRET=${twilioApiSecret}` : "",
    twilioPhoneNumber ? `TWILIO_PHONE_NUMBER=${twilioPhoneNumber}` : "",
    twilioMessagingServiceSid
      ? `TWILIO_MESSAGING_SERVICE_SID=${twilioMessagingServiceSid}`
      : "",
    twilioSenderRegistrationStatus
      ? `TWILIO_SENDER_REGISTRATION_STATUS=${twilioSenderRegistrationStatus}`
      : "",
    twilioA2pStatus ? `TWILIO_A2P_STATUS=${twilioA2pStatus}` : "",
    twilioTollFreeVerificationStatus
      ? `TWILIO_TOLL_FREE_VERIFICATION_STATUS=${twilioTollFreeVerificationStatus}`
      : "",
    sendGridApiKey ? `SENDGRID_API_KEY=${sendGridApiKey}` : "",
    sendGridFromEmail ? `SENDGRID_FROM_EMAIL=${sendGridFromEmail}` : "",
    sendGridFromName ? `SENDGRID_FROM_NAME=${sendGridFromName}` : "",
    sendGridReplyTo ? `SENDGRID_REPLY_TO=${sendGridReplyTo}` : "",
    sendGridSandboxMode ? `SENDGRID_SANDBOX_MODE=${sendGridSandboxMode}` : "",
    sendGridDomainAuthenticated
      ? `SENDGRID_DOMAIN_AUTHENTICATED=${sendGridDomainAuthenticated}`
      : "",
    "OPS_ALERT_EMAIL=admin@vndrly.ai",
    "PUBLIC_APP_URL=https://vndrly.ai",
    "APP_BASE_URL=https://vndrly.ai",
  ].filter(Boolean);

  const bootstrapB64 = b64(
    readFileSync(BOOTSTRAP, "utf8").replace(/\r\n/g, "\n"),
  );
  const nginxB64 = b64(readFileSync(NGINX_SITE, "utf8").replace(/\r\n/g, "\n"));
  const prodEnvB64 = b64(prodEnvLines.join("\n") + "\n");

  console.log(`Deploying to ${cfg.user}@${cfg.host}:${cfg.port} ...`);
  const conn = await sshConnect(cfg);
  const apiMigrationAndRestart = buildApiMigrationAndRestartCommands();

  try {
    const script = `
set -e
APP_DIR=/var/www/vndrly
if [ ! -d "$APP_DIR/.git" ]; then
  echo "First deploy — bootstrapping VPS..."
  echo ${JSON.stringify(bootstrapB64)} | base64 -d | sudo bash
fi
cd "$APP_DIR"
existing_session_secret=""
if [ -f .env.production ]; then
  existing_session_secret="$(sudo sed -n 's/^SESSION_SECRET=//p' .env.production | head -n 1)"
fi
echo ${JSON.stringify(prodEnvB64)} | base64 -d | sudo tee .env.production.new >/dev/null
if [ -f .env.production ]; then
  while IFS= read -r line; do
    case "$line" in
      ""|'#'*) continue ;;
      *=*) key="\${line%%=*}" ;;
      *) continue ;;
    esac
    if ! sudo grep -Fq "\${key}=" .env.production.new; then
      printf '%s\n' "$line" | sudo tee -a .env.production.new >/dev/null
    fi
  done < .env.production
fi
if ! sudo grep -q '^SESSION_SECRET=.' .env.production.new; then
  if [ -z "\${existing_session_secret}" ]; then
    existing_session_secret="$(openssl rand -hex 48)"
  fi
  printf 'SESSION_SECRET=%s\n' "\${existing_session_secret}" | sudo tee -a .env.production.new >/dev/null
fi
sudo mv .env.production.new .env.production
sudo chown vndrly:vndrly .env.production
sudo chmod 600 .env.production
sudo -u vndrly git remote set-url origin https://github.com/vndrly/VNDRLY.ai.git
sudo -u vndrly git fetch origin main
sudo -u vndrly git reset --hard origin/main
export CI=true
${mapboxAccessToken ? `export VITE_MAPBOX_ACCESS_TOKEN=${shQuote(mapboxAccessToken)}` : ""}
sudo -u vndrly env HOME=/home/vndrly pnpm install --frozen-lockfile || sudo -u vndrly env HOME=/home/vndrly pnpm install
sudo -u vndrly env HOME=/home/vndrly BASE_PATH=/ NODE_ENV=production VITE_MAPBOX_ACCESS_TOKEN="$VITE_MAPBOX_ACCESS_TOKEN" pnpm --filter @workspace/vndrly run build
sudo -u vndrly env HOME=/home/vndrly pnpm --filter @workspace/api-server run build
${apiMigrationAndRestart}
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
