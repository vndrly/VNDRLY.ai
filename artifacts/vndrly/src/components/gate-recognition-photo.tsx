import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import BlueButton from "./blue-button";

/** Optional operator-selected crop: never infer which background vehicle was intended. */
export function GateRecognitionPhoto({ src, disabled, onCrop }: {
  src: string; disabled: boolean; onCrop: (file: File) => void;
}) {
  const { t } = useTranslation();
  const photo = useRef<HTMLImageElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [box, setBox] = useState({ x: 0, y: 0, w: 1, h: 1 });
  const [cropping, setCropping] = useState(false);
  const [failed, setFailed] = useState(false);
  const crop = async () => {
    const image = photo.current;
    if (!image || disabled || cropping) return;
    setCropping(true);
    setFailed(false);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * box.w));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * box.h));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas unavailable");
      ctx.drawImage(image, image.naturalWidth * box.x, image.naturalHeight * box.y,
        image.naturalWidth * box.w, image.naturalHeight * box.h, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("crop failed")), "image/jpeg", .95));
      onCrop(new File([blob], "plate-crop.jpg", { type: "image/jpeg" }));
    } catch { setFailed(true); } finally { setCropping(false); }
  };
  return <div className="space-y-2">
    <p className="text-sm">{t("gatekeeper.recognitionCropGuide")}</p>
    <div className="relative inline-block max-w-full touch-none select-none" onPointerDown={event => {
      if (disabled) return;
      const rect = event.currentTarget.getBoundingClientRect();
      start.current = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={event => {
      if (!start.current || disabled) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
      setBox({ x: Math.min(x, start.current.x), y: Math.min(y, start.current.y), w: Math.abs(x - start.current.x), h: Math.abs(y - start.current.y) });
    }} onPointerUp={() => { start.current = null; }} onPointerCancel={() => { start.current = null; }}>
      <img ref={photo} src={src} alt={t("gatekeeper.recognitionPhoto")} draggable={false} className="block max-h-64 max-w-full rounded" />
      <div className="pointer-events-none absolute border-2 border-amber-400" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }} />
    </div>
    <details><summary>{t("gatekeeper.recognitionCropControls")}</summary>
      {(["x", "y", "w", "h"] as const).map((key, i) => <label key={key} className="block text-sm">
        {t(["gatekeeper.cropLeft", "gatekeeper.cropTop", "gatekeeper.cropWidth", "gatekeeper.cropHeight"][i])}
        <input type="range" min="0" max="100" value={Math.round(box[key] * 100)} disabled={disabled} onChange={e => {
          const next = { ...box, [key]: Number(e.target.value) / 100 };
          next.w = Math.min(next.w, 1 - next.x); next.h = Math.min(next.h, 1 - next.y); setBox(next);
        }} />
      </label>)}
    </details>
    <BlueButton disabled={disabled || cropping || box.w < .05 || box.h < .05} onClick={() => void crop()}>{t("gatekeeper.recognitionReadCrop")}</BlueButton>
    {failed && <p role="alert">{t("gatekeeper.recognitionCaptureFailed")}</p>}
  </div>;
}
