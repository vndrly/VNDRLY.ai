const fs = require("fs");
const path = require("path");

const mobileRoot = path.join(__dirname, "..");
const easCliRoot = path.dirname(require.resolve("eas-cli/package.json"));
const { createGraphqlClient } = require(path.join(
  easCliRoot,
  "build/commandUtils/context/contextUtils/createGraphqlClient",
));
const { UserQuery } = require(path.join(
  easCliRoot,
  "build/graphql/queries/UserQuery",
));
const { getStateJsonPath } = require(path.join(easCliRoot, "build/utils/paths"));
const { parse } = require(path.join(
  easCliRoot,
  "build/credentials/ios/utils/provisioningProfile",
));
const IosGraphql = require(path.join(
  easCliRoot,
  "build/credentials/ios/api/GraphqlClient",
));
const { getOwnerAccountForProjectIdAsync } = require(path.join(
  easCliRoot,
  "build/project/projectUtils",
));

async function main() {
  const auth = JSON.parse(fs.readFileSync(getStateJsonPath(), "utf8"))?.auth;
  const graphqlClient = createGraphqlClient({
    accessToken: null,
    sessionSecret: auth.sessionSecret,
  });
  await UserQuery.currentUserAsync(graphqlClient);
  const appJson = JSON.parse(fs.readFileSync(path.join(mobileRoot, "app.json"), "utf8"));
  const projectId = appJson.expo.extra.eas.projectId;
  const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);
  const creds = await IosGraphql.getIosAppCredentialsWithBuildCredentialsAsync(
    graphqlClient,
    { account, projectName: appJson.expo.slug, bundleIdentifier: "com.vndrly.field" },
    { iosDistributionType: "APP_STORE" },
  );
  const profile = creds.iosAppBuildCredentialsList[0].provisioningProfile;
  const plist = parse(profile.provisioningProfile);
  console.log("Profile ID:", profile.developerPortalIdentifier);
  console.log("Entitlements:", JSON.stringify(plist.Entitlements, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
