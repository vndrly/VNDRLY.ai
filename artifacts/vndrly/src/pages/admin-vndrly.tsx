// VNDRLY admin self-edit page.
//
// Mirrors the partner/vendor "edit company info" surface so a system
// admin (role=admin) can manage VNDRLY's own platform_settings row
// (company info + brand) AND the list of fellow system administrators.
//
// Only reachable when role=admin — the route guard in App.tsx already
// gates AdminRoutes, but we additionally early-return here to be safe
// if the page is ever wired into a non-admin shell.

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPlatformSettings,
  useUpdatePlatformSettings,
  getGetPlatformSettingsQueryKey,
  useListAdminUsers,
  useCreateAdminUser,
  getListAdminUsersQueryKey,
  useListDemoUserLabels,
  useUpsertDemoUserLabel,
  getListDemoUserLabelsQueryKey,
  type UpdatePlatformSettingsBody,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import { PngPillButton } from "@/components/png-pill-rollover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Upload, X, ShieldCheck, Copy, Languages, Undo2 } from "lucide-react";
import { formatPhone, handlePhoneInput, stripPhone } from "@/lib/utils";
import {
  compressMainLogo,
  fitImageIntoSquare,
  isSquareWithinTolerance,
} from "@/lib/image-resize";
import { SquareLogoCropDialog } from "@/components/square-logo-crop-dialog";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type FormState = {
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  physicalAddress: string;
  billingAddress: string;
  businessPhone: string;
  hoursOfOperation: string;
  blurb: string;
  brandPrimaryColor: string;
  brandAccentColor: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  physicalAddress: "",
  billingAddress: "",
  businessPhone: "",
  hoursOfOperation: "",
  blurb: "",
  brandPrimaryColor: "",
  brandAccentColor: "",
};

// Same upload-then-finalize dance the vendor + partner edit pages use,
// returning the public storage URL the caller should persist.
async function uploadImageAndGetUrl(file: File): Promise<string> {
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
  return `${API_BASE}/api/storage${objectPath}`;
}

