#!/usr/bin/env node
/**
 * Patched fork of cursor-bridge@1.9.0 for VNDRLY / Windows:
 * - Reads Cursor auth from %APPDATA%\\Cursor\\...\\state.vscdb (not macOS-only path)
 * - Uses better-sqlite3 instead of sqlite3 CLI
 * - Windows-safe git shell commands (no 2>/dev/null)
 * - Stable pair code: no console.clear on reconnect; backoff after disconnect
 * - Stops aggressive 3s reconnect loop once mobile is paired
 */
import WebSocket from "ws";
import { execSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  statSync,
  copyFileSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import chalk from "chalk";
import initSqlJs from "sql.js";

const BRIDGE_URL = "wss://cursor-226b2ae97542.herokuapp.com";
const PAIR_CODE = generatePairCode();
const WORKSPACE = process.cwd();

function generatePairCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function getCursorDbPath() {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    const winPath = join(appData, "Cursor", "User", "globalStorage", "state.vscdb");
    if (existsSync(winPath)) return winPath;
  }
  const macPath = join(
    homedir(),
    "Library",
    "Application Support",
    "Cursor",
    "User",
    "globalStorage",
    "state.vscdb",
  );
  if (existsSync(macPath)) return macPath;
  const linuxPath = join(
    homedir(),
    ".config",
    "Cursor",
    "User",
    "globalStorage",
    "state.vscdb",
  );
  if (existsSync(linuxPath)) return linuxPath;
  return null;
}

