import * as ImagePicker from "expo-image-picker";

import { apiFetch, getApiBase } from "./api";
import { isAuthScopeCurrent, type AuthScope } from "./auth";

export type UploadResult = {
  objectPath: string;
  contentType: string;
  size: number;
};

function resolveUploadUrl(uploadURL: string): string {
  if (/^https?:\/\//i.test(uploadURL)) return uploadURL;
  const base = getApiBase().replace(/\/$/, "");
  return `${base}${uploadURL.startsWith("/") ? uploadURL : `/${uploadURL}`}`;
}

export async function pickAndUploadImage(): Promise<UploadResult | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (perm.status !== "granted") {
    throw new Error("Photo library permission denied");
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.6,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  return uploadAsset(result.assets[0]);
}

export async function captureAndUploadImage(options?: {
  maxBytes?: number;
  purpose?: "gate-evidence";
  authScope?: AuthScope;
}): Promise<UploadResult | null> {
  assertCurrent(options?.authScope);
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  assertCurrent(options?.authScope);
  if (perm.status !== "granted") {
    throw new Error("Camera permission denied");
  }
  const result = await ImagePicker.launchCameraAsync({
    quality: 0.6,
    allowsEditing: false,
  });
  assertCurrent(options?.authScope);
  if (result.canceled || !result.assets?.[0]) return null;
  return uploadAsset(
    result.assets[0],
    options?.maxBytes,
    options?.purpose,
    options?.authScope,
  );
}

function assertCurrent(scope?: AuthScope) {
  if (scope && !isAuthScopeCurrent(scope))
    throw Object.assign(new Error("Request authorization changed"), {
      name: "AbortError",
    });
}

async function uploadAsset(
  asset: ImagePicker.ImagePickerAsset,
  maxBytes?: number,
  purpose?: "gate-evidence",
  authScope?: AuthScope,
): Promise<UploadResult> {
  assertCurrent(authScope);
  const contentType = asset.mimeType || "image/jpeg";
  const name = asset.fileName || `photo-${Date.now()}.jpg`;

  const blob = await fetch(asset.uri).then((r) => r.blob());
  assertCurrent(authScope);
  const size = blob.size || asset.fileSize || 0;
  if (
    authScope &&
    (!blob.size ||
      !["image/jpeg", "image/png", "image/webp"].includes(contentType))
  )
    throw new Error("A nonempty JPEG, PNG or WebP photo is required");
  if (maxBytes && size > maxBytes) {
    throw new Error(
      `Photo is too large to upload. Use an image smaller than ${Math.floor(maxBytes / (1024 * 1024))} MB.`,
    );
  }

  const presigned = await apiFetch<{ uploadURL: string; objectPath: string }>(
    "/api/storage/uploads/request-url",
    {
      method: "POST",
      body: JSON.stringify({ name, size, contentType }),
    },
    authScope,
  );
  assertCurrent(authScope);

  const putUrl = resolveUploadUrl(presigned.uploadURL);
  if (authScope) {
    const upload = new URL(putUrl),
      base = new URL(getApiBase());
    if (
      upload.origin !== base.origin ||
      !/^\/api\/storage\/upload\/[0-9a-f-]+$/i.test(upload.pathname)
    )
      throw new Error("Unexpected photo upload destination");
  }
  const putRes = await fetch(putUrl, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: blob,
  });
  assertCurrent(authScope);
  if (!putRes.ok) {
    if (putRes.status === 413) {
      throw new Error(
        "Photo is too large to upload. Try again or pick a smaller image from your library.",
      );
    }
    throw new Error(`Upload failed (HTTP ${putRes.status})`);
  }

  const finalized = await apiFetch<{ objectPath: string }>(
    "/api/storage/uploads/finalize",
    {
      method: "POST",
      body: JSON.stringify({
        objectURL: presigned.uploadURL,
        visibility: "private",
        ...(purpose ? { purpose } : {}),
      }),
    },
    authScope,
  );
  assertCurrent(authScope);
  if (authScope && finalized.objectPath !== presigned.objectPath)
    throw new Error("Photo finalization was not verified");

  return { objectPath: presigned.objectPath, contentType, size };
}
