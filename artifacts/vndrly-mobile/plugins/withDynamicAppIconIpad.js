const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const { withInfoPlist, withXcodeProject, withDangerousMod, IOSConfig } = require('expo/config-plugins');
// Reuse the installed icon package's image tooling; no additional dependency.
const iconRequire = createRequire(require.resolve('expo-dynamic-app-icon/app.plugin.js'));
const { generateImageAsync } = iconRequire('@expo/image-utils');
const folder = 'DynamicAppIconsIpad';
const sizes = [76, 83.5];
const basename = (key, size) => `${key}-Icon-${size}x${size}`;

function applyTabletIconMetadata(plist, icons) {
  // Upstream aliases one alternate-icon object into both phone and tablet.
  // Copy each modified level so adding iPad files cannot alter the phone plist.
  const tablet = plist['CFBundleIcons~ipad'] = { ...plist['CFBundleIcons~ipad'] };
  const alternate = tablet.CFBundleAlternateIcons = { ...tablet.CFBundleAlternateIcons };
  for (const [key, icon] of Object.entries(icons)) {
    const existing = alternate[key] = { UIPrerenderedIcon: !!icon.prerendered, ...alternate[key] };
    existing.CFBundleIconFiles = [...new Set([...(existing.CFBundleIconFiles ?? []), ...sizes.map(size => basename(key, size))])];
  }
  return plist;
}

async function writeTabletIcons(projectRoot, output, icons) {
  await fs.mkdir(output, { recursive: true });
  for (const [key, icon] of Object.entries(icons)) for (const size of sizes) {
    const name = `${basename(key, size)}@2x.png`;
    const { source } = await generateImageAsync({ projectRoot, cacheType: 'vndrly-alternate-ipad-icons' }, {
      name, src: path.resolve(projectRoot, icon.image), width: size * 2, height: size * 2,
      resizeMode: 'cover', removeTransparency: true, backgroundColor: '#ffffff',
    });
    await fs.writeFile(path.join(output, name), source);
  }
}

/** Register BEFORE expo-dynamic-app-icon: Expo's plist wrappers run in reverse
 * registration order. Upstream 1.2 emits only 60pt icons for its iPad plist. */
function withDynamicAppIconIpad(config) {
  if (!config.ios?.supportsTablet) return config;
  const icons = config.plugins?.find(item => Array.isArray(item) && item[0] === 'expo-dynamic-app-icon')?.[1] ?? {};
  for (const [key, icon] of Object.entries(icons)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(key) || typeof icon?.image !== 'string') throw new Error('Invalid alternate icon configuration');
  }
  config = withInfoPlist(config, mod => { applyTabletIconMetadata(mod.modResults, icons); return mod; });
  config = withXcodeProject(config, mod => {
    const groupPath = `${mod.modRequest.projectName}/${folder}`;
    const group = IOSConfig.XcodeUtils.ensureGroupRecursively(mod.modResults, groupPath);
    for (const key of Object.keys(icons)) for (const size of sizes) {
      const name = `${basename(key, size)}@2x.png`;
      if (!group.children?.some(child => child.comment === name)) IOSConfig.XcodeUtils.addResourceFileToGroup({
        filepath: path.join(groupPath, name), groupName: groupPath, project: mod.modResults, isBuildFile: true,
      });
    }
    return mod;
  });
  return withDangerousMod(config, ['ios', async mod => {
    // Separate folder preserves the upstream package's own regenerated assets.
    await writeTabletIcons(mod.modRequest.projectRoot, path.join(mod.modRequest.platformProjectRoot, mod.modRequest.projectName, folder), icons);
    return mod;
  }]);
}

module.exports = withDynamicAppIconIpad;
module.exports.applyTabletIconMetadata = applyTabletIconMetadata;
module.exports.writeTabletIcons = writeTabletIcons;
