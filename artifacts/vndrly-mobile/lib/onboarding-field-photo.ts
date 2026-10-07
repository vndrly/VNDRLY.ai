import * as ImagePicker from "expo-image-picker";
import { apiFetch, getApiBase } from "./api";
import { isAuthScopeCurrent, type AuthScope } from "./auth";
export async function pickOnboardingFieldPhoto(
  token: string,
  scope: AuthScope,
  signal: AbortSignal,
): Promise<string | null> {
  return pickImage(
    `/api/onboarding/field/by-token/${encodeURIComponent(token)}`,
    scope,
    signal,
    true,
  );
}
export async function pickOnboardingCompanyLogo(
  scope: AuthScope,
  signal: AbortSignal,
): Promise<string | null> {
  return pickImage("/api/storage/uploads", scope, signal, false);
}
async function pickImage(
  endpoint: string,
  scope: AuthScope,
  signal: AbortSignal,
  invitation: boolean,
): Promise<string | null> {
  const current = () => {
    if (signal.aborted || !isAuthScopeCurrent(scope))
      throw Object.assign(new Error("Request authorization changed"), {
        name: "AbortError",
      });
  };
  current();
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  current();
  if (permission.status !== "granted")
    throw new Error("Photo library permission denied");
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.6,
    allowsEditing: false,
  });
  current();
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0],
    blob = await fetch(asset.uri, { signal }).then((response) =>
      response.blob(),
    );
  current();
  if (
    !blob.size ||
    blob.size > 5 * 1024 * 1024 ||
    !["image/jpeg", "image/png", "image/webp"].includes(
      asset.mimeType ?? blob.type,
    )
  )
    throw new Error("Choose a JPEG, PNG or WebP photo smaller than 5 MB");
  const descriptor = await apiFetch<{ uploadURL: string; objectPath: string }>(
    `${endpoint}/${invitation ? "upload-url" : "request-url"}`,
    {
      method: "POST",
      signal,
      ...(invitation
        ? {}
        : {
            body: JSON.stringify({
              name: asset.fileName ?? "company-logo.jpg",
              size: blob.size,
              contentType: asset.mimeType ?? blob.type,
            }),
          }),
    },
    scope,
  );
  current();
  const upload = new URL(descriptor.uploadURL, getApiBase());
  if (
    upload.origin !== new URL(getApiBase()).origin ||
    !/^\/api\/storage\/upload\/[0-9a-f-]+$/i.test(upload.pathname)
  )
    throw new Error("Unexpected upload destination");
  const response = await fetch(upload.toString(), {
    method: "PUT",
    body: blob,
    headers: { "content-type": asset.mimeType ?? blob.type },
    signal,
  });
  current();
  if (!response.ok) throw new Error(`Photo upload failed (${response.status})`);
  const saved = await apiFetch<{ objectPath: string }>(
    `${endpoint}/${invitation ? "upload-finalize" : "finalize"}`,
    {
      method: "POST",
      signal,
      body: JSON.stringify({
        objectURL: descriptor.uploadURL,
        ...(!invitation ? { visibility: "public" } : {}),
      }),
    },
    scope,
  );
  current();
  if (saved.objectPath !== descriptor.objectPath)
    throw new Error("Photo upload result could not be verified");
  return `/api/storage${saved.objectPath}`;
}
