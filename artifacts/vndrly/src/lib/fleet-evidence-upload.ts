import { FleetRequestError } from "./fleet-client";
export type FleetEvidenceUpload = {
  file: File;
  descriptor?: { uploadURL: string; objectPath: string };
  uploaded?: boolean;
  finalizedPath?: string;
};
export function validateFleetEvidenceFile(file: File) {
  if (
    !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(
      file.type,
    ) ||
    file.size < 1 ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error("Unsupported Fleet file");
}
export async function fleetEvidenceFileSha256(file: File) {
  validateFleetEvidenceFile(file);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
async function checked(response: Response) {
  if (!response.ok)
    throw new FleetRequestError(
      "fleet.evidence_upload_refused",
      response.status,
    );
  return response;
}
/** Retain this stage and File unchanged after an uncertain response; no association is claimed here. */
export async function uploadFleetEvidence(
  stage: FleetEvidenceUpload,
  current: () => boolean,
): Promise<string> {
  const check = () => {
    if (!current()) throw new Error("Fleet account changed");
  };
  check();
  validateFleetEvidenceFile(stage.file);
  if (!stage.descriptor) {
    const response = await checked(
      await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: stage.file.name,
          size: stage.file.size,
          contentType: stage.file.type,
        }),
      }),
    );
    check();
    const value = await response.json();
    check();
    const url = new URL(value.uploadURL, window.location.origin);
    if (
      url.origin !== window.location.origin ||
      !/^\/api\/storage\/upload\/[0-9a-f-]{36}$/i.test(url.pathname) ||
      !/^\/objects\/uploads\/[0-9a-f-]{36}$/i.test(value.objectPath)
    )
      throw new Error("Invalid Fleet upload destination");
    stage.descriptor = { uploadURL: url.href, objectPath: value.objectPath };
  }
  if (!stage.uploaded) {
    await checked(
      await fetch(stage.descriptor.uploadURL, {
        method: "PUT",
        headers: { "Content-Type": stage.file.type },
        body: stage.file,
      }),
    );
    check();
    stage.uploaded = true;
  }
  if (!stage.finalizedPath) {
    const response = await checked(
      await fetch("/api/storage/uploads/finalize", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objectURL: stage.descriptor.uploadURL,
          visibility: "private",
        }),
      }),
    );
    check();
    const value = await response.json();
    check();
    if (value.objectPath !== stage.descriptor.objectPath)
      throw new Error("Fleet private upload outcome mismatch");
    stage.finalizedPath = value.objectPath;
  }
  check();
  return stage.finalizedPath!;
}
