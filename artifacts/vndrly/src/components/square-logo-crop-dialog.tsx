import { useCallback, useEffect, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { cropToSquare, fitImageIntoSquare } from "@/lib/image-resize";

type Props = {
  /**
   * The user-selected source file. The dialog opens whenever this is
   * non-null and closes (via `onClose`) when the user confirms or
   * cancels. Pass `null` to close the dialog from the parent (e.g. on
   * unmount).
   */
  file: File | null;
  /**
   * Called with the cropped, normalized 512×512 PNG once the user
   * confirms. The parent is responsible for actually uploading.
   */
  onConfirm: (file: File) => void;
  /**
   * Called when the user cancels (via Cancel button, ESC, or
   * backdrop click). The parent should reset its `file` state to
   * `null` so the dialog stays closed and the same file can be
   * re-selected later.
   */
  onClose: () => void;
};

/**
 * Modal cropper for the "Square Logo (1:1)" upload slot. Wraps
 * react-easy-crop with project-styled dialog chrome and produces a
 * 512×512 PNG via {@link cropToSquare}.
 *
 * UX rationale: previously, picking a wide wordmark for the square
 * slot silently letterboxed it via {@link fitImageIntoSquare}, which
 * looked tiny in the 64×64 nav badge. Forcing the user through a
 * crop step lets them choose the most legible region of their source
 * image (typically their monogram or the icon-only portion of the
 * logo) up-front, so the badge actually fills its container.
 *
 * SVGs short-circuit the crop UI entirely — they're already vector
 * and any letterboxing happens at render-time per consumer. We pass
 * them straight through {@link fitImageIntoSquare} (which itself
 * passes SVG through unchanged) so the parent's onConfirm path is
 * uniform.
 */
export function SquareLogoCropDialog({ file, onConfirm, onClose }: Props) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  // Stable refs over `onConfirm` / `onClose` so the file-change effect
  // below depends only on `file` itself. Otherwise inline callbacks
  // from parent re-renders would re-run the effect mid-cropping,
  // resetting the user's transform and revoking their object URL.
  const onConfirmRef = useRef(onConfirm);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onConfirmRef.current = onConfirm;
    onCloseRef.current = onClose;
  });

  // Manage the object URL lifecycle: create on file change, revoke on
  // change/unmount. Without revocation we'd leak a small amount of
  // memory per upload session. Effect intentionally depends only on
  // `file` (callbacks reach in via refs).
  useEffect(() => {
    if (!file) {
      setImageUrl(null);
      return;
    }
    if (file.type === "image/svg+xml") {
      // SVGs skip the cropper entirely — the parent flow normalizes
      // them via fitImageIntoSquare which is a pass-through for SVG.
      // We immediately confirm so the user isn't blocked by a useless
      // crop UI on a vector asset.
      void (async () => {
        try {
          const normalized = await fitImageIntoSquare(file);
          onConfirmRef.current(normalized);
        } catch {
          // If normalization throws on SVG (it shouldn't — it's a
          // pass-through), surface a toast and close so the user
          // isn't stuck behind an empty modal.
          toast({
            title: "Failed to read image",
            variant: "destructive",
          });
          onCloseRef.current();
        }
      })();
      return;
    }
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    // Reset transform state for each new file so re-uploading doesn't
    // resurrect the previous crop position.
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    return () => URL.revokeObjectURL(url);
  }, [file, toast]);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!file || !croppedAreaPixels) return;
    setSubmitting(true);
    try {
      const cropped = await cropToSquare(file, croppedAreaPixels);
      onConfirm(cropped);
    } catch {
      // Surface failure with a toast and KEEP the modal open so the
      // user can retry — closing silently was the previous behavior
      // and made transient canvas/decode errors look like "the
      // upload silently failed", which is much worse UX than a
      // visible error with the crop selection still intact.
      toast({
        title: "Failed to crop image",
        description: "Try a different region or a different file.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }, [file, croppedAreaPixels, onConfirm, toast]);

  const open = Boolean(file && file.type !== "image/svg+xml");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !submitting) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg" data-testid="square-logo-crop-dialog">
        <DialogHeader>
          <DialogTitle>Crop your square logo</DialogTitle>
          <DialogDescription>
            Pick the region that should appear in the navigation badge. Drag
            to position and use the slider to zoom.
          </DialogDescription>
        </DialogHeader>
        <div className="relative h-72 w-full overflow-hidden rounded-md border bg-muted">
          {imageUrl ? (
            <Cropper
              image={imageUrl}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="rect"
              showGrid
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          ) : null}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="square-logo-zoom">
            Zoom
          </label>
          <Slider
            id="square-logo-zoom"
            min={1}
            max={4}
            step={0.01}
            value={[zoom]}
            onValueChange={(v) => setZoom(v[0] ?? 1)}
            data-testid="square-logo-zoom-slider"
          />
        </div>
        <DialogFooter>
          <PillButton
            type="button"
            color="red"
            onClick={onClose}
            disabled={submitting}
            data-testid="square-logo-crop-cancel"
          >
            Cancel
          </PillButton>
          <PillButton
            type="button"
            color="blue"
            onClick={handleConfirm}
            disabled={!croppedAreaPixels || submitting}
            data-testid="square-logo-crop-confirm"
          >
            {submitting ? "Uploading..." : "Use this crop"}
          </PillButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
