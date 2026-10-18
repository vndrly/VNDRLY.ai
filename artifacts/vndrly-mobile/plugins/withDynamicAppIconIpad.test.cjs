const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const plugin = require('./withDynamicAppIconIpad');
const icons = { mach: { image: './assets/icons/mach.png' }, baker: { image: './assets/icons/baker.png', prerendered: true } };

test('iPad alternate metadata keeps existing icons and adds both recommended sizes', () => {
  const phone = { CFBundleAlternateIcons: { mach: { CFBundleIconFiles: ['mach-Icon-60x60'] } } };
  const plist = { CFBundleIcons: phone, 'CFBundleIcons~ipad': { CFBundlePrimaryIcon: { CFBundleIconFiles: ['AppIcon'] }, CFBundleAlternateIcons: { mach: { CFBundleIconFiles: ['mach-Icon-60x60'], UIPrerenderedIcon: false } } } };
  plugin.applyTabletIconMetadata(plist, icons);
  assert.equal(plist.CFBundleIcons, phone);
  assert.deepEqual(plist['CFBundleIcons~ipad'].CFBundlePrimaryIcon.CFBundleIconFiles, ['AppIcon']);
  for (const key of Object.keys(icons)) assert.deepEqual(plist['CFBundleIcons~ipad'].CFBundleAlternateIcons[key].CFBundleIconFiles, key === 'mach' ? ['mach-Icon-60x60', 'mach-Icon-76x76', 'mach-Icon-83.5x83.5'] : ['baker-Icon-76x76', 'baker-Icon-83.5x83.5']);
  plugin.applyTabletIconMetadata(plist, icons);
  assert.equal(plist['CFBundleIcons~ipad'].CFBundleAlternateIcons.mach.CFBundleIconFiles.length, 3);
});

test('generated alternate iPad files are real opaque 152px and 167px PNGs', async () => {
  const projectRoot = path.resolve(__dirname, '..');
  const output = path.resolve(__dirname, '../../../.local/ipad-icon-tests', randomUUID());
  await plugin.writeTabletIcons(projectRoot, output, icons);
  for (const key of Object.keys(icons)) for (const [size, pixels] of [[76, 152], [83.5, 167]]) {
    const png = await fs.readFile(path.join(output, `${key}-Icon-${size}x${size}@2x.png`));
    assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), pixels);
    assert.equal(png.readUInt32BE(20), pixels);
    assert.ok([0, 2].includes(png[25]), 'PNG must be grayscale or RGB, without alpha');
  }
});

test('actual Expo mod ordering retains both iPad sizes for each alternate', () => {
  const cli = path.join(path.dirname(require.resolve('expo/package.json')), 'bin/cli');
  const config = JSON.parse(execFileSync(process.execPath, [cli, 'config', '--type', 'introspect', '--json'], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const plist = config._internal.modResults.ios.infoPlist;
  for (const key of Object.keys(icons)) {
    assert.deepEqual(plist['CFBundleIcons~ipad'].CFBundleAlternateIcons[key].CFBundleIconFiles, [`${key}-Icon-60x60`, `${key}-Icon-76x76`, `${key}-Icon-83.5x83.5`]);
    assert.deepEqual(plist.CFBundleIcons.CFBundleAlternateIcons[key].CFBundleIconFiles, [`${key}-Icon-60x60`]);
  }
});
