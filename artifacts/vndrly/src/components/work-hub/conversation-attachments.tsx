import { useEffect, useRef, useState } from "react";
import { Camera, Image, Paperclip, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import BrandPillButton from "@/components/brand-pill-button";

// Selection stays in memory; the existing Files pane requires an explicit Upload.
export function ConversationAttachments({ onSelect, photosOnly = false }: { onSelect: (file: File) => void; photosOnly?: boolean }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [open, setOpen] = useState(false);
  const [camera, setCamera] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!camera) return;
    let cancelled = false;
    let stream: MediaStream | undefined;
    setReady(false);
    setError("");
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera unavailable. Use Choose photo instead.");
        const acquired = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (cancelled) { acquired.getTracks().forEach(track => track.stop()); return; }
        stream = acquired;
        if (video.current) video.current.srcObject = stream;
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error && cause.name === "NotAllowedError"
          ? "Camera permission was denied. Allow camera access or use Choose photo."
          : "Camera unavailable. Check your camera or use Choose photo.");
      }
    })();
    return () => { cancelled = true; stream?.getTracks().forEach(track => track.stop()); };
  }, [camera]);
  const choose = (file?: File) => { if (file) onSelect(file); };
  const capture = () => {
    const source = video.current;
    if (!source?.videoWidth || !source.videoHeight) return;
    const canvas = document.createElement("canvas");
    canvas.width = source.videoWidth; canvas.height = source.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) { setError("Could not capture photo. Try Choose photo instead."); return; }
    context.drawImage(source, 0, 0);
    canvas.toBlob(blob => {
      if (!blob) { setError("Could not capture photo. Please try again."); return; }
      onSelect(new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" }));
      setCamera(false);
    }, "image/jpeg", 0.9);
  };
  return <div className="relative">
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><button type="button" className="hub-conversation-tool" aria-label={photosOnly ? "Add receipt photo" : "Add attachment"} title={photosOnly ? "Add receipt photo" : "Add attachment"}>{photosOnly ? <Camera className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}</button></PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-48 rounded-xl border-2 bg-[#242426] p-1 text-[#ececec]" style={{ borderColor: "var(--brand-primary)" }}>
        {[
          { label: "Attach file", Icon: Paperclip, action: () => fileInput.current?.click() },
          { label: "Choose photo", Icon: Image, action: () => photoInput.current?.click() },
          { label: "Take photo", Icon: Camera, action: () => setCamera(true) },
        ].filter(item => !photosOnly || item.label !== "Attach file").map(({ label, Icon, action }) => <button key={label} type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-[#454548] focus-visible:bg-[#454548]" onClick={() => { setOpen(false); action(); }}><Icon className="h-4 w-4" aria-hidden="true" />{label}</button>)}
      </PopoverContent>
    </Popover>
    <input ref={fileInput} type="file" hidden aria-label="Attach file picker" onChange={event => { choose(event.target.files?.[0]); event.target.value = ""; }} />
    <input ref={photoInput} type="file" accept="image/*" hidden aria-label="Choose photo picker" onChange={event => { choose(event.target.files?.[0]); event.target.value = ""; }} />
    {camera && <section aria-label="Take photo" className="absolute bottom-10 left-0 z-40 w-72 max-w-[80vw] space-y-2 rounded-xl border-2 bg-[#242426] p-3" style={{ borderColor: "var(--brand-primary)" }} onKeyDown={event => { if (event.key === "Escape") setCamera(false); }}>
      <video ref={video} autoPlay playsInline muted aria-label="Camera preview" className="w-full rounded-lg" onLoadedData={() => setReady(true)} />
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <div className="flex justify-end gap-2"><BrandPillButton onClick={() => setCamera(false)}>Cancel</BrandPillButton><BrandPillButton disabled={!ready} onClick={capture}>Take photo</BrandPillButton></div>
    </section>}
  </div>;
}
