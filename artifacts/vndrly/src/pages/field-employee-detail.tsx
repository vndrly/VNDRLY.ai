import { useState, useEffect, useRef, useMemo } from "react";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { useTranslation } from "react-i18next";
import { useGetFieldEmployee, useUpdateFieldEmployee, useDeleteFieldEmployee, getGetFieldEmployeeQueryKey, useListFieldEmployeeNotes, useCreateFieldEmployeeNote, useDeleteFieldEmployeeNote, getListFieldEmployeeNotesQueryKey, useGetFieldEmployeeLogin, useSetFieldEmployeeLogin, useDeleteFieldEmployeeLogin, getGetFieldEmployeeLoginQueryKey, useCreateFieldOnboardingInvite, useRequestUploadUrl, useFinalizeUpload } from "@workspace/api-client-react";
import type { DeleteFieldEmployeeOpenSession } from "@workspace/api-client-react";
import { formatPhone, handlePhoneInput, stripPhone } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Calendar, Camera, UserCheck, StickyNote, Plus, Trash2, KeyRound, Smartphone } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import BlueButton from "@/components/blue-button";
import { PngPillButton } from "@/components/png-pill-rollover";
import PecStatusBadge from "@/components/pec-status-badge";
import SphereBackButton from "@/components/sphere-back-button";

import RoleBadge from "@/components/role-badge";
import CertificationsSection from "@/components/certifications-section";
import { ComplianceCard } from "@/components/compliance-card";
import AccountActions, { SuspendedPill } from "@/components/account-actions";
import { translateApiError } from "@/lib/api-error";

