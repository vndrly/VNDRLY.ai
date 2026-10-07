const fs = require("node:fs");
const path = require("node:path");
const {
  withInfoPlist,
  withDangerousMod,
  withXcodeProject,
} = require("expo/config-plugins");
const TARGET = "VndrlyWorkActivity";
const INTENTS = "VndrlySystemIntents";

function addLocalizedResources(project, targetId, rootGroup, folder, name) {
  const objects = project.hash.project.objects;
  if (!project.findPBXGroupKey({ name: "Resources" })) {
    const resources = project.addPbxGroup([], "Resources");
    project.addToPbxGroup(resources.uuid, rootGroup);
  }
  const found = Object.entries(objects.PBXVariantGroup || {}).find(
    ([id, group]) =>
      !id.endsWith("_comment") &&
      group.name === name &&
      group.children.some((child) =>
        String(objects.PBXFileReference[child.value]?.path)
          .replaceAll('"', "")
          .startsWith(`${folder}/`),
      ),
  );
  if (found) return;
  const groupId = project.pbxCreateVariantGroup(name);
  project.addToPbxGroup(groupId, rootGroup);
  for (const locale of ["en", "es"]) {
    const file = project.addResourceFile(
      `${folder}/${locale}.lproj/${name}`,
      { target: targetId, variantGroup: true },
      groupId,
    );
    objects.PBXFileReference[file.fileRef].name = locale;
    objects.PBXVariantGroup[groupId].children.at(-1).comment = locale;
    project.addKnownRegion(locale);
  }
  const resource = {
    uuid: project.generateUuid(),
    fileRef: groupId,
    basename: name,
    target: targetId,
  };
  project.addToPbxBuildFileSection(resource);
  project.addToPbxResourcesBuildPhase(resource);
}
function configureProject(project, config) {
  const app = project.getFirstTarget();
  const objects = project.hash.project.objects;
  const rootGroup = project.getFirstProject().firstProject.mainGroup;
  const targets = objects.PBXNativeTarget;
  const existing = Object.entries(targets).find(
    ([id, value]) =>
      !id.endsWith("_comment") &&
      String(value.name).replaceAll('"', "") === TARGET,
  );
  const target = existing
    ? { uuid: existing[0], pbxNativeTarget: existing[1] }
    : project.addTarget(
        TARGET,
        "app_extension",
        TARGET,
        `${config.ios.bundleIdentifier}.workactivity`,
      );
  if (!existing) {
    project.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", target.uuid);
    project.addBuildPhase(
      [],
      "PBXFrameworksBuildPhase",
      "Frameworks",
      target.uuid,
    );
    project.addBuildPhase(
      [],
      "PBXResourcesBuildPhase",
      "Resources",
      target.uuid,
    );
  }
  for (const file of [
    `${TARGET}/VndrlyWorkActivity.swift`,
    `${TARGET}/VndrlyWorkAttributes.swift`,
  ]) {
    if (!project.hasFile(file))
      project.addSourceFile(file, { target: target.uuid }, rootGroup);
  }
  const intentFile = `${INTENTS}/VndrlyWorkIntents.swift`;
  if (!project.hasFile(intentFile))
    project.addSourceFile(intentFile, { target: app.uuid }, rootGroup);
  if (
    !app.firstTarget.buildPhases.some(
      (phase) => objects.PBXResourcesBuildPhase?.[phase.value],
    )
  )
    project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", app.uuid);
  addLocalizedResources(
    project,
    app.uuid,
    rootGroup,
    INTENTS,
    "Localizable.strings",
  );
  addLocalizedResources(
    project,
    app.uuid,
    rootGroup,
    INTENTS,
    "AppShortcuts.strings",
  );
  addLocalizedResources(
    project,
    target.uuid,
    rootGroup,
    TARGET,
    "Localizable.strings",
  );
  const mainList =
    objects.XCConfigurationList[app.firstTarget.buildConfigurationList];
  const mainSettings =
    objects.XCBuildConfiguration[mainList.buildConfigurations[0].value]
      .buildSettings;
  const list =
    objects.XCConfigurationList[target.pbxNativeTarget.buildConfigurationList];
  for (const entry of list.buildConfigurations) {
    const settings = objects.XCBuildConfiguration[entry.value].buildSettings;
    Object.assign(settings, {
      INFOPLIST_FILE: `"${TARGET}/${TARGET}-Info.plist"`,
      PRODUCT_BUNDLE_IDENTIFIER: `"${config.ios.bundleIdentifier}.workactivity"`,
      IPHONEOS_DEPLOYMENT_TARGET: "16.2",
      SWIFT_VERSION: "5.9",
      TARGETED_DEVICE_FAMILY: '"1,2"',
      APPLICATION_EXTENSION_API_ONLY: "YES",
      CODE_SIGN_STYLE: "Automatic",
      SKIP_INSTALL: "YES",
      CURRENT_PROJECT_VERSION:
        config.ios.buildNumber || mainSettings.CURRENT_PROJECT_VERSION || "1",
      MARKETING_VERSION: config.version || mainSettings.MARKETING_VERSION,
      GENERATE_INFOPLIST_FILE: "NO",
    });
    if (mainSettings.DEVELOPMENT_TEAM)
      settings.DEVELOPMENT_TEAM = mainSettings.DEVELOPMENT_TEAM;
  }
  return project;
}

