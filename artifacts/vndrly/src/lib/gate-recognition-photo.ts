/** Decode first; preserve useful character detail and normalize orientation/format. */
export async function normalizeGatePhoto(file: File): Promise<File> {
  if (file.size > 8 * 1024 * 1024 || !file.type.startsWith("image/"))
    throw new Error("Select a photo smaller than 8 MB.");
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    if (bitmap.width < 160 || bitmap.height < 80) throw new Error("Retake a larger, clearer photo.");
    const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Photo processing is unavailable.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Photo conversion failed.")), "image/jpeg", 0.9));
    if (blob.size > 8 * 1024 * 1024) throw new Error("Retake a closer photo.");
    return new File([blob], "gate-photo.jpg", { type: "image/jpeg" });
  } finally { bitmap.close(); }
}
