/**
 * Reproduce the native keyword engine before CocoaPods resolves the local module.
 * Pinned upstream input; never downloads or sends microphone audio.
 *   node scripts/prepare-askv-ios.mjs [--archive /path/to/download.tar.bz2]
 *   node scripts/prepare-askv-ios.mjs --check
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const VERSION = '1.12.29';
const SHA256 = '7c956e0d6261bb4d9e71eca425fdd32b7479933e20987beceead576577b2ee26';
const URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.29/sherpa-onnx-v1.12.29-ios-no-tts.tar.bz2';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iosRoot = path.join(repoRoot, 'artifacts/vndrly-mobile/modules/askv-wake/ios');
const vendorRoot = path.join(iosRoot, 'vendor');
const marker = path.join(vendorRoot, '.askv-engine-v1.12.29');
const targets = [
  'build-ios-no-tts/sherpa-onnx.xcframework',
  'build-ios-no-tts/ios-onnxruntime/1.17.1/onnxruntime.xcframework',
];
const required = [
  'sherpa-onnx.xcframework/Info.plist',
  'sherpa-onnx.xcframework/Headers/sherpa-onnx/c-api/c-api.h',
  'sherpa-onnx.xcframework/ios-arm64/libsherpa-onnx.a',
  'sherpa-onnx.xcframework/ios-arm64_x86_64-simulator/libsherpa-onnx.a',
  'onnxruntime.xcframework/Info.plist',
  'onnxruntime.xcframework/ios-arm64/libonnxruntime.a',
  'onnxruntime.xcframework/ios-arm64_x86_64-simulator/libonnxruntime.a',
];

async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function prepared({ verifyFiles = false } = {}) {
  try {
    const data = JSON.parse(await readFile(marker, 'utf8'));
    if (data.version !== VERSION || data.archiveSha256 !== SHA256) return false;
    for (const file of required) {
      const absolute = path.join(vendorRoot, file);
      if ((await stat(absolute)).size === 0) return false;
      if (verifyFiles && await digest(absolute) !== data.files[file]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function extract(archive, destination) {
  if (process.platform !== 'win32') {
    const result = spawnSync('tar', ['-xjf', archive, '-C', destination,
      ...targets.map((target) => './' + target)], { stdio: 'inherit', windowsHide: true });
    if (result.status !== 0) throw new Error('Unable to extract the pinned iOS engine archive.');
    return;
  }

  // Windows bsdtar does not necessarily include bzip2 support. Python's bundled
  // decoder does, and filter=data rejects archive paths outside the staging area.
  const program = [
    'import pathlib, sys, tarfile',
    'archive, destination = sys.argv[1:3]',
    'prefixes = tuple(sys.argv[3:])',
    'with tarfile.open(archive, "r:bz2") as source:',
    '    members = [m for m in source if any(m.name.removeprefix("./") == p or m.name.removeprefix("./").startswith(p + "/") for p in prefixes)]',
    '    source.extractall(destination, members=members, filter="data")',
  ].join('\n');
  const candidates = process.env.ASKV_PYTHON
    ? [[process.env.ASKV_PYTHON, []]]
    : [['python', []], ['python3', []], ['py', ['-3']]];
  for (const [command, prefix] of candidates) {
    const probe = spawnSync(command, [...prefix, '-c', 'import sys; assert sys.version_info >= (3, 12)'],
      { stdio: 'ignore', windowsHide: true });
    if (probe.status !== 0) continue;
    const result = spawnSync(command, [...prefix, '-c', program, archive, destination, ...targets],
      { stdio: 'inherit', windowsHide: true });
    if (result.status !== 0) throw new Error('Unable to extract the pinned iOS engine archive.');
    return;
  }
  throw new Error('Windows engine preparation needs Python 3.12+; set ASKV_PYTHON to its executable path.');
}

async function removeStaging(directory) {
  // Never recursively remove an unvalidated computed location.
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) ||
      !path.basename(resolved).startsWith('askv-ios-')) {
    throw new Error('Refusing an unexpected staging cleanup path.');
  }
  await rm(resolved, { recursive: true, force: true });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--check')) {
    if (!await prepared({ verifyFiles: true })) {
      throw new Error('Native AskV engine is absent or changed; run prepare:askv:ios first.');
    }
    console.log('AskV iOS engine v' + VERSION + ': pinned framework hashes verified.');
    return;
  }
  if (await prepared({ verifyFiles: true })) {
    console.log('AskV iOS engine v' + VERSION + ' is already prepared and verified.');
    return;
  }
  const archiveIndex = args.indexOf('--archive');
  if (archiveIndex >= 0 && !args[archiveIndex + 1]) throw new Error('--archive needs a file path.');
  const staging = await mkdtemp(path.join(tmpdir(), 'askv-ios-'));
  try {
    const archive = archiveIndex >= 0
      ? path.resolve(args[archiveIndex + 1])
      : path.join(staging, 'engine.tar.bz2');
    if (archiveIndex < 0) {
      console.log('Downloading pinned sherpa-onnx iOS engine v' + VERSION + '...');
      const response = await fetch(URL, { signal: AbortSignal.timeout(180_000) });
      if (!response.ok || !response.body) throw new Error('Native engine download failed: HTTP ' + response.status);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(archive, { flags: 'wx' }));
    }
    if (await digest(archive) !== SHA256) throw new Error('Native engine archive SHA-256 mismatch; nothing installed.');
    await extract(archive, staging);
    await mkdir(vendorRoot, { recursive: true });
    // Invalidate the old success marker before replacing generated vendor files.
    await rm(marker, { force: true });
    for (const source of targets) {
      const name = path.basename(source);
      await cp(path.join(staging, source), path.join(vendorRoot, name),
        { recursive: true, dereference: true, force: true });
      // CocoaPods links static XCFrameworks with -l<name>, which requires lib*.a.
      // Upstream ships both names; point the plist at the standard lib-prefixed one.
      const plist = path.join(vendorRoot, name, 'Info.plist');
      const library = name.replace('.xcframework', '');
      const content = await readFile(plist, 'utf8');
      await writeFile(plist, content.replaceAll('<string>' + library + '.a</string>',
        '<string>lib' + library + '.a</string>'));
    }
    const files = {};
    for (const file of required) files[file] = await digest(path.join(vendorRoot, file));
    await writeFile(marker, JSON.stringify({ version: VERSION, archiveSha256: SHA256, files }, null, 2) + '\n');
    console.log('Prepared and verified AskV iOS engine v' + VERSION + ' for device and simulator.');
  } finally {
    await removeStaging(staging);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