export default function AdminVndrly() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings, isLoading: settingsLoading } = useGetPlatformSettings({
    query: { enabled: user?.role === "admin", queryKey: getGetPlatformSettingsQueryKey() },
  });
  const updateSettings = useUpdatePlatformSettings();

  const { data: admins, isLoading: adminsLoading } = useListAdminUsers({
    query: { enabled: user?.role === "admin", queryKey: getListAdminUsersQueryKey() },
  });
  const createAdmin = useCreateAdminUser();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!settings || hydrated) return;
    setForm({
      name: settings.name ?? "",
      contactName: settings.contactName ?? "",
      contactEmail: settings.contactEmail ?? "",
      contactPhone: settings.contactPhone ? formatPhone(settings.contactPhone) : "",
      physicalAddress: settings.physicalAddress ?? "",
      billingAddress: settings.billingAddress ?? "",
      businessPhone: settings.businessPhone ? formatPhone(settings.businessPhone) : "",
      hoursOfOperation: settings.hoursOfOperation ?? "",
      blurb: settings.blurb ?? "",
      brandPrimaryColor: settings.brandPrimaryColor ?? "",
      brandAccentColor: settings.brandAccentColor ?? "",
    });
    setHydrated(true);
  }, [settings, hydrated]);

  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingSquareLogo, setUploadingSquareLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const squareLogoInputRef = useRef<HTMLInputElement>(null);
  // Source file for the SquareLogoCropDialog. Set on non-square
  // selection in onLogoFile; cleared on confirm/cancel.
  const [pendingSquareLogoFile, setPendingSquareLogoFile] = useState<File | null>(null);

  if (user?.role !== "admin") {
    return (
      <div className="p-6 text-sm text-muted-foreground">Admin role required.</div>
    );
  }

  const persistLogo = (key: "logoUrl" | "logoSquareUrl", value: string | null) => {
    const body: UpdatePlatformSettingsBody = { [key]: value };
    updateSettings.mutate(
      { data: body },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetPlatformSettingsQueryKey() });
          toast({ title: value ? "Logo uploaded" : "Logo removed" });
        },
        onError: () => toast({ title: "Failed to save logo", variant: "destructive" }),
      },
    );
  };

  // Uploads an already-normalized 512×512 PNG to storage and writes
  // `logoSquareUrl` on platform_settings. Shared between the
  // skip-cropper branch (square / SVG inputs) and the
  // SquareLogoCropDialog confirm callback.
  const uploadSquareLogo = async (normalized: File) => {
    setUploadingSquareLogo(true);
    try {
      const url = await uploadImageAndGetUrl(normalized);
      persistLogo("logoSquareUrl", url);
    } catch {
      toast({ title: "Failed to upload logo", variant: "destructive" });
    } finally {
      setUploadingSquareLogo(false);
    }
  };

  const onLogoFile = async (e: React.ChangeEvent<HTMLInputElement>, kind: "main" | "square") => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please select an image file", variant: "destructive" });
      return;
    }
    if (kind === "main") {
      setUploadingLogo(true);
      try {
        // Cap longest edge at ~1024px so multi-MB brand-kit exports
        // don't slow down every modal-header / admin-page render. SVG
        // passes through unchanged.
        const compressed = await compressMainLogo(file);
        const url = await uploadImageAndGetUrl(compressed);
        persistLogo("logoUrl", url);
      } catch {
        toast({ title: "Failed to upload logo", variant: "destructive" });
      } finally {
        setUploadingLogo(false);
        if (logoInputRef.current) logoInputRef.current.value = "";
      }
      return;
    }

    // Square-logo path: gate behind the cropper for non-square inputs;
    // SVG and already-square (within 2%) inputs upload immediately.
    try {
      const skipCropper = await isSquareWithinTolerance(file);
      if (skipCropper) {
        const normalized = await fitImageIntoSquare(file);
        await uploadSquareLogo(normalized);
      } else {
        setPendingSquareLogoFile(file);
      }
    } catch {
      toast({ title: "Failed to read image", variant: "destructive" });
    } finally {
      // Reset so re-selecting the same file fires onChange again.
      if (squareLogoInputRef.current) squareLogoInputRef.current.value = "";
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings.mutate(
      {
        data: {
          name: form.name,
          contactName: form.contactName || null,
          contactEmail: form.contactEmail || null,
          contactPhone: stripPhone(form.contactPhone) || null,
          physicalAddress: form.physicalAddress || null,
          billingAddress: form.billingAddress || null,
          businessPhone: stripPhone(form.businessPhone) || null,
          hoursOfOperation: form.hoursOfOperation || null,
          blurb: form.blurb || null,
          brandPrimaryColor: form.brandPrimaryColor || null,
          brandAccentColor: form.brandAccentColor || null,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetPlatformSettingsQueryKey() });
          toast({ title: "Settings saved" });
        },
        onError: () => toast({ title: "Failed to save settings", variant: "destructive" }),
      },
    );
  };

  // ─── Add Admin dialog ────────────────────────────────────────────
  const [addAdminOpen, setAddAdminOpen] = useState(false);
  const [adminForm, setAdminForm] = useState({ displayName: "", email: "" });
  // The temp password is only shown once, in-modal, after a successful
  // create — never re-fetchable. Admin must copy or write it down before
  // dismissing the dialog.
  const [createdTempPassword, setCreatedTempPassword] = useState<string | null>(null);

  const handleCreateAdmin = (e: React.FormEvent) => {
    e.preventDefault();
    createAdmin.mutate(
      { data: adminForm },
      {
        onSuccess: (resp) => {
          queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
          setCreatedTempPassword(resp.temporaryPassword);
          setAdminForm({ displayName: "", email: "" });
        },
        onError: (err) => {
          // ApiError from custom-fetch carries a numeric `status`; the
          // Error fallback message also includes the HTTP code as a string.
          // Narrow structurally to avoid an `any` cast here.
          const status = (err as { status?: unknown })?.status;
          const message = err instanceof Error ? err.message : "";
          const isConflict = status === 409 || message.includes("409");
          toast({
            title: isConflict ? "That email is already registered" : "Failed to create admin",
            variant: "destructive",
          });
        },
      },
    );
  };

  const closeAdminDialog = (open: boolean) => {
    setAddAdminOpen(open);
    if (!open) {
      setAdminForm({ displayName: "", email: "" });
      setCreatedTempPassword(null);
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-vndrly-page">
      <SquareLogoCropDialog
        file={pendingSquareLogoFile}
        onConfirm={async (cropped) => {
          setPendingSquareLogoFile(null);
          await uploadSquareLogo(cropped);
        }}
        onClose={() => setPendingSquareLogoFile(null)}
      />
      <div>
        <p className="text-sm font-medium text-muted-foreground">VNDRLY</p>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">VNDRLY Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage VNDRLY's company information, branding, and system administrators.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Company Information</CardTitle>
        </CardHeader>
        <CardContent>
          {settingsLoading ? (
            <div className="space-y-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
          ) : (
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <Label>Company Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="input-company-name" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Primary Contact Name</Label>
                  <Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} data-testid="input-contact-name" />
                </div>
                <div>
                  <Label>Primary Contact Email</Label>
                  <Input type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} data-testid="input-contact-email" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Contact Phone</Label>
                  <Input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: handlePhoneInput(e.target.value) })} data-testid="input-contact-phone" />
                </div>
                <div>
                  <Label>Business Phone</Label>
                  <Input value={form.businessPhone} onChange={(e) => setForm({ ...form, businessPhone: handlePhoneInput(e.target.value) })} data-testid="input-business-phone" />
                </div>
              </div>
              <div>
                <Label>Physical Address</Label>
                <Input value={form.physicalAddress} onChange={(e) => setForm({ ...form, physicalAddress: e.target.value })} data-testid="input-physical-address" />
              </div>
              <div>
                <Label>Billing Address</Label>
                <Input value={form.billingAddress} onChange={(e) => setForm({ ...form, billingAddress: e.target.value })} data-testid="input-billing-address" />
              </div>
              <div>
                <Label>Hours of Operation</Label>
                <Input value={form.hoursOfOperation} onChange={(e) => setForm({ ...form, hoursOfOperation: e.target.value })} placeholder="e.g. Mon–Fri 8am–6pm CT" data-testid="input-hours" />
              </div>
              <div>
                <Label>Blurb</Label>
                <Textarea value={form.blurb} onChange={(e) => setForm({ ...form, blurb: e.target.value })} rows={3} data-testid="input-blurb" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Brand Primary Color</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="color"
                      value={form.brandPrimaryColor || "#000000"}
                      onChange={(e) => setForm({ ...form, brandPrimaryColor: e.target.value })}
                      className="h-9 w-12 rounded border cursor-pointer"
                      data-testid="input-brand-primary-color"
                    />
                    <Input
                      value={form.brandPrimaryColor}
                      onChange={(e) => setForm({ ...form, brandPrimaryColor: e.target.value })}
                      placeholder="#f59e0b"
                      className="font-mono"
                    />
                    {form.brandPrimaryColor && (
                      <PillButton type="button" color="image" onClick={() => setForm({ ...form, brandPrimaryColor: "" })} className="min-w-[28px] px-0">
                        <X className="w-4 h-4" />
                      </PillButton>
                    )}
                  </div>
                </div>
                <div>
                  <Label>Brand Accent Color</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="color"
                      value={form.brandAccentColor || "#000000"}
                      onChange={(e) => setForm({ ...form, brandAccentColor: e.target.value })}
                      className="h-9 w-12 rounded border cursor-pointer"
                      data-testid="input-brand-accent-color"
                    />
                    <Input
                      value={form.brandAccentColor}
                      onChange={(e) => setForm({ ...form, brandAccentColor: e.target.value })}
                      placeholder="#616161"
                      className="font-mono"
                    />
                    {form.brandAccentColor && (
                      <PillButton type="button" color="image" onClick={() => setForm({ ...form, brandAccentColor: "" })} className="min-w-[28px] px-0">
                        <X className="w-4 h-4" />
                      </PillButton>
                    )}
                  </div>
                </div>
              </div>
              <PngPillButton
                color="blue"
                type="submit"
                disabled={updateSettings.isPending}
                className="px-10"
                data-testid="button-save-settings"
              >
                {updateSettings.isPending ? "Saving..." : "Save Changes"}
              </PngPillButton>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Logos</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="text-sm font-medium mb-1">Main Logo</div>
              <p className="text-xs text-muted-foreground mb-3">Used in modal headers and other irregular slots. Any aspect ratio.</p>
              <div className="w-32 h-32 rounded-lg border bg-muted flex items-center justify-center overflow-hidden mb-2">
                {settings?.logoUrl ? (
                  <img src={settings.logoUrl} alt="VNDRLY Logo" className="w-full h-full object-contain" data-testid="img-platform-logo" />
                ) : (
                  <span className="text-xs text-muted-foreground">No logo</span>
                )}
              </div>
              <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => onLogoFile(e, "main")} data-testid="input-logo-file" />
              <div className="flex gap-2">
                <PillButton type="button" color="image" onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo} data-testid="button-upload-logo">
                  <Upload className="w-4 h-4 mr-1" />{uploadingLogo ? "Uploading..." : settings?.logoUrl ? "Replace" : "Upload"}
                </PillButton>
                {settings?.logoUrl && (
                  <PillButton type="button" color="red" onClick={() => persistLogo("logoUrl", null)} data-testid="button-remove-logo">
                    <X className="w-4 h-4 mr-1" />Remove
                  </PillButton>
                )}
              </div>
            </div>

            <div>
              <div className="text-sm font-medium mb-1">Square Logo (1:1)</div>
              <p className="text-xs text-muted-foreground mb-3">Used in the navigation sidebar at 64×64. Falls back to main logo when not set.</p>
              <div className="w-32 h-32 rounded-lg border bg-muted flex items-center justify-center overflow-hidden mb-2">
                {settings?.logoSquareUrl ? (
                  <img src={settings.logoSquareUrl} alt="VNDRLY Square Logo" className="w-full h-full object-contain" data-testid="img-platform-logo-square" />
                ) : (
                  <span className="text-xs text-muted-foreground">No square logo</span>
                )}
              </div>
              <input ref={squareLogoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => onLogoFile(e, "square")} data-testid="input-logo-square-file" />
              <div className="flex gap-2">
                <PillButton type="button" color="image" onClick={() => squareLogoInputRef.current?.click()} disabled={uploadingSquareLogo} data-testid="button-upload-logo-square">
                  <Upload className="w-4 h-4 mr-1" />{uploadingSquareLogo ? "Uploading..." : settings?.logoSquareUrl ? "Replace" : "Upload"}
                </PillButton>
                {settings?.logoSquareUrl && (
                  <PillButton type="button" color="red" onClick={() => persistLogo("logoSquareUrl", null)} data-testid="button-remove-logo-square">
                    <X className="w-4 h-4 mr-1" />Remove
                  </PillButton>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-amber-500" />
            VNDRLY Employees ({admins?.length ?? 0})
          </CardTitle>
          <Dialog open={addAdminOpen} onOpenChange={closeAdminDialog}>
            <DialogTrigger asChild>
              <PillButton color="blue" data-testid="button-add-admin"><Plus className="w-4 h-4 mr-1" />Add Employee</PillButton>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add VNDRLY Employee</DialogTitle>
                <DialogDescription>
                  Create a new system administrator. They'll receive a one-time temporary password they must change on first login.
                </DialogDescription>
              </DialogHeader>
              {createdTempPassword ? (
                <div className="space-y-4">
                  <p className="text-sm">
                    Admin created. Share the temporary password below with them — it will not be shown again.
                  </p>
                  <div className="flex items-center gap-2">
                    <Input readOnly value={createdTempPassword} className="font-mono" data-testid="text-temp-password" />
                    <PillButton
                      type="button"
                      color="image"
                      onClick={() => {
                        navigator.clipboard.writeText(createdTempPassword);
                        toast({ title: "Copied" });
                      }}
                      data-testid="button-copy-temp-password"
                    >
                      <Copy className="w-4 h-4 mr-1" />Copy
                    </PillButton>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    They'll be required to set their own password on first login.
                  </p>
                  <PillButton type="button" color="blue" onClick={() => closeAdminDialog(false)} data-testid="button-done-adding-admin">Done</PillButton>
                </div>
              ) : (
                <form onSubmit={handleCreateAdmin} className="space-y-4">
                  <div>
                    <Label>Display Name</Label>
                    <Input value={adminForm.displayName} onChange={(e) => setAdminForm({ ...adminForm, displayName: e.target.value })} required data-testid="input-admin-display-name" />
                  </div>
                  <div>
                    <Label>Email</Label>
                    <Input type="email" value={adminForm.email} onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })} required data-testid="input-admin-email" />
                  </div>
                  <PillButton type="submit" color="blue" disabled={createAdmin.isPending} className="w-full" data-testid="button-submit-add-admin">
                    {createAdmin.isPending ? "Creating..." : "Create Admin"}
                  </PillButton>
                </form>
              )}
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="p-0">
          {adminsLoading ? (
            <div className="p-6 space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : admins && admins.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {admins.map((a) => (
                  <TableRow key={a.id} data-testid={`row-admin-${a.id}`}>
                    <TableCell className="font-medium">{a.displayName}</TableCell>
                    <TableCell>{a.email ?? a.username}</TableCell>
                    <TableCell>
                      {a.suspendedAt ? (
                        <span className="inline-flex items-center h-[23px] px-3 text-xs font-normal rounded-full bg-muted text-muted-foreground">Suspended</span>
                      ) : (
                        <span className="inline-flex items-center h-[23px] px-3 text-xs font-normal rounded-full bg-green-100 text-green-800">Active</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-6 text-center text-muted-foreground text-sm">No system administrators yet.</div>
          )}
        </CardContent>
      </Card>

      <DemoUserLabelsCard />
    </div>
  );
}