function withVndrlySystemSurfaces(config) {
  const bundle = config.ios?.bundleIdentifier;
  if (typeof bundle !== "string" || !/^[A-Za-z0-9.-]+$/.test(bundle))
    throw new Error("A canonical iOS bundle identifier is required");
  config.extra = config.extra || {};
  config.extra.eas = config.extra.eas || {};
  config.extra.eas.build = config.extra.eas.build || {};
  config.extra.eas.build.experimental =
    config.extra.eas.build.experimental || {};
  config.extra.eas.build.experimental.ios =
    config.extra.eas.build.experimental.ios || {};
  const extensions =
    config.extra.eas.build.experimental.ios.appExtensions || [];
  config.extra.eas.build.experimental.ios.appExtensions = [
    ...extensions.filter((entry) => entry.targetName !== TARGET),
    {
      targetName: TARGET,
      bundleIdentifier: `${bundle}.workactivity`,
      entitlements: {},
    },
  ];
  config = withInfoPlist(config, (mod) => {
    mod.modResults.NSSupportsLiveActivities = true;
    mod.modResults.VNDRLYSystemSurfacesConfigured = true;
    return mod;
  });
  config = withDangerousMod(config, [
    "ios",
    async (mod) => {
      const native = mod.modRequest.platformProjectRoot;
      const source = path.join(
        mod.modRequest.projectRoot,
        "modules/vndrly-system-surfaces",
      );
      fs.mkdirSync(path.join(native, TARGET), { recursive: true });
      fs.mkdirSync(path.join(native, INTENTS), { recursive: true });
      for (const locale of ["en", "es"]) {
        for (const destination of [TARGET, INTENTS])
          fs.mkdirSync(path.join(native, destination, `${locale}.lproj`), {
            recursive: true,
          });
        fs.copyFileSync(
          path.join(source, `locales/${locale}.lproj/Localizable.strings`),
          path.join(native, TARGET, `${locale}.lproj/Localizable.strings`),
        );
        fs.copyFileSync(
          path.join(source, `locales/${locale}.lproj/Localizable.strings`),
          path.join(native, INTENTS, `${locale}.lproj/Localizable.strings`),
        );
        fs.copyFileSync(
          path.join(source, `locales/${locale}.lproj/AppShortcuts.strings`),
          path.join(native, INTENTS, `${locale}.lproj/AppShortcuts.strings`),
        );
      }
      fs.copyFileSync(
        path.join(source, "widget/VndrlyWorkActivity.swift"),
        path.join(native, TARGET, "VndrlyWorkActivity.swift"),
      );
      fs.copyFileSync(
        path.join(source, "ios/VndrlyWorkAttributes.swift"),
        path.join(native, TARGET, "VndrlyWorkAttributes.swift"),
      );
      fs.copyFileSync(
        path.join(source, "intents/VndrlyWorkIntents.swift"),
        path.join(native, INTENTS, "VndrlyWorkIntents.swift"),
      );
      fs.writeFileSync(
        path.join(native, TARGET, `${TARGET}-Info.plist`),
        `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleDisplayName</key><string>VNDRLY Work</string><key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string><key>CFBundleExecutable</key><string>$(EXECUTABLE_NAME)</string><key>CFBundleInfoDictionaryVersion</key><string>6.0</string><key>CFBundleName</key><string>$(PRODUCT_NAME)</string><key>CFBundlePackageType</key><string>XPC!</string><key>CFBundleShortVersionString</key><string>$(MARKETING_VERSION)</string><key>CFBundleVersion</key><string>$(CURRENT_PROJECT_VERSION)</string><key>NSExtension</key><dict><key>NSExtensionPointIdentifier</key><string>com.apple.widgetkit-extension</string></dict></dict></plist>`,
      );
      return mod;
    },
  ]);
  return withXcodeProject(config, (mod) => {
    mod.modResults = configureProject(mod.modResults, mod);
    return mod;
  });
}
module.exports = withVndrlySystemSurfaces;
module.exports.configureProject = configureProject;
