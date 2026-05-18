// Client-side image normalization for logo uploads.
//
// The "Square Logo (1:1)" slot in vendor / partner / VNDRLY platform
// settings drives the navigation sidebar (web, 64×64) and the iOS field
// app's top-left brand badge (also 64×64, retina-doubled). Without
// pre-processing the file the user picks, two things go wrong:
//
//   1. Non-square uploads (wide wordmarks, tall stacked marks) get
//      stretched or letterboxed at display time. The display-time
//      `object-contain` / `resizeMode="contain"` salvages the aspect
//      ratio, but the *stored* asset is whatever the user picked,
//      which means every consumer (web, iOS, future surfaces) has to
//      keep doing the letterbox math forever.
//
//   2. Multi-megabyte source files (a 4 MB PNG export from a brand
//      kit is common) are downloaded by every iOS app launch and every
//      web sidebar render. At a 64×64 display target, anything larger
//      than ~512 px on a side is wasted bytes.
//
// Normalizing on the client (a) guarantees the stored asset is square,
// (b) caps the dimensions at a sensible retina-friendly size, and
// (c) shrinks payloads to the tens-of-KB range. We deliberately keep
// the transform *additive* (transparent background + center letterbox)
// so a wide wordmark that the user uploads to the square slot is
// preserved in full instead of being center-cropped.
//
// SVG inputs short-circuit: they're already vector and "square" only
// in the sense the renderer makes them so. Rasterizing them via canvas
// would defeat the point.

const DEFAULT_SQUARE_PX = 512;
const DEFAULT_MAIN_LONGEST_EDGE_PX = 1024;

/**
 * Loads a File/Blob into an HTMLImageElement via an object URL. The
 * caller is responsible for cleanup; we revoke as soon as the image
 * resolves so we don't leak blob URLs.
 */
function loadImageFromFile(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

/**
 * Letterbox `file` into a `size`×`size` PNG with a transparent
 * background. The original aspect ratio is preserved (no cropping):
 * the larger dimension is scaled to fill `size`, and the shorter
 * dimension is centered with transparent padding around it.
 *
 * SVG inputs are returned unchanged — they're already resolution-
 * independent and any rasterization would degrade them.
 *
 * Output filename: `<original-stem>-square-<size>.png` so the upload
 * pipeline (which keys off the filename for object-storage paths)
 * doesn't accidentally collide with a user's pre-existing main logo.
 */
export async function fitImageIntoSquare(
  file: File,
  size: number = DEFAULT_SQUARE_PX,
): Promise<File> {
  if (file.type === "image/svg+xml") {
    return file;
  }

  const img = await loadImageFromFile(file);

  // `naturalWidth`/`naturalHeight` are 0 for images that failed to
  // decode despite firing `onload` (e.g. a corrupt file with a valid
  // image MIME). Bail out early so the caller can surface a useful
  // toast instead of uploading a blank canvas.
  if (!img.naturalWidth || !img.naturalHeight) {
    throw new Error("Image has no dimensions");
  }

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context unavailable");
  }

  // High-quality downscale; the default ("low") produces visibly
  // jagged 64×64 thumbnails when the source is 2000×2000+.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;
  const drawX = (size - drawW) / 2;
  const drawY = (size - drawH) / 2;

  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(img, drawX, drawY, drawW, drawH);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob returned null"))),
      "image/png",
    );
  });

  const baseName =
    file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_") || "logo";
  return new File([blob], `${baseName}-square-${size}.png`, {
    type: "image/png",
    lastModified: Date.now(),
  });
}

/**
 * Cap the main-logo upload at `maxLongestEdge` pixels on its longer side
 * while preserving aspect ratio, re-encoding to PNG so transparency is
 * retained. Used by the "Main Logo" slot which is intentionally NOT
 * cropped to square — modal headers and other wide consumers want the
 * original aspect ratio. The goal here is purely payload size: a 4 MB
 * brand-kit export becomes a tens-of-KB PNG that still renders crisp at
 * every consumed display size.
 *
 * Images that already fit within `maxLongestEdge` are still re-encoded
 * (not passed through) so the stored MIME type and filename are
 * predictable; the canvas pipeline naturally compresses without
 * upscaling. SVGs are passed through unchanged.
 *
 * Output filename: `<original-stem>-main-<maxLongestEdge>.png`.
 */
export async function compressMainLogo(
  file: File,
  maxLongestEdge: number = DEFAULT_MAIN_LONGEST_EDGE_PX,
): Promise<File> {
  if (file.type === "image/svg+xml") {
    return file;
  }

  const img = await loadImageFromFile(file);
  if (!img.naturalWidth || !img.naturalHeight) {
    throw new Error("Image has no dimensions");
  }

  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  // Never upscale; only cap at maxLongestEdge.
  const scale = longest > maxLongestEdge ? maxLongestEdge / longest : 1;
  const outW = Math.max(1, Math.round(img.naturalWidth * scale));
  const outH = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context unavailable");
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, outW, outH);
  ctx.drawImage(img, 0, 0, outW, outH);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob returned null"))),
      "image/png",
    );
  });

  const baseName =
    file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_") || "logo";
  return new File([blob], `${baseName}-main-${maxLongestEdge}.png`, {
    type: "image/png",
    lastModified: Date.now(),
  });
}

/**
 * Crop a region of the source `file` and return a square PNG of size
 * `outSize` (post-crop, post-resize). Used by the modal cropper to
 * produce the upload-ready file from the user's selected region.
 *
 * `crop` is in source-image pixel coordinates (the same coordinate
 * system react-easy-crop reports). The crop region MUST already be
 * square (cropAspect = 1 in the cropper config); we don't enforce it
 * here so we don't second-guess the caller, but a non-square crop
 * region will be stretched into the square output.
 *
 * SVGs are passed through unchanged: they're vector and re-rasterizing
 * at this stage would defeat the point. (The cropper modal also
 * short-circuits SVGs upstream so this branch is defensive.)
 */
export async function cropToSquare(
  file: File,
  crop: { x: number; y: number; width: number; height: number },
  outSize: number = DEFAULT_SQUARE_PX,
): Promise<File> {
  if (file.type === "image/svg+xml") {
    return file;
  }

  const img = await loadImageFromFile(file);
  if (!img.naturalWidth || !img.naturalHeight) {
    throw new Error("Image has no dimensions");
  }

  const canvas = document.createElement("canvas");
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context unavailable");
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, outSize, outSize);
  ctx.drawImage(
    img,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    outSize,
    outSize,
  );

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob returned null"))),
      "image/png",
    );
  });

  const baseName =
    file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_") || "logo";
  return new File([blob], `${baseName}-square-${outSize}.png`, {
    type: "image/png",
    lastModified: Date.now(),
  });
}

/**
 * True when the image is already square within a small tolerance, so
 * the cropper modal can be skipped. A 1.02 ratio (2%) is generous
 * enough to absorb common JPEG header rounding without surprising the
 * user with an unnecessary modal step.
 */
export async function isSquareWithinTolerance(
  file: File,
  tolerance: number = 0.02,
): Promise<boolean> {
  if (file.type === "image/svg+xml") {
    // Vector inputs scale to whatever box you give them; treat as square.
    return true;
  }
  const img = await loadImageFromFile(file);
  if (!img.naturalWidth || !img.naturalHeight) return false;
  const ratio = img.naturalWidth / img.naturalHeight;
  return Math.abs(ratio - 1) <= tolerance;
}

