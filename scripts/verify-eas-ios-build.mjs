import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** Fail closed before submitting a build selected by this release run. */
export function verifyIosBuild(result, { sha, projectId, expectedId } = {}) {
  if (!/^[a-f0-9]{40}$/i.test(sha ?? '')) throw new Error('Expected a full release SHA.');
  if (!projectId) throw new Error('Expected an Expo project ID.');
  const builds = Array.isArray(result) ? result : [result];
  if (builds.length !== 1 || !builds[0] || typeof builds[0] !== 'object') {
    throw new Error('Expected exactly one EAS build result.');
  }
  const build = builds[0];
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(build.id ?? '')) {
    throw new Error('Invalid EAS build ID.');
  }
  if (expectedId && build.id !== expectedId) throw new Error('Result does not match the requested build ID.');
  if (build.status !== 'FINISHED') throw new Error('EAS build must be FINISHED.');
  if (build.platform !== 'IOS') throw new Error('EAS build must use the IOS platform.');
  if (build.distribution !== 'STORE') throw new Error('EAS build must use STORE distribution.');
  if (build.buildProfile !== 'production') throw new Error('EAS build must use the production profile.');
  if (build.gitCommitHash !== sha) throw new Error('EAS build does not match the exact release commit.');
  if (build.project?.id !== projectId) throw new Error('EAS build belongs to a different Expo project.');
  let artifact;
  try { artifact = new URL(build.artifacts?.applicationArchiveUrl ?? build.artifacts?.buildUrl); } catch {}
  if (artifact?.protocol !== 'https:' || !artifact.pathname.endsWith('.ipa')) {
    throw new Error('EAS build must have an HTTPS IPA artifact.');
  }
  return build.id;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [file, sha, expectedId] = process.argv.slice(2);
    if (!file) throw new Error('Usage: verify-eas-ios-build.mjs <build.json> <release-sha> [expected-build-id]');
    const app = JSON.parse(await readFile(new URL('../artifacts/vndrly-mobile/app.json', import.meta.url), 'utf8'));
    const result = JSON.parse(await readFile(file, 'utf8'));
    process.stdout.write(verifyIosBuild(result, { sha, expectedId, projectId: app.expo.extra.eas.projectId }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'EAS build verification failed.');
    process.exitCode = 2;
  }
}
