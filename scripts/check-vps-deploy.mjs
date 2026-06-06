#!/usr/bin/env node
import { Client } from "ssh2";
import { loadVpsSshConfig } from "./ssh-vps-config.mjs";

const cfg = loadVpsSshConfig();

const cmd = [
  "cd /var/www/vndrly && git log -1 --oneline",
  "ls -la artifacts/vndrly/dist/public/assets/ 2>/dev/null | head -5",
  "curl -sS -X POST http://127.0.0.1:8080/api/auth/login -H 'Content-Type: application/json' -d '{\"email\":\"bad@test.com\",\"password\":\"wrong\"}' | head -c 200",
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
    stream.on("close", () => conn.end());
  });
});
conn.on("error", (e) => {
  console.error(e.message);
  process.exit(1);
});
conn.connect(cfg);