// Vite-injected base path for this artifact (e.g. "" or "/vndrly"),
// trimmed of a trailing "/". Used only to build read URLs we render
// directly into the DOM (<img src=…>) and the user-facing sign-in hint
// — every mutating call on this page goes through a generated typed
// React Query hook (Task #1046), so we no longer hand-roll fetch URLs
// against `${BASE_PATH}/api/...`.
const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function FieldEmployeeDetail({ id }: { id: number }) {
  const { t } = useTranslation();
  const { data: employee, isLoading } = useGetFieldEmployee(id, { query: { enabled: !!id, queryKey: getGetFieldEmployeeQueryKey(id) } });
  const updateEmployee = useUpdateFieldEmployee();
  const deleteEmployee = useDeleteFieldEmployee();
  const { data: notes } = useListFieldEmployeeNotes(id, { query: { enabled: !!id, queryKey: getListFieldEmployeeNotesQueryKey(id) } });
  const createNote = useCreateFieldEmployeeNote();
  const deleteNote = useDeleteFieldEmployeeNote();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [noteContent, setNoteContent] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  // Task #8: confirmation gate for clearing the mobile-uploaded selfie.
  // We use AlertDialog (rather than window.confirm) so the destructive
  // action matches the rest of the destructive UX on this page (delete
  // employee, delete note) and can be translated.
  const [removePhotoOpen, setRemovePhotoOpen] = useState(false);

  // ── Field Login Credentials ──
  const { data: loginInfo } = useGetFieldEmployeeLogin(id, {
    query: { enabled: !!id, queryKey: getGetFieldEmployeeLoginQueryKey(id) },
  });
  const setLoginMutation = useSetFieldEmployeeLogin();
  const deleteLoginMutation = useDeleteFieldEmployeeLogin();
  // Onboarding-invite mutation (Task #1046): replaces the prior raw
  // `fetch(POST /api/field-employees/:id/onboarding-invite)` so the
  // response is typed as FieldOnboardingInviteResponse and any future
  // schema drift is caught at compile time.
  const onboardingInviteMutation = useCreateFieldOnboardingInvite();
  // Storage upload mutations (Task #1046): the prior code called
  // `fetch(POST /api/storage/uploads/request-url)` and
  // `fetch(POST /api/storage/uploads/finalize)` directly. These two
  // hooks now handle that wire-level work so the field-employee
  // detail page no longer hand-rolls BASE_PATH for mutating calls.
  const requestUploadUrlMutation = useRequestUploadUrl();
  const finalizeUploadMutation = useFinalizeUpload();
  const [credEmail, setCredEmail] = useState("");
  const [credPassword, setCredPassword] = useState("");
  const [credLanguage, setCredLanguage] = useState<"browser" | "en" | "es">("browser");
  const [mustChangePassword, setMustChangePassword] = useState(true);
  const credBusy = setLoginMutation.isPending || deleteLoginMutation.isPending || onboardingInviteMutation.isPending;
  const invalidateLogin = () => queryClient.invalidateQueries({ queryKey: getGetFieldEmployeeLoginQueryKey(id) });
  useEffect(() => { if (loginInfo?.email) setCredEmail(loginInfo.email); }, [loginInfo?.email]);
  useEffect(() => { if (employee && !credEmail) setCredEmail(employee.email); }, [employee, credEmail]);
  useEffect(() => {
    if (loginInfo?.hasLogin) {
      setMustChangePassword(!!loginInfo.mustChangePassword);
    } else {
      setMustChangePassword(true);
    }
  }, [loginInfo?.hasLogin, loginInfo?.mustChangePassword, id]);

  const saveCredentials = async () => {
    if (!credEmail.trim()) {
      toast({ title: t("fieldEmployeeDetail.emailPasswordRequired"), variant: "destructive" });
      return;
    }
    const creating = !loginInfo?.hasLogin;
    if (creating && credPassword.length < 8) {
      toast({ title: t("fieldEmployeeDetail.emailPasswordRequired"), variant: "destructive" });
      return;
    }
    if (!creating && credPassword.length > 0 && credPassword.length < 8) {
      toast({ title: t("fieldEmployeeDetail.emailPasswordRequired"), variant: "destructive" });
      return;
    }
    try {
      await setLoginMutation.mutateAsync({
        id,
        data: {
          email: credEmail.trim(),
          portalLoginEnabled: true,
          mustChangePassword,
          ...(credPassword ? { password: credPassword } : {}),
          // Only send preferredLanguage when the admin explicitly picks en/es.
          // Leaving it on "browser" (the default state) preserves any existing
          // preference on the user's account when updating credentials.
          ...(credLanguage === "browser" ? {} : { preferredLanguage: credLanguage }),
        },
      });
      toast({ title: loginInfo?.hasLogin ? t("fieldEmployeeDetail.credentialsUpdated") : t("fieldEmployeeDetail.loginCreated") });
      setCredPassword("");
      invalidateLogin();
    } catch (err: unknown) {
      toast({ title: translateApiError(err, t, t("fieldEmployeeDetail.failedToSaveCredentials")), variant: "destructive" });
    }
  };

  const disableCredentials = async () => {
    if (!confirm(t("fieldEmployeeDetail.disableLoginConfirm"))) return;
    try {
      await deleteLoginMutation.mutateAsync({ id });
      toast({ title: t("fieldEmployeeDetail.loginDisabled") });
      setCredPassword("");
      invalidateLogin();
    } catch (err: unknown) {
      toast({ title: translateApiError(err, t, t("fieldEmployeeDetail.failedToDisableLogin")), variant: "destructive" });
    }
  };

  const [form, setForm] = useState({ jobTitle: "", firstName: "", lastName: "", email: "", phone: "", pecCertification: false, pecExpirationDate: "", vendorRole: "field" as string, roles: [] as string[], preferredLanguage: "browser" as "browser" | "en" | "es" });
  const initialFormRef = useRef<typeof form | null>(null);

  useEffect(() => {
    if (employee) {
      const hydrated = {
        jobTitle: employee.jobTitle || "",
        firstName: employee.firstName,
        lastName: employee.lastName,
        email: employee.email,
        phone: formatPhone(employee.phone) === "-" ? "" : formatPhone(employee.phone),
        pecCertification: employee.pecCertification,
        pecExpirationDate: employee.pecExpirationDate || "",
        vendorRole: employee.vendorRole || "field",
        roles: (employee as { roles?: string[] | null }).roles ?? [],
        preferredLanguage: (employee.preferredLanguage === "en" || employee.preferredLanguage === "es"
          ? employee.preferredLanguage
          : "browser") as "browser" | "en" | "es",
      };
      setForm(hydrated);
      initialFormRef.current = hydrated;
    }
  }, [employee]);

  const isDirty = useMemo(() => {
    if (!initialFormRef.current) return false;
    return JSON.stringify(form) !== JSON.stringify(initialFormRef.current);
  }, [form]);

  const { confirmLeave } = useUnsavedChanges(isDirty);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateEmployee.mutate(
      {
        id,
        data: {
          ...form,
          jobTitle: form.jobTitle || null,
          phone: stripPhone(form.phone) || null,
          pecExpirationDate: form.pecExpirationDate || null,
          // Task #831: "browser" means "let the user choose" — clear the
          // stored preference (null). en/es persist as-is so both
          // vendor_people.preferred_language and the linked
          // users.preferred_language stay in sync server-side.
          preferredLanguage: form.preferredLanguage === "browser" ? null : form.preferredLanguage,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetFieldEmployeeQueryKey(id) });
          initialFormRef.current = form;
          toast({ title: t("fieldEmployeeDetail.updatedToast") });
        },
        onError: () => {
          toast({ title: t("fieldEmployeeDetail.updateFailed"), variant: "destructive" });
        },
      },
    );
  };

  // Task #876: after a successful soft-delete the API returns the list of
  // ticket sessions that were still open for this worker. We hold the
  // dialog open and surface that list inline so office staff understand
  // which foremen will see the row drop on their next mobile refresh
  // (Task #524 made the field side handle this gracefully on a 60s
  // cadence). When there are no open sessions we close immediately,
  // matching the previous UX.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletedOpenSessions, setDeletedOpenSessions] = useState<DeleteFieldEmployeeOpenSession[] | null>(null);

  const handleDelete = () => {
    deleteEmployee.mutate(
      { id },
      {
        onSuccess: (data) => {
          toast({ title: t("fieldEmployeeDetail.removedToast") });
          const openSessions = data?.openSessions ?? [];
          if (openSessions.length === 0) {
            setDeleteOpen(false);
            navigate("/field-employees");
          } else {
            setDeletedOpenSessions(openSessions);
          }
        },
      },
    );
  };

  const closeDeleteAfterReview = () => {
    setDeleteOpen(false);
    setDeletedOpenSessions(null);
    navigate("/field-employees");
  };

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteContent.trim()) return;
    createNote.mutate(
      { employeeId: id, data: { content: noteContent.trim() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListFieldEmployeeNotesQueryKey(id) });
          setNoteContent("");
          setNoteOpen(false);
          toast({ title: t("fieldEmployeeDetail.noteAdded") });
        },
        onError: () => {
          toast({ title: t("fieldEmployeeDetail.noteAddFailed"), variant: "destructive" });
        },
      },
    );
  };

  const handleDeleteNote = (noteId: number) => {
    deleteNote.mutate(
      { employeeId: id, noteId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListFieldEmployeeNotesQueryKey(id) });
          toast({ title: t("fieldEmployeeDetail.noteDeleted") });
        },
        onError: () => {
          toast({ title: t("fieldEmployeeDetail.noteDeleteFailed"), variant: "destructive" });
        },
      },
    );
  };

  // Task #8: clears the mobile-uploaded selfie (`profilePhotoPath`) for
  // the selected employee. Server-side the PATCH endpoint already gates
  // this to admin/vendor sessions and (for vendors) to the employee's
  // own vendor, so a mismatched session will get a 403/404 surfaced via
  // the toast below.
  const handleRemovePhoto = () => {
    updateEmployee.mutate(
      { id, data: { profilePhotoPath: null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetFieldEmployeeQueryKey(id) });
          toast({ title: t("fieldEmployeeDetail.photoRemoved") });
          setRemovePhotoOpen(false);
        },
        onError: () => {
          toast({ title: t("fieldEmployeeDetail.photoRemoveFailed"), variant: "destructive" });
        },
      },
    );
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      // Step 1 — ask the server for a presigned PUT URL via the
      // generated hook (Task #1046). The response is typed
      // RequestUploadUrlResponse so `uploadURL` / `objectPath` are
      // compile-time guaranteed.
      const { uploadURL, objectPath } = await requestUploadUrlMutation.mutateAsync({
        data: { name: file.name, size: file.size, contentType: file.type },
      });

      // Step 2 — stream the file bytes directly to the presigned URL.
      // This call deliberately bypasses the typed client: it targets
      // the object-storage host (not the API server), uses no auth
      // cookies, and the URL itself is the authentication.
      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadRes.ok) throw new Error(t("fieldEmployeeDetail.photoUploadFailed"));

      // Step 3 — stamp the ACL so subsequent reads through
      // GET /storage/objects/* succeed. Public visibility = readable
      // by any authenticated session, matching the prior behaviour.
      await finalizeUploadMutation.mutateAsync({
        data: { objectURL: uploadURL, visibility: "public" },
      });

      const photoUrl = `${BASE_PATH}/api/storage${objectPath}`;
      updateEmployee.mutate(
        { id, data: { photoUrl } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetFieldEmployeeQueryKey(id) });
            toast({ title: t("fieldEmployeeDetail.photoUploaded") });
          },
          onError: () => {
            toast({ title: t("fieldEmployeeDetail.photoSaveFailed"), variant: "destructive" });
          },
        },
      );
    } catch {
      toast({ title: t("fieldEmployeeDetail.photoUploadFailed"), variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-48 w-full" /></div>;
  if (!employee) return <p className="text-muted-foreground">{t("fieldEmployeeDetail.notFound")}</p>;

  return (
    <div className="space-y-6" data-testid="field-employee-detail-page">
      <div className="flex items-center gap-4">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            if (confirmLeave()) navigate("/field-employees");
          }}
        >
          <span className="group inline-flex items-center" aria-label={t("fieldEmployeeDetail.back")} data-testid="button-back"><SphereBackButton size={40} /></span>
        </a>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-employee-name">
            <span>{employee.firstName} {employee.lastName}</span>
            {employee.suspendedAt && <SuspendedPill />}
          </h1>
          <p className="text-muted-foreground text-sm">{employee.vendorName || t("fieldEmployeeDetail.noVendor")}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UserCheck className="w-5 h-5 text-amber-500" />{t("fieldEmployeeDetail.editEmployee")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>{t("fieldEmployeeDetail.jobTitle")}</Label>
              <Input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} data-testid="input-job-title" placeholder={t("fieldEmployeeDetail.jobTitlePlaceholder")} />
            </div>
            <div>
              <Label>{t("fieldEmployeeDetail.role")}</Label>
              <Select value={form.vendorRole} onValueChange={(v) => setForm({ ...form, vendorRole: v })}>
                <SelectTrigger data-testid="select-employee-role"><SelectValue placeholder={t("fieldEmployeeDetail.selectRole")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin" className="focus:bg-transparent data-[highlighted]:bg-transparent"><RoleBadge role="admin" /></SelectItem>
                      <SelectItem value="office" className="focus:bg-transparent data-[highlighted]:bg-transparent"><RoleBadge role="office" /></SelectItem>
                      <SelectItem value="field" className="focus:bg-transparent data-[highlighted]:bg-transparent"><RoleBadge role="field" /></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t("fieldEmployeeDetail.firstName")}</Label>
                <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} data-testid="input-first-name" required />
              </div>
              <div>
                <Label>{t("fieldEmployeeDetail.lastName")}</Label>
                <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} data-testid="input-last-name" required />
              </div>
            </div>
            <div>
              <Label>{t("fieldEmployeeDetail.email")}</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="input-email" required />
            </div>
            <div>
              <Label>{t("fieldEmployeeDetail.phone")}</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: handlePhoneInput(e.target.value) })} data-testid="input-phone" />
            </div>
            {/* Task #831: preferred UI/assistant language. Saving the
                form mirrors this into both vendor_people.preferred_language
                and (when a linked login exists) users.preferred_language so
                the next assistant turn keys off the same value. */}
            <div>
              <Label htmlFor="employee-preferred-language">{t("fieldEmployeeDetail.preferredLanguage")}</Label>
              <Select
                value={form.preferredLanguage}
                onValueChange={(v) => setForm({ ...form, preferredLanguage: v as "browser" | "en" | "es" })}
              >
                <SelectTrigger id="employee-preferred-language" data-testid="select-employee-preferred-language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="browser">{t("fieldEmployeeDetail.preferredLanguageLetUserChoose")}</SelectItem>
                  <SelectItem value="en">{t("fieldEmployeeDetail.english")}</SelectItem>
                  <SelectItem value="es">{t("fieldEmployeeDetail.spanish")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {t("fieldEmployeeDetail.preferredLanguageHelp")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Label>{t("fieldEmployeeDetail.pecCertification")}</Label>
              <PecStatusBadge expirationDate={form.pecExpirationDate || null} />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="visit-notif-employee-detail" checked={form.roles.includes("Visitor Notifications")} onCheckedChange={(v) => setForm({ ...form, roles: v ? Array.from(new Set([...form.roles, "Visitor Notifications"])) : form.roles.filter((r) => r !== "Visitor Notifications") })} data-testid="checkbox-employee-visit-notifications" />
              <Label htmlFor="visit-notif-employee-detail" className="cursor-pointer">Receive site visitor check-in notifications</Label>
            </div>
            <div>
              <Label>{t("fieldEmployeeDetail.expirationDate")}</Label>
              <div className="relative">
                <Input type="date" value={form.pecExpirationDate} onChange={(e) => {
                  const newDate = e.target.value;
                  setForm({ ...form, pecExpirationDate: newDate });
                  updateEmployee.mutate(
                    { id, data: { pecExpirationDate: newDate || null } },
                    {
                      onSuccess: () => {
                        queryClient.invalidateQueries({ queryKey: getGetFieldEmployeeQueryKey(id) });
                        toast({ title: t("fieldEmployeeDetail.pecExpirationUpdated") });
                      },
                      onError: () => {
                        toast({ title: t("fieldEmployeeDetail.pecExpirationUpdateFailed"), variant: "destructive" });
                      },
                    },
                  );
                }} data-testid="input-pec-expiration" className="pl-9 [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:left-0 [&::-webkit-calendar-picker-indicator]:w-10 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:cursor-pointer" />
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-500 pointer-events-none" />
              </div>
            </div>
            <div>
              <Label>{t("fieldEmployeeDetail.employeePhoto")}</Label>
              <div className="flex items-center gap-4 mt-1">
                {(() => {
                  const mobilePath = employee.profilePhotoPath;
                  const mobileUrl = mobilePath
                    ? mobilePath.startsWith("http")
                      ? mobilePath
                      : `${BASE_PATH}/api/storage${mobilePath.startsWith("/") ? mobilePath : `/${mobilePath}`}`
                    : null;
                  const url = employee.photoUrl || mobileUrl;
                  return url ? (
                    <img src={url} alt={`${employee.firstName} ${employee.lastName}`} className="w-20 h-20 rounded-full object-cover border-2 border-gray-200" data-testid="employee-photo" />
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center border-2 border-gray-200">
                      <Camera className="w-8 h-8 text-gray-400" />
                    </div>
                  );
                })()}
                <div className="flex flex-col items-start gap-2">
                  <input type="file" ref={fileInputRef} accept="image/*" onChange={handlePhotoUpload} className="hidden" data-testid="input-photo-file" />
                  {/* Add Photo → canonical PngPillButton blue
                      (primary action), h=24, matching the rest of
                      the pill family. The conditional label flips
                      to "Uploading…" while the request is in flight. */}
                  <PngPillButton type="button" color="blue" onClick={() => fileInputRef.current?.click()} disabled={uploading} data-testid="button-add-photo">
                    <Camera className="w-4 h-4" />{uploading ? t("fieldEmployeeDetail.uploading") : t("fieldEmployeeDetail.addPhoto")}
                  </PngPillButton>
                  {/* Remove Photo → PngPillButton red (destructive),
                      h=24. AlertDialogTrigger asChild still binds
                      because PngPillButton renders an underlying
                      <button>. */}
                  {employee.profilePhotoPath ? (
                    <AlertDialog open={removePhotoOpen} onOpenChange={(open) => { if (!updateEmployee.isPending) setRemovePhotoOpen(open); }}>
                      <AlertDialogTrigger asChild>
                        <PngPillButton
                          type="button"
                          color="red"

                          disabled={updateEmployee.isPending}
                          onClick={() => setRemovePhotoOpen(true)}
                          data-testid="button-remove-photo"
                        >
                          <Trash2 className="w-4 h-4" />{t("fieldEmployeeDetail.removePhoto")}
                        </PngPillButton>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t("fieldEmployeeDetail.removePhotoConfirmTitle")}</AlertDialogTitle>
                          <AlertDialogDescription>{t("fieldEmployeeDetail.removePhotoConfirmDesc")}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel data-testid="button-cancel-remove-photo">{t("fieldEmployeeDetail.cancel")}</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={(e) => { e.preventDefault(); handleRemovePhoto(); }}
                            disabled={updateEmployee.isPending}
                            data-testid="button-confirm-remove-photo"
                          >
                            {updateEmployee.isPending ? t("fieldEmployeeDetail.removing") : t("fieldEmployeeDetail.remove")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}
                </div>
              </div>
            </div>
            {employee.hasLogin && employee.userId ? (
              <AccountActions
                userId={employee.userId}
                hasLogin={employee.hasLogin}
                suspendedAt={employee.suspendedAt ?? null}
                testIdPrefix="field-detail-account"
                onChanged={() => queryClient.invalidateQueries({ queryKey: getGetFieldEmployeeQueryKey(id) })}
              />
            ) : null}
            <div className="flex gap-3">
              {/* Bottom-of-card actions converted to canonical
                  TogglePill family per user request: Save → blue,
                  Delete → red, both height=24 to match the
                  TogglePill chrome family used elsewhere. The
                  `attention={isDirty}` halo on Save is preserved
                  so the chip still glows when the form has unsaved
                  edits. AlertDialog gating on Delete is unchanged
                  — PngPillButton renders an underlying <button>
                  so AlertDialogTrigger asChild still binds. */}
              <PngPillButton type="submit" color="blue" disabled={updateEmployee.isPending} attention={isDirty} className="w-[140px] justify-center" data-testid="button-save">
                {updateEmployee.isPending ? t("fieldEmployeeDetail.saving") : t("fieldEmployeeDetail.saveChanges")}
              </PngPillButton>
              <AlertDialog
                open={deleteOpen}
                onOpenChange={(open) => {
                  // Lock the dialog while the mutation is in flight or
                  // while the post-deactivation open-sessions summary
                  // is on screen — closing early would lose the list
                  // before the office user has read it.
                  if (deleteEmployee.isPending) return;
                  if (deletedOpenSessions) return;
                  setDeleteOpen(open);
                }}
              >
                <AlertDialogTrigger asChild>
                  <PngPillButton
                    type="button"
                    color="red"

                    disabled={deleteEmployee.isPending}
                    className="w-[140px] justify-center"
                    data-testid="button-delete"
                    onClick={() => setDeleteOpen(true)}
                  >
                    {deleteEmployee.isPending ? t("fieldEmployeeDetail.removing") : t("fieldEmployeeDetail.delete")}
                  </PngPillButton>
                </AlertDialogTrigger>
                <AlertDialogContent data-testid="delete-confirm-dialog">
                  {deletedOpenSessions ? (
                    <>
                      <AlertDialogHeader>
                        <AlertDialogTitle data-testid="delete-open-sessions-title">
                          {t("fieldEmployeeDetail.openSessionsTitle", { defaultValue: "Open shifts will close on the field side soon" })}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {employee
                            ? t("fieldEmployeeDetail.openSessionsDesc", {
                                count: deletedOpenSessions.length,
                                name: `${employee.firstName} ${employee.lastName}`,
                                defaultValue: "{{name}} was deactivated, but still has {{count}} open shift(s). Their foreman will see them disappear from the crew picker on the next refresh (about a minute) and can close out the open shift from the mobile app.",
                              })
                            : t("fieldEmployeeDetail.openSessionsDescGeneric", {
                                count: deletedOpenSessions.length,
                                defaultValue: "This worker was deactivated but still has {{count}} open shift(s). Their foreman will see them disappear from the crew picker on the next refresh (about a minute) and can close out the open shift from the mobile app.",
                              })}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <ul className="my-2 space-y-1 text-sm" data-testid="delete-open-sessions-list">
                        {deletedOpenSessions.map((s) => (
                          <li key={s.ticketId} className="flex items-center justify-between rounded border border-amber-200 bg-amber-50 px-3 py-2" data-testid={`delete-open-session-${s.ticketId}`}>
                            <Link href={`/tickets/${s.ticketId}`} className="font-mono text-primary hover:underline" data-testid={`delete-open-session-link-${s.ticketId}`}>
                              {s.ticketTrackingNumber}
                            </Link>
                            <span className="text-xs text-muted-foreground">
                              {t("fieldEmployeeDetail.openSessionCheckedIn", {
                                when: new Date(s.checkInAt).toLocaleString(),
                                defaultValue: "Checked in {{when}}",
                              })}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <AlertDialogFooter>
                        <AlertDialogAction onClick={closeDeleteAfterReview} data-testid="button-delete-open-sessions-ack">
                          {t("fieldEmployeeDetail.openSessionsAck", { defaultValue: "Got it" })}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </>
                  ) : (
                    <>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("fieldEmployeeDetail.removeConfirmTitle")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {employee
                            ? t("fieldEmployeeDetail.removeConfirmDescNamed", { name: `${employee.firstName} ${employee.lastName}` })
                            : t("fieldEmployeeDetail.removeConfirmDescGeneric")}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel data-testid="button-delete-cancel">{t("fieldEmployeeDetail.cancel")}</AlertDialogCancel>
                        <AlertDialogAction onClick={(e) => { e.preventDefault(); handleDelete(); }} disabled={deleteEmployee.isPending} data-testid="button-delete-confirm">
                          {deleteEmployee.isPending ? t("fieldEmployeeDetail.removing") : t("fieldEmployeeDetail.remove")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </>
                  )}
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card data-testid="employee-credentials-section">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-amber-500" />
            {t("fieldEmployeeDetail.fieldPortalLogin")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className={`rounded-md border-2 p-3 flex items-start gap-2 ${loginInfo?.hasLogin ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
            <Smartphone className={`w-4 h-4 mt-0.5 ${loginInfo?.hasLogin ? "text-green-600" : "text-amber-600"}`} />
            <div className="flex-1 text-xs">
              {loginInfo?.hasLogin ? (
                <>
                  <p className="font-semibold text-green-800">{t("fieldEmployeeDetail.activeLogin")}</p>
                  <p className="text-green-700 mt-0.5">{t("fieldEmployeeDetail.signsInAt")} <code className="font-mono">{BASE_PATH || ""}{form.vendorRole === "foreman" || form.vendorRole === "both" ? "/foreman" : "/field"}</code> {t("fieldEmployeeDetail.asUser")} <span className="font-semibold">{loginInfo.email}</span></p>
                </>
              ) : (
                <>
                  <p className="font-semibold text-amber-800">{t("fieldEmployeeDetail.noLoginYet")}</p>
                  <p className="text-amber-700 mt-0.5">{t("fieldEmployeeDetail.noLoginYetDesc")}</p>
                </>
              )}
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cred-email">{t("fieldEmployeeDetail.loginEmail")}</Label>
              <Input
                id="cred-email"
                type="email"
                value={credEmail}
                onChange={(e) => setCredEmail(e.target.value)}
                placeholder={t("fieldEmployeeDetail.loginEmailPlaceholder")}
                data-testid="input-credential-email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cred-password">{loginInfo?.hasLogin ? t("fieldEmployeeDetail.newPassword") : t("fieldEmployeeDetail.password")}</Label>
              <Input
                id="cred-password"
                type="password"
                value={credPassword}
                onChange={(e) => setCredPassword(e.target.value)}
                placeholder={
                  loginInfo?.hasLogin
                    ? t("fieldEmployeeDetail.passwordOptionalPlaceholder")
                    : t("fieldEmployeeDetail.passwordPlaceholder")
                }
                autoComplete="new-password"
                data-testid="input-credential-password"
              />
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="cred-must-change-password"
              checked={mustChangePassword}
              onCheckedChange={(v) => setMustChangePassword(!!v)}
              data-testid="checkbox-credential-must-change-password"
            />
            <Label htmlFor="cred-must-change-password" className="cursor-pointer text-sm leading-snug">
              {t("fieldEmployeeDetail.forcePasswordChange")}
              <span className="block text-xs text-muted-foreground font-normal mt-0.5">
                {t("fieldEmployeeDetail.forcePasswordChangeHelp")}
              </span>
            </Label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cred-language">{t("fieldEmployeeDetail.defaultLanguage")}</Label>
            <Select value={credLanguage} onValueChange={(v) => setCredLanguage(v as "browser" | "en" | "es")}>
              <SelectTrigger id="cred-language" data-testid="select-credential-language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="browser">{t("fieldEmployeeDetail.useBrowserLanguage")}</SelectItem>
                <SelectItem value="en">{t("fieldEmployeeDetail.english")}</SelectItem>
                <SelectItem value="es">{t("fieldEmployeeDetail.spanish")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("fieldEmployeeDetail.defaultLanguageHelp")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Save credentials → PngPillButton blue (primary
                action), h=24. The label is conditional — "Update
                Password" when a login exists, "Create Login" when
                first-time provisioning, "Saving…" while in flight. */}
            <PngPillButton type="button" color="blue" onClick={saveCredentials} disabled={credBusy} data-testid="button-save-credentials">
              {credBusy ? t("fieldEmployeeDetail.saving") : loginInfo?.hasLogin ? t("fieldEmployeeDetail.updatePassword") : t("fieldEmployeeDetail.createLogin")}
            </PngPillButton>
            {!loginInfo?.hasLogin && (
              <PillButton
                type="button"
                color="image"
                disabled={credBusy}
                onClick={async () => {
                  try {
                    // Typed mutation (Task #1046) — the response is a
                    // FieldOnboardingInviteResponse so `url` and
                    // `emailSent` are guaranteed to exist by the
                    // generated client.
                    const data = await onboardingInviteMutation.mutateAsync({ id });
                    await navigator.clipboard.writeText(data.url).catch(() => undefined);
                    toast({
                      title: data.emailSent
                        ? "Invite emailed and link copied to clipboard."
                        : "Invite link copied to clipboard.",
                    });
                  } catch (err) {
                    // Surface the server-translated reason (matches the prior
                    // raw-fetch UX which showed `(err as Error).message`); fall
                    // back to a generic copy if the server didn't return one.
                    toast({
                      title: translateApiError(err, t, "Could not create invite link."),
                      variant: "destructive",
                    });
                  }
                }}
                data-testid="button-send-onboarding-invite"
              >
                Send onboarding invite
              </PillButton>
            )}
            {/* Disable Login → PngPillButton red (destructive),
                h=24. Conditionally rendered only when a login exists. */}
            {loginInfo?.hasLogin && (
              <PngPillButton type="button" color="red" onClick={disableCredentials} disabled={credBusy} data-testid="button-disable-credentials">
                {t("fieldEmployeeDetail.disableLogin")}
              </PngPillButton>
            )}
          </div>
        </CardContent>
      </Card>

      <CertificationsSection employeeId={id} />

      <Card data-testid="compliance-card-preview-section">
        <CardHeader><CardTitle>{t("fieldEmployeeDetail.compliancePreview")}</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            {t("fieldEmployeeDetail.compliancePreviewHelp")}
            <PillButton color="image" className="ml-2" onClick={() => window.print()}>{t("fieldEmployeeDetail.print")}</PillButton>
          </p>
          <div className="max-w-md">
            <ComplianceCard
              employeeId={id}
              firstName={employee.firstName}
              lastName={employee.lastName}
              jobTitle={employee.jobTitle}
              vendorName={employee.vendorName}
              vendorLogoUrl={employee.vendorLogoUrl}
              photoUrl={employee.photoUrl}
              profilePhotoPath={employee.profilePhotoPath}
            />
          </div>
        </CardContent>
      </Card>

      <Card data-testid="employee-notes-section">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="flex items-center gap-2">
            <StickyNote className="w-5 h-5 text-amber-500" />
            {t("fieldEmployeeDetail.notes", { count: notes?.length || 0 })}
          </CardTitle>
          {/* Add Note → PngPillButton blue (primary action), h=24.
              DialogTrigger asChild still binds because PngPillButton
              renders an underlying <button>. */}
          <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
            <DialogTrigger asChild>
              <PngPillButton color="blue" data-testid="button-add-note"><Plus className="w-4 h-4" />{t("fieldEmployeeDetail.addNote")}</PngPillButton>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{t("fieldEmployeeDetail.addNote")}</DialogTitle></DialogHeader>
              <form onSubmit={handleAddNote} className="space-y-4">
                <Textarea
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder={t("fieldEmployeeDetail.notePlaceholder")}
                  rows={4}
                  data-testid="input-note-content"
                  required
                />
                <PngPillButton color="blue" type="submit" disabled={createNote.isPending} className="w-full" data-testid="button-submit-note">
                  {createNote.isPending ? t("fieldEmployeeDetail.adding") : t("fieldEmployeeDetail.addNote")}
                </PngPillButton>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {!notes || notes.length === 0 ? (
            <p className="text-muted-foreground text-sm" data-testid="text-no-notes">{t("fieldEmployeeDetail.noNotes")}</p>
          ) : (
            <div className="space-y-3">
              {notes.map((note) => (
                <div key={note.id} className="flex items-start justify-between gap-3 p-3 rounded-lg border bg-muted/30" data-testid={`note-${note.id}`}>
                  <div className="flex-1">
                    <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                    <p className="text-xs text-muted-foreground mt-1">{new Date(note.createdAt).toLocaleString()}</p>
                  </div>
                  <PillButton color="image" className="min-w-[28px] px-0" onClick={() => handleDeleteNote(note.id)} data-testid={`button-delete-note-${note.id}`}>
                    <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive transition-colors" />
                  </PillButton>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