async function queryCursorDb(dbPath, key) {
  const SQL = await initSqlJs();
  let bytes;
  try {
    bytes = readFileSync(dbPath);
  } catch {
    const tmp = join(tmpdir(), `cursor-bridge-${process.pid}.vscdb`);
    copyFileSync(dbPath, tmp);
    try {
      bytes = readFileSync(tmp);
    } finally {
      try {
        unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  }
  const db = new SQL.Database(bytes);
  const stmt = db.prepare("SELECT value FROM ItemTable WHERE key = ?");
  stmt.bind([key]);
  let value = "";
  if (stmt.step()) {
    value = String(stmt.get()[0] ?? "");
  }
  stmt.free();
  db.close();
  return value.replace(/^"|"$/g, "");
}

async function getCursorAuthFromDB() {
  const dbPath = getCursorDbPath();
  if (!dbPath) {
    console.log(
      chalk.hex("#EF4444")("  ✗ ") +
        chalk.gray("Cursor database not found. Is Cursor installed and signed in?"),
    );
    return null;
  }

  try {
    const accessToken = await queryCursorDb(dbPath, "cursorAuth/accessToken");
    const refreshToken = await queryCursorDb(dbPath, "cursorAuth/refreshToken");
    const machineId = await queryCursorDb(dbPath, "storage.serviceMachineId");
    const macMachineId =
      (await queryCursorDb(dbPath, "storage.macMachineId")) || undefined;

    if (!accessToken || !refreshToken) {
      console.log(
        chalk.hex("#EF4444")("  ✗ ") +
          chalk.gray("Not logged into Cursor. Open Cursor and sign in first."),
      );
      return null;
    }

    return { accessToken, refreshToken, machineId, macMachineId };
  } catch (err) {
    console.log(
      chalk.hex("#EF4444")("  ✗ ") +
        chalk.gray(
          `Failed to read Cursor auth (${err instanceof Error ? err.message : err}). Close Cursor and retry.`,
        ),
    );
    return null;
  }
}

function gitQuiet(args, cwd = WORKSPACE) {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
  } catch {
    return "";
  }
}

const cursorAuth = await getCursorAuthFromDB();

function executeToolCall(tool, params) {
  try {
    switch (tool) {
      case 5: {
        const filePath = resolve(WORKSPACE, String(params.path || ""));
        if (!existsSync(filePath)) {
          return { contents: `Error: File not found: ${params.path}` };
        }
        return { contents: readFileSync(filePath, "utf-8") };
      }
      case 6: {
        const dirPath = resolve(WORKSPACE, String(params.path || "."));
        if (!existsSync(dirPath)) {
          return { files: `Error: Directory not found: ${params.path}` };
        }
        const lines = readdirSync(dirPath).map((e) => {
          try {
            const s = statSync(join(dirPath, e));
            return s.isDirectory() ? `${e}/` : e;
          } catch {
            return e;
          }
        });
        return { files: lines.join("\n") };
      }
      case 7: {
        const editPath = resolve(WORKSPACE, String(params.path || ""));
        const oldStr = String(params.oldString ?? "");
        const newStr = String(params.newString ?? "");
        if (!existsSync(editPath)) return { isApplied: false };
        let content = readFileSync(editPath, "utf-8");
        if (oldStr && content.includes(oldStr)) {
          content = content.replace(oldStr, newStr);
          writeFileSync(editPath, content, "utf-8");
          return { isApplied: true };
        }
        return { isApplied: false };
      }
      case 15: {
        const cmd = String(params.command || "");
        const cwd = resolve(WORKSPACE, String(params.cwd || "."));
        try {
          const output = execSync(cmd, {
            cwd,
            encoding: "utf-8",
            timeout: 30000,
            maxBuffer: 1024 * 1024,
            windowsHide: true,
          });
          return { output, exitCode: 0 };
        } catch (err) {
          return {
            output: err.stdout || err.stderr || err.message,
            exitCode: err.status || 1,
          };
        }
      }
      case 3: {
        const query = String(params.query || "").replace(/"/g, '\\"');
        const rg = process.platform === "win32" ? "rg" : "rg";
        try {
          const output = execSync(
            `${rg} -n "${query}" -g "*.{ts,tsx,js,jsx,py,go,rs}" -m 50 .`,
            { cwd: WORKSPACE, encoding: "utf-8", timeout: 10000, windowsHide: true },
          );
          return { output: output || "No matches found" };
        } catch {
          return { output: "No matches found" };
        }
      }
      case 8: {
        const searchQuery = String(params.query || "").replace(/"/g, "");
        try {
          if (process.platform === "win32") {
            const output = execSync(
              `rg --files -g "*${searchQuery}*" -g "!node_modules/**" -g "!.git/**" .`,
              { cwd: WORKSPACE, encoding: "utf-8", timeout: 10000, windowsHide: true },
            );
            return { output: output.split("\n").slice(0, 20).join("\n") || "No files found" };
          }
          const output = execSync(
            `find . -name "*${searchQuery}*" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | head -20`,
            { cwd: WORKSPACE, encoding: "utf-8", timeout: 10000 },
          );
          return { output: output || "No files found" };
        } catch {
          return { output: "No files found" };
        }
      }
      default:
        return { error: `Unsupported tool: ${tool}` };
    }
  } catch (err) {
    return { error: err.message || "Tool execution failed" };
  }
}

let ws = null;
let reconnectTimer = null;
let isPaired = false;
let reconnectAttempts = 0;
let bannerShown = false;
let shuttingDown = false;

function banner() {
  if (!bannerShown) {
    console.clear();
    bannerShown = true;
  }
  console.log("");
  console.log(chalk.hex("#A855F7").bold("  ╔══════════════════════════════════════╗"));
  console.log(
    chalk.hex("#A855F7").bold("  ║") +
      chalk.white.bold("   IDE For Cursor — Mobile Bridge   ") +
      chalk.hex("#A855F7").bold("║"),
  );
  console.log(chalk.hex("#A855F7").bold("  ╚══════════════════════════════════════╝"));
  console.log("");
  console.log(chalk.gray("  Enter this code in the IDE For Cursor iOS app:"));
  console.log("");
  console.log(
    "  " + chalk.bgHex("#A855F7").white.bold(` ${PAIR_CODE.split("").join(" ")} `),
  );
  console.log("");
  console.log(chalk.gray("  (Code stays the same until you stop this bridge.)"));
  console.log("");
  console.log(chalk.gray("  ─────────────────────────────────────────"));
  if (cursorAuth) {
    console.log(chalk.hex("#22C55E")("  ✓ ") + chalk.white("Cursor auth detected"));
    console.log(
      chalk.gray("  Mode: ") + chalk.white("Direct API (works without Cursor open)"),
    );
  } else {
    console.log(
      chalk.hex("#F59E0B")("  ⚠ ") +
        chalk.gray("No Cursor auth — pairing may fail or be limited"),
    );
  }
  console.log(chalk.gray("  ─────────────────────────────────────────"));
  console.log("");
}

function sendPairAndAuth() {
  ws.send(
    JSON.stringify({
      type: "pair",
      payload: { pairCode: PAIR_CODE, clientType: "desktop" },
      timestamp: Date.now(),
    }),
  );

  const repoUrl = gitQuiet("remote get-url origin");
  if (cursorAuth) {
    ws.send(
      JSON.stringify({
        type: "auth",
        payload: { ...cursorAuth, repoUrl },
        timestamp: Date.now(),
      }),
    );
    console.log(chalk.hex("#22C55E")("  ✓ ") + chalk.white("Cursor auth sent to bridge"));
  }

  if (repoUrl) {
    const branch = gitQuiet("branch --show-current") || "main";
    ws.send(
      JSON.stringify({
        type: "setup_workspace",
        payload: { repoUrl, branch },
        timestamp: Date.now(),
      }),
    );
    console.log(chalk.hex("#22C55E")("  ✓ ") + chalk.white("Repo: ") + chalk.gray(repoUrl));
  }
}

function connect() {
  ws = new WebSocket(BRIDGE_URL);

  ws.on("open", () => {
    reconnectAttempts = 0;
    console.log(chalk.hex("#22C55E")("  ✓ ") + chalk.white("Connected to bridge server"));
    sendPairAndAuth();
    if (!isPaired) {
      console.log(chalk.gray("  Waiting for mobile device to enter the code above..."));
    } else {
      console.log(chalk.gray("  Reconnected — session resumed."));
    }
    console.log("");
  });

  ws.on("message", (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      switch (message.type) {
        case "status": {
          const status = message.payload?.status;
          if (status === "connected") {
            isPaired = true;
            console.log(
              chalk.hex("#22C55E")("  ✓ ") + chalk.white("Mobile device paired successfully!"),
            );
            console.log(chalk.gray("  Ready to receive prompts from mobile."));
            console.log("");
          } else if (status === "disconnected") {
            console.log(
              chalk.hex("#EF4444")("  ✗ ") + chalk.gray("Mobile device disconnected"),
            );
          } else if (status === "auth_stored") {
            console.log(
              chalk.hex("#22C55E")("  ✓ ") + chalk.white("Auth credentials stored on bridge"),
            );
          }
          break;
        }
        case "command": {
          const prompt = String(message.payload?.prompt ?? "");
          console.log(
            chalk.hex("#A855F7")("  → ") +
              chalk.white("Prompt: ") +
              chalk.gray(prompt.substring(0, 80) + (prompt.length > 80 ? "..." : "")),
          );
          break;
        }
        case "tool_call": {
          const toolName = message.payload?.params?.toolName;
          const tool = message.payload?.tool;
          const toolCallId = message.payload?.toolCallId;
          const params = message.payload?.params ?? {};
          console.log(
            chalk.hex("#3B82F6")("  ⚡ ") +
              chalk.white(`Tool: ${toolName}`) +
              chalk.gray(` (${JSON.stringify(params).substring(0, 60)})`),
          );
          const result = executeToolCall(tool, params);
          ws.send(
            JSON.stringify({
              type: "tool_result",
              payload: { tool, toolCallId, result },
              timestamp: Date.now(),
            }),
          );
          console.log(chalk.hex("#22C55E")("  ✓ ") + chalk.gray("Tool result sent"));
          break;
        }
        case "error": {
          console.log(
            chalk.hex("#EF4444")("  ✗ ") +
              chalk.gray(String(message.payload?.message ?? "Unknown error")),
          );
          break;
        }
      }
    } catch {
      console.warn(chalk.gray("  Invalid message received"));
    }
  });

  ws.on("close", () => {
    if (shuttingDown) return;
    console.log(
      chalk.hex("#EF4444")("  ✗ ") + chalk.gray("Disconnected from bridge server"),
    );
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    console.error(
      chalk.hex("#EF4444")("  ✗ ") + chalk.gray(`Connection error: ${err.message}`),
    );
  });
}

function scheduleReconnect() {
  if (shuttingDown || reconnectTimer) return;
  reconnectAttempts += 1;
  const delaySec = isPaired
    ? Math.min(30, 5 * reconnectAttempts)
    : Math.min(15, 3 * reconnectAttempts);
  console.log(
    chalk.gray(`  Reconnecting in ${delaySec}s... (pair code unchanged: ${PAIR_CODE})`),
  );
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delaySec * 1000);
}

banner();
connect();

process.on("SIGINT", () => {
  shuttingDown = true;
  console.log("");
  console.log(chalk.gray("  Bridge stopped."));
  if (reconnectTimer) clearTimeout(reconnectTimer);
  ws?.close();
  process.exit(0);
});
