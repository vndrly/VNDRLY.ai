/**
 * Regenerates the App Store provisioning profile after entitlements change.
 *
 * Usage (from repo root):
 *   node artifacts/vndrly-mobile/scripts/refresh-ios-appstore-provisioning.cjs
 */
const fs = require("fs");
const path = require("path");

const mobileRoot = path.join(__dirname, "..");
const repoRoot = path.join(mobileRoot, "../..");
process.chdir(mobileRoot);

process.env.EXPO_ASC_API_KEY_PATH =
  process.env.EXPO_ASC_API_KEY_PATH ??
  path.join(repoRoot, ".local/AuthKey_C7YFYCR72K.p8");
process.env.EXPO_ASC_KEY_ID = process.env.EXPO_ASC_KEY_ID ?? "C7YFYCR72K";
process.env.EXPO_ASC_ISSUER_ID =
  process.env.EXPO_ASC_ISSUER_ID ?? "0bb5c187-d2b0-4058-91b2-b1cccccaac53";
process.env.EXPO_APPLE_TEAM_ID = process.env.EXPO_APPLE_TEAM_ID ?? "CM253WWQW2";
process.env.EXPO_APPLE_TEAM_TYPE = process.env.EXPO_APPLE_TEAM_TYPE ?? "INDIVIDUAL";
process.env.EAS_BUILD_NO_EXPO_GO_WARNING = "true";

const easCliRoot = path.dirname(require.resolve("eas-cli/package.json"));

const { createGraphqlClient } = require(path.join(
  easCliRoot,
  "build/commandUtils/context/contextUtils/createGraphqlClient",
));
const { UserQuery } = require(path.join(
  easCliRoot,
  "build/graphql/queries/UserQuery",
));
const { getStateJsonPath } = require(path.join(
  easCliRoot,
  "build/utils/paths",
));
const { CredentialsContext } = require(path.join(
  easCliRoot,
  "build/credentials/context",
));
const { RemoveProvisioningProfiles } = require(path.join(
  easCliRoot,
  "build/credentials/ios/actions/RemoveProvisioningProfile",
));
const { SetUpProvisioningProfile } = require(path.join(
  easCliRoot,
  "build/credentials/ios/actions/SetUpProvisioningProfile",
));
const { SetUpDistributionCertificate } = require(path.join(
  easCliRoot,
  "build/credentials/ios/actions/SetUpDistributionCertificate",
));
const {
  getAppFromContextAsync,
  getAppLookupParamsFromContextAsync,
  getBuildCredentialsAsync,
} = require(path.join(
  easCliRoot,
  "build/credentials/ios/actions/BuildCredentialsUtils",
));
const { ensureBundleIdExistsAsync } = require(path.join(
  easCliRoot,
  "build/credentials/ios/appstore/ensureAppExists",
));
const { getPrivateExpoConfigAsync } = require(path.join(
  easCliRoot,
  "build/project/expoConfig",
));
const { getOwnerAccountForProjectIdAsync } = require(path.join(
  easCliRoot,
  "build/project/projectUtils",
));
const { revokeProvisioningProfileAsync, useExistingProvisioningProfileAsync } = require(path.join(
  easCliRoot,
  "build/credentials/ios/appstore/provisioningProfile",
));
const { AuthenticationMode } = require(path.join(
  easCliRoot,
  "build/credentials/ios/appstore/authenticateTypes",
));
const { ApplePlatform } = require(path.join(
  easCliRoot,
  "build/credentials/ios/appstore/constants",
));
const { IosDistributionType } = require(path.join(
  easCliRoot,
  "build/graphql/generated",
));
const { getRequestContext } = require(path.join(
  easCliRoot,
  "build/credentials/ios/appstore/authenticate",
));

const BUNDLE_ID = "com.vndrly.field";

async function getIntrospectedEntitlementsAsync() {
  const { spawnSync } = require("child_process");
  const expoBin = path.join(mobileRoot, "node_modules/.bin/expo.cmd");
  const result = spawnSync(expoBin, ["config", "--type", "introspect", "--json"], {
    cwd: mobileRoot,
    encoding: "utf8",
    env: process.env,
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "expo config --type introspect failed");
  }
  const config = JSON.parse(result.stdout);
  const entitlements = config.ios?.entitlements ?? {};
  // App Store builds use production push environment.
  if (entitlements["aps-environment"]) {
    entitlements["aps-environment"] = "production";
  }
  return entitlements;
}