// ─── Demo Account Labels card ────────────────────────────────────
//
// Editable per-locale labels for the demo accounts surfaced by the
// dev-only `GET /api/auth/demo-users`. The canonical demo-user list
// still lives in source so seeding stays self-contained, but
// admins can retranslate any (username, locale) label here without
// a code deploy. Saving an empty input clears the override and falls
// back to the source default.
function DemoUserLabelsCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useListDemoUserLabels({
    query: { queryKey: getListDemoUserLabelsQueryKey() },
  });
  const upsert = useUpsertDemoUserLabel();

  // Local edit buffer so typing doesn't refetch on every keystroke.
  // Keyed by `${username}|${locale}` -> current input string.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Languages className="w-5 h-5 text-amber-500" />
            Demo Account Labels
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
        </CardContent>
      </Card>
    );
  }

  const { locales, entries } = data;

  const draftKey = (username: string, locale: string) => `${username}|${locale}`;

  const currentValue = (username: string, locale: string, override: string | undefined) => {
    const k = draftKey(username, locale);
    if (k in drafts) return drafts[k];
    return override ?? "";
  };

  const save = (username: string, locale: string, label: string | null) => {
    upsert.mutate(
      { data: { username, locale, label } },
      {
        onSuccess: () => {
          // Clear the local draft for this cell so the new server-side
          // value (with empty -> default fallback applied) is what's
          // displayed on the next render.
          setDrafts((d) => {
            const next = { ...d };
            delete next[draftKey(username, locale)];
            return next;
          });
          queryClient.invalidateQueries({ queryKey: getListDemoUserLabelsQueryKey() });
          toast({ title: label ? "Label saved" : "Override cleared" });
        },
        onError: () => toast({ title: "Failed to save label", variant: "destructive" }),
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Languages className="w-5 h-5 text-amber-500" />
          Demo Account Labels
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Edit how each demo account appears on the dev-only login picker, per language. Leave a field blank and save to fall back to the built-in default.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              {locales.map((loc) => (
                <TableHead key={loc} className="uppercase">{loc}</TableHead>
              ))}
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.username} data-testid={`row-demo-label-${entry.username}`}>
                <TableCell className="font-medium align-top">
                  <div>{entry.displayName}</div>
                  <div className="text-xs text-muted-foreground font-mono">{entry.username}</div>
                </TableCell>
                {locales.map((loc) => {
                  const override = entry.overrides[loc];
                  const fallback = entry.defaults[loc] ?? entry.defaults["en"] ?? "";
                  const value = currentValue(entry.username, loc, override);
                  const trimmed = value.trim();
                  const draftKeyStr = draftKey(entry.username, loc);
                  const isDirty = draftKeyStr in drafts && trimmed !== (override ?? "");
                  const willClear = isDirty && trimmed.length === 0;
                  return (
                    <TableCell key={loc} className="align-top min-w-[12rem]">
                      <div className="space-y-1">
                        <Input
                          value={value}
                          placeholder={fallback}
                          onChange={(e) => setDrafts((d) => ({ ...d, [draftKeyStr]: e.target.value }))}
                          data-testid={`input-demo-label-${entry.username}-${loc}`}
                        />
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {override === undefined ? (
                            <span>Default: {fallback}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-700">
                              <Undo2 className="w-3 h-3" /> Override active
                            </span>
                          )}
                          {isDirty && (
                            <PillButton
                              type="button"
                              color={willClear ? "red" : "blue"}
                              className="ml-auto h-7 px-2"
                              disabled={upsert.isPending}
                              onClick={() => save(entry.username, loc, willClear ? null : trimmed)}
                              data-testid={`button-save-demo-label-${entry.username}-${loc}`}
                            >
                              {willClear ? "Clear" : "Save"}
                            </PillButton>
                          )}
                          {!isDirty && override !== undefined && (
                            <PillButton
                              type="button"
                              color="image"
                              className="ml-auto h-7 px-2"
                              disabled={upsert.isPending}
                              onClick={() => save(entry.username, loc, null)}
                              data-testid={`button-clear-demo-label-${entry.username}-${loc}`}
                            >
                              Reset
                            </PillButton>
                          )}
                        </div>
                      </div>
                    </TableCell>
                  );
                })}
                <TableCell />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
