const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export async function uploadOnboardingLogo(
  file: File,
  visibility: "public" | "private" = "public",
): Promise<string> {
  const r = await fetch(`${BASE}/api/storage/uploads/request-url`, {
    credentials: "include",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: file.name,
      size: file.size,
      contentType: file.type,
    }),
  });
  if (!r.ok) throw new Error("Could not get upload URL");
  const { uploadURL, objectPath } = (await r.json()) as {
    uploadURL: string;
    objectPath: string;
  };
  const put = await fetch(uploadURL, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  });
  if (!put.ok) throw new Error("Upload failed");
  const fin = await fetch(`${BASE}/api/storage/uploads/finalize`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objectURL: uploadURL, visibility }),
  });
  if (!fin.ok) throw new Error("Finalize failed");
  const { objectPath: finalPath } = (await fin.json()) as { objectPath: string };
  const path = finalPath || objectPath;
  return path.startsWith("/") ? `${BASE}/api/storage${path}` : path;
}
