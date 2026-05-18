#!/usr/bin/env node
/**
 * Export the VNDRLY commercial to an MP4 file via CHUNKED capture.
 *
 * Why chunked? The Replit workspace's bash tool kills detached processes
 * shortly after the parent shell exits, and its max foreground timeout is
 * 120 s. The full 240 s commercial cannot be captured in a single bash call.
 *
 * Workaround: split the timeline into 3 scene-aligned chunks of <=95 s each.
 * Every chunk is a self-contained Playwright session that:
 *   1. Loads the dev server with ?capture=1&startScene=N
 *   2. Records exactly the duration of the included scenes
 *   3. Cleanly closes the context so the .webm is finalized
 *   4. Returns within ~110 s, well under the bash limit
 *
 * Modes:
 *   node scripts/export-video.mjs chunk <chunkId>     # 1, 2, or 3
 *   node scripts/export-video.mjs finalize            # concat+mux to mp4
 *   node scripts/export-video.mjs all                 # legacy single-shot
 *
 * Output: artifacts/vndrly-commercial/dist/video/vndrly-commercial.mp4
 */
import { spawn } from 'node:child_process';
import { mkdir, rm, readdir, stat, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const VIDEO_OUT_DIR = path.join(DIST_DIR, 'video');
const RAW_DIR = path.join(VIDEO_OUT_DIR, 'raw');
const BASE_PATH = '/vndrly-commercial/';

// Must match SCENE_DURATIONS in src/components/video/VideoTemplate.tsx (ms).
const SCENE_DURATIONS_MS = [
  12000, // 0  hook
  20000, // 1  pain
  10000, // 2  enter
  17000, // 3  principals
  15000, // 4  sites
  15000, // 5  catalog
  22000, // 6  hotlist
  15000, // 7  onboarding
  10000, // 8  dispatch
  27000, // 9  execution
  16000, // 10 crew
  10000, // 11 parts
  12000, // 12 visitors
  11000, // 13 accounting
  14000, // 14 analytics
  14000, // 15 trust
];
const TOTAL_MS = SCENE_DURATIONS_MS.reduce((a, b) => a + b, 0); // 240000

// Scene-aligned chunks (each <=95 s of recording so we fit in bash's 120 s
// foreground timeout). { startScene inclusive, endScene exclusive }
const CHUNKS = [
  { id: 1, startScene: 0, endScene: 6 },   // 89 s
  { id: 2, startScene: 6, endScene: 10 },  // 74 s
  { id: 3, startScene: 10, endScene: 16 }, // 77 s
];

// Small lead so the first frame of each chunk is fully painted before we
// start using its frames. Discarded by ffmpeg trim. No tail needed.
const LEAD_MS = 800;

function log(msg) {
  process.stdout.write(`[export-video] ${msg}\n`);
}

process.on('uncaughtException', (err) => {
  process.stderr.write(`[export-video] UNCAUGHT: ${err?.stack || err}\n`);
  process.exit(2);
});
process.on('unhandledRejection', (err) => {
  process.stderr.write(`[export-video] UNHANDLED: ${err?.stack || err}\n`);
  process.exit(2);
});

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`));
    });
  });
}

async function findLatestWebm(dir) {
  const files = await readdir(dir);
  const webms = [];
  for (const f of files) {
    if (f.endsWith('.webm')) {
      const p = path.join(dir, f);
      const s = await stat(p);
      webms.push({ path: p, mtime: s.mtimeMs, size: s.size });
    }
  }
  webms.sort((a, b) => b.mtime - a.mtime);
  return webms[0] ?? null;
}

function chunkDurationMs(chunk) {
  let ms = 0;
  for (let i = chunk.startScene; i < chunk.endScene; i++) ms += SCENE_DURATIONS_MS[i];
  return ms;
}

function resolveChromiumExecutable() {
  if (process.env.CHROMIUM_EXECUTABLE_PATH) return process.env.CHROMIUM_EXECUTABLE_PATH;
  try {
    const { execSync } = require('node:child_process');
    return execSync('command -v chromium', { encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

async function captureChunk(chunkId) {
  const chunk = CHUNKS.find((c) => c.id === chunkId);
  if (!chunk) throw new Error(`unknown chunk id ${chunkId} (use 1, 2, or 3)`);

  const baseUrl = process.env.EXPORT_BASE_URL || `http://127.0.0.1:80${BASE_PATH}`;
  const probe = await fetch(baseUrl, { method: 'GET' }).catch(() => null);
  if (!probe?.ok) {
    throw new Error(`expected 200 from ${baseUrl} — is the vndrly-commercial workflow running?`);
  }

  await mkdir(RAW_DIR, { recursive: true });
  const chunkDir = path.join(RAW_DIR, `chunk-${chunk.id}`);
  await rm(chunkDir, { recursive: true, force: true });
  await mkdir(chunkDir, { recursive: true });

  const recordMs = chunkDurationMs(chunk);
  log(`chunk ${chunk.id}: scenes [${chunk.startScene}..${chunk.endScene}) → ${(recordMs / 1000).toFixed(1)}s`);

  const { execSync } = await import('node:child_process');
  let executablePath;
  try {
    executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || execSync('command -v chromium', { encoding: 'utf8' }).trim();
  } catch {
    executablePath = undefined;
  }
  log(`launching chromium @ 1280x720 ${executablePath ? `(${executablePath})` : '(playwright bundled)'} ...`);
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-gpu-sandbox',
    ],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
      recordVideo: { dir: chunkDir, size: { width: 1280, height: 720 } },
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => log(`PAGE ERROR: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') log(`PAGE CONSOLE ERR: ${m.text()}`);
    });
    const targetUrl = `${baseUrl}?capture=1&startScene=${chunk.startScene}`;
    log(`opening ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForTimeout(LEAD_MS);

    log(`recording ${(recordMs / 1000).toFixed(1)}s ...`);
    const t0 = Date.now();
    const tick = setInterval(() => {
      const elapsed = Math.round((Date.now() - t0) / 1000);
      log(`  ${elapsed}s / ${Math.round(recordMs / 1000)}s`);
    }, 5000);
    await page.waitForTimeout(recordMs);
    clearInterval(tick);

    log('closing context to flush webm ...');
    await context.close();
  } finally {
    await browser.close().catch(() => {});
  }

  const recorded = await findLatestWebm(chunkDir);
  if (!recorded) throw new Error(`no .webm produced for chunk ${chunk.id}`);
  const finalPath = path.join(RAW_DIR, `chunk-${chunk.id}.webm`);
  await rename(recorded.path, finalPath);
  await rm(chunkDir, { recursive: true, force: true });
  log(`✓ chunk ${chunk.id} → ${finalPath} (${(recorded.size / 1024 / 1024).toFixed(2)} MB)`);
}

