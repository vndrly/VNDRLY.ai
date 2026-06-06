#!/usr/bin/env node
import { Client } from "ssh2";
import { loadVpsSshConfig } from "./ssh-vps-config.mjs";

const cfg = loadVpsSshConfig();
const cmd = `sudo journalctl -u vndrly-api --since '48 hours ago' --no-pager | grep -E '/comments|ticket_note|duplicate key|Internal server' | tail -60`;

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
