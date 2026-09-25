import { File, Paths } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import type { OwnedMeetingFile } from "./meeting-files";
import { nativeUuid } from "./native-uuid";

/** Expo's native File body preserves binary bytes without React Native's Blob conversion. */
export async function uploadWorkHubFile(input: {
  file: OwnedMeetingFile;
  uploadURL: string;
  signal: AbortSignal;
  assertCurrent: () => void;
  registerTemporaryCleanup: (cleanup: (() => void) | null) => void;
}) {
  const temporary = new File(Paths.cache, `work-hub-upload-${nativeUuid()}`);
  const cleanup = () => { try { temporary.delete(); } catch { /* best-effort cache cleanup */ } };
  try {
    input.assertCurrent();
    temporary.create();
    temporary.write(input.file.bytes);
    input.registerTemporaryCleanup(cleanup);
    input.assertCurrent();
    const result = await expoFetch(input.uploadURL, {
      method: "PUT", headers: { "Content-Type": input.file.type }, body: temporary, signal: input.signal,
    });
    input.assertCurrent();
    return result.ok;
  } finally {
    cleanup();
    input.registerTemporaryCleanup(null);
  }
}
