import * as ImagePicker from "expo-image-picker";

import { apiFetch } from "./api";

export type UploadResult = {
  objectPath: string;
  contentType: string;
  size: number;
};

export async function pickAndUploadImage(): Promise<UploadResult | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (perm.status !== "granted") {
    throw new Error("Photo library permission denied");
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.7,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  return uploadAsset(result.assets[0]);
}

export async function captureAndUploadImage(): Promise<UploadResult | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (perm.status !== "granted") {
    throw new Error("Camera permission denied");
  }
  const result = await ImagePicker.launchCameraAsync({
    quality: 0.7,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  return uploadAsset(result.assets[0]);
}

async function uploadAsset(
  asset: ImagePicker.ImagePickerAsset,
): Promise<UploadResult> {
  const contentType = asset.mimeType || "image/jpeg";
  const size = asset.fileSize || 0;
  const name = asset.fileName || `photo-${Date.now()}.jpg`;

  const presigned = await apiFetch<{ uploadURL: string; objectPath: string }>(
    "/api/storage/uploads/request-url",
    {
      method: "POST",
      body: JSON.stringify({ name, size, contentType }),
    },
  );

  const blob = await fetch(asset.uri).then((r) => r.blob());
  const putRes = await fetch(presigned.uploadURL, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: blob,
  });
  if (!putRes.ok) {
    throw new Error(`Upload failed (HTTP ${putRes.status})`);
  }
  return { objectPath: presigned.objectPath, contentType, size };
}
