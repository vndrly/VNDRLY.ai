#!/usr/bin/env node
/**
 * Hotfix: copy specific web source files to VPS and rebuild without a full git deploy.
 * Usage: node scripts/hotfix-deploy-login-redirect.mjs [relative-file...]
 */
import { Client } from "ssh2";
import { readFileSync } from "fs";
import path from "path";
import { loadVpsSshConfig, ROOT } from "./ssh-vps-config.mjs";

const cfg = loadVpsSshConfig();

const defaultFiles = [
  "artifacts/vndrly/src/App.tsx",
  "artifacts/vndrly/src/pages/login.tsx",
];

const files = process.argv.slice(2).length > 0 ? process.argv.slice(2) : defaultFiles;

function b64(file) {
  return Buffer.from(readFileSync(path.join(ROOT, file), "utf8")).toString("base64");
}

const writes = files
  .map(
    (f) =>
      `echo ${JSON.stringify(b64(f))} | base64 -d | sudo tee /var/www/vndrly/${f} >/dev/null`,
  )
  .join("\n");

const chownTargets = files.map((f) => `/var/www/vndrly/${f}`).join(" ");

const cmd = `
${writes}
sudo chown -R vndrly:vndrly ${chownTargets}
cd /var/www/vndrly
sudo -u vndrly env HOME=/home/vndrly BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/vndrly run build
sudo systemctl reload nginx
echo DEPLOY_OK
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
conn.connect({ ...cfg, readyTimeout: 300000 });
