#!/usr/bin/env node
/**
 * Raise nginx client_max_body_size so mobile photo uploads reach the API
 * (default nginx 1m → HTTP 413 before Supabase Storage).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "ssh2";
import { loadVpsSshConfig } from "./ssh-vps-config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const nginxConf = readFileSync(
  join(__dirname, "server", "vndrly.ai.nginx.conf"),
  "utf8",
);
const nginxB64 = Buffer.from(nginxConf, "utf8").toString("base64");

const cfg = loadVpsSshConfig();
const cmd = `
set -e
echo ${JSON.stringify(nginxB64)} | base64 -d | sudo tee /etc/nginx/sites-available/vndrly.ai >/dev/null
sudo ln -sf /etc/nginx/sites-available/vndrly.ai /etc/nginx/sites-enabled/vndrly.ai
sudo nginx -t
sudo systemctl reload nginx
echo "nginx upload limit updated to 25m"
`;

const conn = new Client();
conn.on("ready", () => {
  conn.exec(cmd, (err, stream) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    stream.on("data", (d) => process.stdout.write(d));
    stream.stderr.on("data", (d) => process.stderr.write(d));
    stream.on("close", (code) => {
      conn.end();
      process.exit(code ?? 0);
    });
  });
});
conn.on("error", (e) => {
  console.error(e.message);
  process.exit(1);
});
conn.connect(cfg);
