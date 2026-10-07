const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const expoRequire = createRequire(require.resolve("expo/config-plugins"));
const configRequire = createRequire(
  expoRequire.resolve("@expo/config-plugins"),
);
const xcode = configRequire("xcode");
const plugin = require("./withVndrlySystemSurfaces");
function projectFixture() {
  const project = xcode.project("synthetic.pbxproj");
  project.hash = {
    project: {
      archiveVersion: 1,
      objectVersion: 56,
      rootObject: "PROJECT",
      objects: {
        PBXProject: {
          PROJECT: {
            isa: "PBXProject",
            mainGroup: "ROOT",
            productRefGroup: "PRODUCTS",
            buildConfigurationList: "CONFIGLIST",
            targets: [{ value: "APP", comment: "App" }],
            attributes: { TargetAttributes: { APP: {} } },
          },
        },
        PBXNativeTarget: {
          APP: {
            isa: "PBXNativeTarget",
            name: '"App"',
            productName: '"App"',
            productType: '"com.apple.product-type.application"',
            productReference: "PRODUCT",
            buildConfigurationList: "CONFIGLIST",
            buildPhases: [{ value: "SOURCES", comment: "Sources" }],
            dependencies: [],
          },
        },
        PBXGroup: {
          ROOT: {
            isa: "PBXGroup",
            children: [{ value: "PRODUCTS", comment: "Products" }],
            sourceTree: '"<group>"',
          },
          PRODUCTS: {
            isa: "PBXGroup",
            name: "Products",
            children: [],
            sourceTree: '"<group>"',
          },
        },
        PBXFileReference: {
          PRODUCT: {
            isa: "PBXFileReference",
            explicitFileType: "wrapper.application",
            path: '"App.app"',
            sourceTree: "BUILT_PRODUCTS_DIR",
          },
        },
        PBXBuildFile: {},
        PBXContainerItemProxy: {},
        PBXTargetDependency: {},
        PBXSourcesBuildPhase: {
          SOURCES_comment: "Sources",
          SOURCES: {
            isa: "PBXSourcesBuildPhase",
            files: [],
            buildActionMask: 2147483647,
            runOnlyForDeploymentPostprocessing: 0,
          },
        },
        XCConfigurationList: {
          CONFIGLIST: {
            isa: "XCConfigurationList",
            buildConfigurations: [
              { value: "DEBUG", comment: "Debug" },
              { value: "RELEASE", comment: "Release" },
            ],
            defaultConfigurationName: "Release",
          },
        },
        XCBuildConfiguration: {
          DEBUG: {
            isa: "XCBuildConfiguration",
            name: "Debug",
            buildSettings: {
              CURRENT_PROJECT_VERSION: "212",
              MARKETING_VERSION: "1.0.2",
              DEVELOPMENT_TEAM: "SYNTHETIC",
            },
          },
          RELEASE: {
            isa: "XCBuildConfiguration",
            name: "Release",
            buildSettings: {
              CURRENT_PROJECT_VERSION: "212",
              MARKETING_VERSION: "1.0.2",
              DEVELOPMENT_TEAM: "SYNTHETIC",
            },
          },
        },
      },
    },
  };
  return project;
}
test("adds a real embedded extension and app-target intents once, preserving app build identity", () => {
  const project = projectFixture();
  const config = {
    ios: { bundleIdentifier: "com.vndrly.field" },
    version: "1.0.2",
  };
  plugin.configureProject(project, config);
  const once = project.writeSync();
  plugin.configureProject(project, config);
  assert.equal(project.writeSync(), once);
  const objects = project.hash.project.objects;
  const target = Object.entries(objects.PBXNativeTarget).find(
    ([key, value]) =>
      !key.endsWith("_comment") && value.name === '"VndrlyWorkActivity"',
  );
  assert.ok(target);
  assert.equal(objects.PBXNativeTarget.APP.dependencies.length, 1);
  const list = objects.XCConfigurationList[target[1].buildConfigurationList];
  for (const entry of list.buildConfigurations) {
    const settings = objects.XCBuildConfiguration[entry.value].buildSettings;
    assert.equal(
      settings.PRODUCT_BUNDLE_IDENTIFIER,
      '"com.vndrly.field.workactivity"',
    );
    assert.equal(settings.CURRENT_PROJECT_VERSION, "212");
    assert.equal(settings.IPHONEOS_DEPLOYMENT_TARGET, "16.2");
    assert.equal(settings.APPLICATION_EXTENSION_API_ONLY, "YES");
  }
  assert.match(once, /VndrlyWorkIntents.swift/);
  assert.match(once, /VndrlyWorkActivity.swift/);
  assert.match(once, /PBXCopyFilesBuildPhase/);
});
test("declares matching extension provisioning and Live Activity capability without credentials", () => {
  const config = plugin({
    name: "VNDRLY",
    slug: "vndrly",
    ios: { bundleIdentifier: "com.vndrly.field" },
    version: "1.0.2",
  });
  assert.deepEqual(config.extra.eas.build.experimental.ios.appExtensions, [
    {
      targetName: "VndrlyWorkActivity",
      bundleIdentifier: "com.vndrly.field.workactivity",
      entitlements: {},
    },
  ]);
  assert.throws(() => plugin({ ios: { bundleIdentifier: "https://foreign" } }));
});
test("uses Expo's actual build number for the extension without rewriting containing app settings", () => {
  const project = projectFixture();
  plugin.configureProject(project, {
    ios: { bundleIdentifier: "com.vndrly.field", buildNumber: "213" },
    version: "1.0.2",
  });
  const objects = project.hash.project.objects;
  const target = Object.entries(objects.PBXNativeTarget).find(
    ([key, value]) =>
      !key.endsWith("_comment") && value.name === '"VndrlyWorkActivity"',
  );
  const list = objects.XCConfigurationList[target[1].buildConfigurationList];
  assert.equal(
    objects.XCBuildConfiguration[list.buildConfigurations[0].value]
      .buildSettings.CURRENT_PROJECT_VERSION,
    "213",
  );
  assert.equal(
    objects.XCBuildConfiguration.DEBUG.buildSettings.CURRENT_PROJECT_VERSION,
    "212",
  );
});
test("native sources retain local-only foreground, context and stale guards; shortcuts never execute domain writes", () => {
  const root = path.join(__dirname, "../modules/vndrly-system-surfaces");
  const intents = fs.readFileSync(
    path.join(root, "intents/VndrlyWorkIntents.swift"),
    "utf8",
  );
  assert.match(intents, /openAppWhenRun = true/);
  assert.match(intents, /UIApplication.shared.open/);
  assert.doesNotMatch(intents, /OpenURLIntent\(/);
  assert.doesNotMatch(intents, /password|bearer|URLSession/i);
  const activity = fs.readFileSync(
    path.join(root, "ios/VndrlySystemSurfacesModule.swift"),
    "utf8",
  );
  assert.match(activity, /pushType: nil/);
  assert.match(activity, /expected == revision/);
  assert.match(activity, /add.*TimeInterval\(300\)/);
  assert.match(activity, /dismissalPolicy: .immediate/);
});

test("bundles EN/ES intent and shortcut resources in app, and widget resources in extension", () => {
  const project = projectFixture();
  plugin.configureProject(project, {
    ios: { bundleIdentifier: "com.vndrly.field" },
    version: "1.0.2",
  });
  const objects = project.hash.project.objects;
  const groups = Object.entries(objects.PBXVariantGroup).filter(
    ([id]) => !id.endsWith("_comment"),
  );
  assert.equal(groups.length, 3);
  for (const [, group] of groups) {
    assert.equal(group.children.length, 2);
    assert.deepEqual(
      group.children
        .map((child) => objects.PBXFileReference[child.value].name)
        .sort(),
      ["en", "es"],
    );
  }
  const appResources = project.pbxResourcesBuildPhaseObj("APP");
  assert.equal(appResources.files.length, 2);
  const extension = Object.entries(objects.PBXNativeTarget).find(
    ([id, value]) =>
      !id.endsWith("_comment") && value.name === '"VndrlyWorkActivity"',
  );
  assert.equal(project.pbxResourcesBuildPhaseObj(extension[0]).files.length, 1);
  const root = path.join(
    __dirname,
    "../modules/vndrly-system-surfaces/locales",
  );
  for (const name of ["Localizable.strings", "AppShortcuts.strings"]) {
    const parse = (locale) => [
      ...fs
        .readFileSync(path.join(root, `${locale}.lproj`, name), "utf8")
        .matchAll(/^"([^"]+)"\s*=\s*"([^"]+)";/gm),
    ];
    const en = parse("en"),
      es = parse("es");
    assert.deepEqual(
      en.map((row) => row[1]),
      es.map((row) => row[1]),
    );
    assert.ok(es.every((row) => row[2].length));
    if (name === "AppShortcuts.strings")
      assert.ok(
        es.every(
          (row) =>
            row[1].includes("${applicationName}") &&
            row[2].includes("${applicationName}"),
        ),
      );
  }
});
