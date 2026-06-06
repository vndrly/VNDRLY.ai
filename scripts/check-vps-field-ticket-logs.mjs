#!/usr/bin/env node
import { Client } from "ssh2";
import { loadVpsSshConfig } from "./ssh-vps-config.mjs";

const cfg = loadVpsSshConfig();
const cmd = `sudo journalctl -u vndrly-api --since '48 hours ago' --no-pager 2>/dev/null | tail -200`;

const conn = new Client();
conn.on("ready", () => {
  conn.exec(cmd, (err, stream) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    let out = "";
    stream.on("data", (d) => {
      out += d.toString();
    });
    stream.stderr.on("data", (d) => process.stderr.write(d));
    stream.on("close", () => {
      const lines = out.split("\n");
      const hits = lines.filter((l) =>
        /field\/tickets|field\.tickets|duplicate key|pkey|500|Error|error/i.test(l),
      );
      console.log(hits.slice(-50).join("\n") || "(no matching log lines)");
      conn.end();
    });
  });
});
conn.on("error", (e) => {
  console.error(e.message);
  process.exit(1);
});
conn.connect(cfg);