async function getExpoSessionAsync() {
  const auth = JSON.parse(fs.readFileSync(getStateJsonPath(), "utf8"))?.auth;
  if (!auth?.sessionSecret && !process.env.EXPO_TOKEN) {
    throw new Error("Run `eas login` first (or set EXPO_TOKEN).");
  }
  const authenticationInfo = process.env.EXPO_TOKEN
    ? { accessToken: process.env.EXPO_TOKEN, sessionSecret: null }
    : { accessToken: null, sessionSecret: auth.sessionSecret };
  const graphqlClient = createGraphqlClient(authenticationInfo);
  const actor = await UserQuery.currentUserAsync(graphqlClient);
  if (!actor) {
    throw new Error("Expo session expired — run `eas login` again.");
  }
  return { actor, graphqlClient };
}

async function main() {
  const { actor, graphqlClient } = await getExpoSessionAsync();
  const exp = await getPrivateExpoConfigAsync(mobileRoot);
  const projectId = exp.extra?.eas?.projectId;
  if (!projectId) {
    throw new Error("Missing extra.eas.projectId in app config.");
  }
  const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);

  const ctx = new CredentialsContext({
    projectDir: mobileRoot,
    projectInfo: { exp, projectId },
    user: actor,
    graphqlClient,
    analytics: null,
    nonInteractive: true,
    autoAcceptCredentialReuse: true,
  });

  await ctx.appStore.ensureAuthenticatedAsync({ mode: AuthenticationMode.API_KEY });
  const authCtx = ctx.appStore.authCtx;

  const entitlements = await getIntrospectedEntitlementsAsync();

  console.log("Syncing iOS capabilities on Apple (time-sensitive + push)…");
  const context = getRequestContext(authCtx);
  await ensureBundleIdExistsAsync(authCtx, {
    accountName: account.name,
    projectName: exp.slug,
    bundleIdentifier: BUNDLE_ID,
  }, {
    entitlements,
  });

  console.log(`Revoking stale App Store profiles for ${BUNDLE_ID}…`);
  await revokeProvisioningProfileAsync(authCtx, BUNDLE_ID, ApplePlatform.IOS);

  const app = {
    ...(await getAppFromContextAsync(ctx)),
    bundleIdentifier: BUNDLE_ID,
  };
  const target = {
    targetName: exp.name?.replace(/\s+/g, "") ?? "VNDRLYFieldMobile",
    bundleIdentifier: BUNDLE_ID,
    buildConfiguration: "Release",
    entitlements,
    type: "application",
  };
  const appLookupParams = {
    account,
    projectName: exp.slug,
    bundleIdentifier: BUNDLE_ID,
  };

  const iosAppCredentials = await ctx.ios.getIosAppCredentialsWithCommonFieldsAsync(
    graphqlClient,
    appLookupParams,
  );
  const buildCredentials = iosAppCredentials?.iosAppBuildCredentialsList.find(
    (entry) => entry.iosDistributionType === IosDistributionType.AppStore,
  );
  const provisioningProfile = buildCredentials?.provisioningProfile;
  if (provisioningProfile) {
    console.log("Removing stale profile from EAS…");
    await new RemoveProvisioningProfiles([appLookupParams], [provisioningProfile]).runAsync(
      ctx,
    );
  }

  console.log("Creating new App Store provisioning profile…");
  await new SetUpDistributionCertificate(app, IosDistributionType.AppStore).runAsync(ctx);
  await new SetUpProvisioningProfile(app, target, IosDistributionType.AppStore).runAsync(ctx);

  const freshCredentials = await getBuildCredentialsAsync(ctx, app, IosDistributionType.AppStore);
  const distCert = freshCredentials?.distributionCertificate;
  const profile = freshCredentials?.provisioningProfile;
  if (distCert?.certificateP12 && profile?.developerPortalIdentifier) {
    console.log("Regenerating profile so new capabilities are embedded…");
    const regenerated = await useExistingProvisioningProfileAsync(
      authCtx,
      BUNDLE_ID,
      {
        provisioningProfileId: profile.developerPortalIdentifier,
        provisioningProfile: profile.provisioningProfile,
      },
      {
        certP12: distCert.certificateP12,
        certPassword: distCert.certificatePassword,
        distCertSerialNumber: distCert.serialNumber,
      },
    );
    await ctx.ios.updateProvisioningProfileAsync(ctx.graphqlClient, profile.id, {
      appleProvisioningProfile: regenerated.provisioningProfile,
      developerPortalIdentifier: regenerated.provisioningProfileId,
    });
  }

  console.log("Done — App Store provisioning profile refreshed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
