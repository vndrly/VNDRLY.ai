#!/usr/bin/env node
import { Client } from "ssh2";
import { loadVpsSshConfig } from "./ssh-vps-config.mjs";

const cfg = loadVpsSshConfig();

const cmd = [
  "curl -sS http://127.0.0.1:8080/api/healthz || echo API_DOWN",
  "sudo systemctl is-active vndrly-api || true",
  "sudo nginx -t 2>&1",
  "sudo certbot --nginx -d vndrly.ai -d www.vndrly.ai --non-interactive --agree-tos -m admin@vndrly.ai --redirect 2>&1",
  "curl -sS https://vndrly.ai/api/healthz || echo HTTPS_FAIL",
].join(" && echo '---' && ");

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