async function finalize() {
  // Verify all chunks present
  for (const c of CHUNKS) {
    const p = path.join(RAW_DIR, `chunk-${c.id}.webm`);
    if (!existsSync(p)) throw new Error(`missing chunk file: ${p}`);
  }

  // Step 1: each chunk webm → silent mp4 (trimmed to LEAD_MS offset, exact scene duration)
  const partMp4s = [];
  for (const c of CHUNKS) {
    const inWebm = path.join(RAW_DIR, `chunk-${c.id}.webm`);
    const outMp4 = path.join(RAW_DIR, `chunk-${c.id}.mp4`);
    const dur = chunkDurationMs(c) / 1000;
    log(`transcoding chunk ${c.id} → ${outMp4} (trim ${LEAD_MS}ms, ${dur}s)`);
    await run('ffmpeg', [
      '-y',
      '-ss', (LEAD_MS / 1000).toFixed(3),
      '-i', inWebm,
      '-t', dur.toFixed(3),
      '-vf', 'scale=1920:1080:flags=lanczos,fps=30',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-an',
      outMp4,
    ]);
    partMp4s.push(outMp4);
  }

  // Step 2: concat the part mp4s into one silent mp4
  const concatList = path.join(RAW_DIR, 'concat.txt');
  await writeFile(concatList, partMp4s.map((p) => `file '${p}'`).join('\n'));
  const silentMp4 = path.join(VIDEO_OUT_DIR, 'silent.mp4');
  log(`concatenating ${partMp4s.length} parts → ${silentMp4}`);
  await run('ffmpeg', [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatList,
    '-c', 'copy',
    silentMp4,
  ]);

  // Step 3: mux voiceover + ducked music
  const finalMp4 = path.join(VIDEO_OUT_DIR, 'vndrly-commercial.mp4');
  log('muxing voiceover + ducked music ...');
  await run('bash', [path.join(__dirname, 'mux-final.sh'), silentMp4, finalMp4]);

  const sz = (await stat(finalMp4)).size;
  log(`✓ wrote ${finalMp4} (${(sz / 1024 / 1024).toFixed(1)} MB)`);
}

async function main() {
  const mode = process.argv[2];
  if (mode === 'chunk') {
    const id = parseInt(process.argv[3], 10);
    await captureChunk(id);
    return;
  }
  if (mode === 'finalize') {
    await finalize();
    return;
  }
  if (mode === 'reset') {
    await rm(VIDEO_OUT_DIR, { recursive: true, force: true });
    await mkdir(RAW_DIR, { recursive: true });
    log('reset dist/video/');
    return;
  }
  if (mode === 'all' || !mode) {
    await rm(VIDEO_OUT_DIR, { recursive: true, force: true });
    await mkdir(RAW_DIR, { recursive: true });
    for (const c of CHUNKS) await captureChunk(c.id);
    await finalize();
    return;
  }
  throw new Error(`unknown mode: ${mode} (use chunk <id> | finalize | reset | all)`);
}

main().catch((err) => {
  console.error('[export-video] FAILED:', err);
  process.exit(1);
});
