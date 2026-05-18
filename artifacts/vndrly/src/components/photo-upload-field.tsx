import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Upload, Trash2, User } from "lucide-react";
import BlueButton from "@/components/blue-button";
import RedButton from "@/components/red-button";
import BrandPillButton from "@/components/brand-pill-button";
import { useToast } from "@/hooks/use-toast";
import { translateApiError } from "@/lib/api-error";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function PhotoUploadField({
  value,
  onChange,
  testIdPrefix = "employee-photo",
}: {
  value: string | null | undefined;
  onChange: (url: string | null) => void;
  testIdPrefix?: string;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please select an image file", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const res = await fetch(`${API_BASE}/api/storage/uploads/request-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!res.ok) throw new Error("Failed to get upload URL");
      const { uploadURL, objectPath } = await res.json();
      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadRes.ok) throw new Error("Upload failed");
      await fetch(`${API_BASE}/api/storage/uploads/finalize`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectURL: uploadURL, visibility: "public" }),
      });
      onChange(`${API_BASE}/api/storage${objectPath}`);
      toast({ title: "Photo uploaded" });
    } catch (err: unknown) {
      toast({
        title: translateApiError(err, t, t("errors.upload.photo_failed")),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex items-start gap-4">
      <div className="w-20 h-20 rounded-full border-2 border-gray-200 bg-white flex items-center justify-center overflow-hidden shrink-0">
        {value ? (
          <img src={value} alt="Employee photo" className="w-full h-full object-cover" data-testid={`${testIdPrefix}-preview`} />
        ) : (
          <User className="w-8 h-8 text-gray-300" />
        )}
      </div>
      <div className="flex-1">
        <p className="text-xs text-muted-foreground mb-2">PNG or JPG. Used for on-site identification.</p>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} data-testid={`${testIdPrefix}-input`} />
        <div className="flex gap-2">
          <BrandPillButton tone="blue" type="button" onClick={() => inputRef.current?.click()} disabled={uploading} data-testid={`${testIdPrefix}-upload`}>
            <Upload className="w-4 h-4" />{uploading ? "Uploading..." : value ? "Replace Photo" : "Upload Photo"}
          </BrandPillButton>
          {value && (
            <BrandPillButton tone="red" type="button" onClick={() => onChange(null)} data-testid={`${testIdPrefix}-remove`}>
              <Trash2 className="w-4 h-4" />Remove
            </BrandPillButton>
          )}
        </div>
      </div>
    </div>
  );
}
