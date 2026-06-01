// Reusable "Members" admin section for Partner / Vendor detail pages.
// Lists every user_org_memberships row attached to the org. Admin /
// member / AP rows are fully editable; field-employee rows are
// surfaced read-only so an org admin can see the full roster but
// can't mutate them from here (those are managed via the
// field-employee tools, which own their own membership sync).
// Add / remove / patch all reject field-employee targets server-side.

import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListOrgMembersQueryKey,
  useAddOrgMember,
  useListOrgMembers,
  useRemoveOrgMember,
  useUpdateOrgMemberRole,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import BlueButton from "@/components/blue-button";
import PngPill, { PngPillButton } from "@/components/png-pill-rollover";
import ImagePill from "@/components/image-pill";
import RoleBadge from "@/components/role-badge";
import PecStatusBadge from "@/components/pec-status-badge";
import GreyButton from "@/components/grey-button";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/api-error";
import { formatPhone } from "@/lib/utils";
import { KeyRound, Plus, Trash2, UserCheck } from "lucide-react";

// API_BASE matches the convention used elsewhere in the app
// (partner-detail, etc) — strip the trailing slash off Vite's
// BASE_URL so we can append `/api/...` paths cleanly. Used for the
// admin-reset-password endpoint, which isn't covered by the
// generated Orval client.
const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type OrgKind = "partner" | "vendor";

interface MemberRow {
  membershipId: number;
  userId: number;
  username: string;
  displayName: string;
  role: "admin" | "member" | "ap" | "field_employee";
  legacyRole: string;
  // Populated only for vendor orgs when the member also has a
  // `vendor_people` row on the same vendor (admins / members who
  // happen to be PEC-certified field employees on a small vendor).
  // Always null on partner orgs.
  phone?: string | null;
  pecExpirationDate?: string | null;
}

interface OrgMembersCardProps {
  /**
   * Optional callback fired when a field-employee row's display name
   * is clicked. When provided, the field-employee displayName cell
   * renders as a clickable link (matching the editable-member style)
   * so the parent (e.g. vendor-detail) can open its own Edit Field
   * Employee modal. Pass undefined (e.g. partner-detail) to keep the
   * displayName as plain non-interactive text.
   */
  onEditFieldMember?: (m: MemberRow) => void;
  orgType: OrgKind;
  orgId: number;
  /**
   * When false the section is hidden entirely. Should mirror what the
   * backend will accept — typically system admin OR an admin-role
   * membership in this org — so non-admin org members never see the
   * card and don't get runtime 403s on add/remove.
   */
  canManage: boolean;
  /** Active session userId so we can disable removing yourself. */
  currentUserId?: number | null;
}

interface AddMemberPayload {
  email: string;
  role: "admin" | "member" | "ap";
  password?: string;
  displayName?: string;
}

export default function OrgMembersCard({
  orgType,
  orgId,
  canManage,
  currentUserId,
  onEditFieldMember,
}: OrgMembersCardProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<{
    email: string;
    role: "admin" | "member" | "ap";
    password: string;
    displayName: string;
  }>({ email: "", role: "member", password: "", displayName: "" });
  // Inline field-level errors so the form can call out the exact input
  // that needs attention (email vs password) instead of just popping a
  // generic destructive toast. Driven by the API's `code` so behaviour
  // stays in sync with the backend's `members.is_field_employee` /
  // `members.weak_password` / `members.missing_email` branches.
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  // Form-level banner for failures that don't map to a specific input
  // (`members.org_not_found`, the catch-all `members.add_failed`).
  // The destructive toast still fires as a backup, but the banner keeps
  // the explanation visible in the dialog while the admin is reading.
  const [formError, setFormError] = useState<string | null>(null);
  // Edit-Team-Member modal: opens when an admin clicks a teammate's
  // display name in the table. Holds the row being edited and the
  // admin-typed temp password for the reset-password sub-flow.
  const [editTarget, setEditTarget] = useState<MemberRow | null>(null);
  const [editTempPassword, setEditTempPassword] = useState("");
  const [resetPending, setResetPending] = useState(false);
  const [resetPasswordError, setResetPasswordError] = useState<string | null>(
    null,
  );

  const { data, isLoading } = useListOrgMembers(orgType, orgId, {
    query: {
      queryKey: getListOrgMembersQueryKey(orgType, orgId),
      enabled: canManage && !!orgId,
    },
  });

  const addMutation = useAddOrgMember({
    mutation: {
      onSuccess: (resp) => {
        toast({
          title: resp.createdUser
            ? "New login created and attached"
            : "Existing login attached",
        });
        setAddOpen(false);
        void queryClient.invalidateQueries({
          queryKey: getListOrgMembersQueryKey(orgType, orgId),
        });
      },
      onError: (err: Error) => {
        // Branch on the API `code` so the form can highlight the exact
        // input that's wrong (or surface a form-level banner for failures
        // that don't map to a single field). The destructive toast still
        // fires as a backup so the admin gets the same cue they did
        // before this change.
        const code = (err as Error & { data?: { code?: string } }).data?.code;
        const msg = translateApiError(err, t, err.message);
        if (
          code === "members.is_field_employee" ||
          code === "members.missing_email"
        ) {
          setEmailError(msg);
          setPasswordError(null);
          setFormError(null);
          toast({ title: msg, variant: "destructive" });
          return;
        }
        if (code === "members.weak_password") {
          setPasswordError(msg);
          setEmailError(null);
          setFormError(null);
          toast({ title: msg, variant: "destructive" });
          return;
        }
        if (
          code === "members.org_not_found" ||
          code === "members.add_failed"
        ) {
          setFormError(msg);
          setEmailError(null);
          setPasswordError(null);
          toast({ title: msg, variant: "destructive" });
          return;
        }
        setEmailError(null);
        setPasswordError(null);
        setFormError(null);
        toast({
          title: msg,
          variant: "destructive",
        });
      },
    },
  });

  const patchMutation = useUpdateOrgMemberRole({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListOrgMembersQueryKey(orgType, orgId),
        });
        toast({ title: "Role updated" });
      },
      onError: (err: Error) => {
        toast({
          title: "Couldn't update role",
          description: translateApiError(err, t, err.message),
          variant: "destructive",
        });
      },
    },
  });

  const removeMutation = useRemoveOrgMember({
    mutation: {
      onSuccess: () => {
        toast({ title: "Member removed" });
        void queryClient.invalidateQueries({
          queryKey: getListOrgMembersQueryKey(orgType, orgId),
        });
      },
      onError: (err: Error) => {
        toast({
          title: translateApiError(err, t, err.message),
          variant: "destructive",
        });
      },
    },
  });

  useEffect(() => {
    if (!addOpen) {
      setForm({ email: "", role: "member", password: "", displayName: "" });
      setEmailError(null);
      setPasswordError(null);
      setFormError(null);
    }
  }, [addOpen]);

  if (!canManage) return null;

  const members = data?.members ?? [];

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = form.email.trim();
    if (!email) {
      toast({ title: "Email is required", variant: "destructive" });
      return;
    }
    // Clear any inline errors from the previous attempt before kicking
    // off a new request — they'll be re-set by onError if the same
    // failure recurs.
    setEmailError(null);
    setPasswordError(null);
    setFormError(null);
    const payload: AddMemberPayload = { email, role: form.role };
    if (form.password) payload.password = form.password;
    if (form.displayName.trim()) payload.displayName = form.displayName.trim();
    addMutation.mutate({ orgType, orgId, data: payload });
  };

  return (
    <Card data-testid={`card-${orgType}-members`}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <UserCheck className="w-5 h-5" style={{ color: "var(--brand-primary)" }} />
          Administrative Team Members ({members.length})
        </CardTitle>
        <PngPillButton
          color="blue"

          onClick={() => setAddOpen(true)}
          className="px-2"
          data-testid={`button-add-${orgType}-member`}
        >
          <Plus className="w-4 h-4" />
          Add Team Member
        </PngPillButton>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Add Team Member</DialogTitle>
              <DialogDescription>
                Attach an existing login to this {orgType} or create a new
                one. The new login can sign in immediately with the password
                you set below.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-3">
              {formError ? (
                <div
                  role="alert"
                  className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
                  data-testid={`text-${orgType}-member-form-error`}
                >
                  {formError}
                </div>
              ) : null}
              <div className="space-y-1">
                <Label htmlFor="member-email">Email</Label>
                <Input
                  id="member-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, email: e.target.value }));
                    if (emailError) setEmailError(null);
                  }}
                  data-testid={`input-${orgType}-member-email`}
                  aria-invalid={emailError ? true : undefined}
                  aria-describedby={
                    emailError ? `member-email-error` : undefined
                  }
                  className={
                    emailError
                      ? "border-red-500 focus-visible:ring-red-500"
                      : undefined
                  }
                  autoFocus
                  required
                />
                {emailError ? (
                  <p
                    id="member-email-error"
                    className="text-xs text-red-600"
                    data-testid={`text-${orgType}-member-email-error`}
                  >
                    {emailError}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    If a login with this email exists it will be attached to
                    this {orgType}. Otherwise a new login is created with the
                    password below.
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="member-role">Role</Label>
                <Select
                  value={form.role}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      role: v as "admin" | "member" | "ap",
                    }))
                  }
                >
                  <SelectTrigger
                    id="member-role"
                    data-testid={`select-${orgType}-member-role`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    {orgType === "partner" && (
                      <SelectItem value="ap" data-testid="select-partner-member-role-ap">
                        Accounts Payable (can disperse funds)
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="member-display-name">
                  Display name{" "}
                  <span className="text-xs text-muted-foreground">
                    (new logins only)
                  </span>
                </Label>
                <Input
                  id="member-display-name"
                  value={form.displayName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, displayName: e.target.value }))
                  }
                  data-testid={`input-${orgType}-member-display-name`}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="member-password">
                  Password{" "}
                  <span className="text-xs text-muted-foreground">
                    (required for new logins, min 8 chars)
                  </span>
                </Label>
                <Input
                  id="member-password"
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, password: e.target.value }));
                    if (passwordError) setPasswordError(null);
                  }}
                  data-testid={`input-${orgType}-member-password`}
                  aria-invalid={passwordError ? true : undefined}
                  aria-describedby={
                    passwordError ? `member-password-error` : undefined
                  }
                  className={
                    passwordError
                      ? "border-red-500 focus-visible:ring-red-500"
                      : undefined
                  }
                />
                {passwordError ? (
                  <p
                    id="member-password-error"
                    className="text-xs text-red-600"
                    data-testid={`text-${orgType}-member-password-error`}
                  >
                    {passwordError}
                  </p>
                ) : null}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <PngPillButton
                  type="button"
                  color="red"

                  onClick={() => setAddOpen(false)}
                  data-testid={`button-cancel-${orgType}-member`}
                >
                  Cancel
                </PngPillButton>
                <PngPillButton
                  type="submit"
                  color="blue"

                  disabled={addMutation.isPending}
                  data-testid={`button-submit-${orgType}-member`}
                >
                  {addMutation.isPending ? "Saving…" : "Add Team Member"}
                </PngPillButton>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 text-center text-muted-foreground text-sm">
            Loading members…
          </div>
        ) : members.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">
            No members attached yet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {/*
                 * Job Title + Name (with icon) mirror the Field
                 * Employees card layout. Job Title is sourced from
                 * the same vendor_people LEFT JOIN as Phone / PEC
                 * Status, so partner-org rows always render "-".
                 */}
                <TableHead>Job Title</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                {/*
                 * Phone + PEC Status columns mirror the Field Employees
                 * card so a small-vendor admin who is also a PEC-
                 * certified field employee surfaces both pieces of info
                 * here. Vendor-only — the partner card has no field-
                 * employee table, so the join is always null and the
                 * extra columns would be dead space.
                 */}
                {orgType === "vendor" ? (
                  <>
                    <TableHead>Phone</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>PEC Status</TableHead>
                  </>
                ) : (
                  <TableHead>Role</TableHead>
                )}
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => {
                const isSelf = currentUserId === m.userId;
                return (
                  <TableRow
                    key={m.membershipId}
                    className="group"
                    data-testid={`row-${orgType}-member-${m.membershipId}`}
                  >
                    {/*
                     * Job Title cell — same vendor_people LEFT JOIN
                     * source as Phone / PEC. Partners and admin-only
                     * vendor members (no field-employee row) render
                     * "-" so the column has visual rhythm.
                     */}
                    <TableCell
                      className="font-medium"
                      data-testid={`text-${orgType}-member-job-title-${m.membershipId}`}
                    >
                      {m.jobTitle?.trim() ? m.jobTitle : "-"}
                    </TableCell>
                    <TableCell className="font-medium">
                      {/*
                       * Name cell mirrors the Field Employees card:
                       * photo (when joined from vendor_people) else
                       * a brand-coloured UserCheck icon, then the
                       * display name. The name itself keeps the
                       * existing edit-target click affordance.
                       */}
                      <div className="flex items-center gap-2 text-gray-700 group-hover:text-[var(--brand-primary)] transition-colors">
                        {m.photoUrl ? (
                          <img
                            src={m.photoUrl}
                            alt=""
                            className="w-6 h-6 rounded-full object-cover border border-gray-200"
                          />
                        ) : (
                          <UserCheck
                            className="w-4 h-4"
                            style={{ color: "var(--brand-primary)" }}
                          />
                        )}
                        {m.role === "field_employee" && onEditFieldMember ? (
                          <button
                            type="button"
                            onClick={() => onEditFieldMember(m)}
                            className="text-left"
                            data-testid={`button-edit-${orgType}-field-member-${m.membershipId}`}
                          >
                            {m.displayName}
                          </button>
                        ) : isSelf || m.role === "field_employee" ? (
                          <span>{m.displayName}</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditTarget(m);
                              setEditTempPassword("");
                              setResetPasswordError(null);
                            }}
                            className="text-left"
                            data-testid={`button-edit-${orgType}-member-${m.membershipId}`}
                          >
                            {m.displayName}
                          </button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.username}
                    </TableCell>
                    {orgType === "vendor" ? (
                      <TableCell
                        className="text-muted-foreground"
                        data-testid={`text-${orgType}-member-phone-${m.membershipId}`}
                      >
                        {m.phone ? formatPhone(m.phone) : ""}
                      </TableCell>
                    ) : null}
                    <TableCell>
                      {isSelf && m.role === "admin" ? (
                        // Self-view of an admin membership: this is the
                        // "lead admin" — the person currently logged in
                        // and managing the org. Render as the canonical
                        // amber `TogglePill` so it matches the rest of
                        // the pill family across the app (hotlist,
                        // recent activity, etc.) and reads as a
                        // globally-meaningful privilege marker rather
                        // than a per-partner brand accent. Height 28
                        // preserves the previous `BrandRolePill` size
                        // so the row chrome (`h-7` Select alongside)
                        // stays vertically aligned. Other admins still
                        // show as "Admin" in the editable Select below.
                        <ImagePill
                          color="amber"

                          data-testid={`badge-${orgType}-member-role-${m.membershipId}`}
                        >
                          Lead Admin
                        </ImagePill>
                      ) : m.role === "field_employee" || isSelf ? (
                        // Read-only role display: render via the
                        // canonical RoleBadge so the role column
                        // matches the Field Employees card pill family
                        // (admin → amber, member → blue, ap → green,
                        // field_employee → light-grey rest).
                        <RoleBadge
                          role={m.role}

                          data-testid={`badge-${orgType}-member-role-${m.membershipId}`}
                        />
                      ) : (
                        // Editable role: render the same RoleBadge as
                        // the read-only branch but wrap it in a button
                        // that opens the Edit Team Member modal — the
                        // role Select lives there now (matches the
                        // Edit Field Employee modal in vendor-detail
                        // where the role dropdown is also modal-only,
                        // never inline).
                        <button
                          type="button"
                          onClick={() => {
                            setEditTarget(m);
                            setEditTempPassword("");
                            setResetPasswordError(null);
                          }}
                          className="cursor-pointer hover:opacity-80 transition-opacity"
                          data-testid={`button-edit-${orgType}-member-role-${m.membershipId}`}
                        >
                          <RoleBadge
                            role={m.role}

                            data-testid={`badge-${orgType}-member-role-${m.membershipId}`}
                          />
                        </button>
                      )}
                    </TableCell>
                    {orgType === "vendor" ? (
                      <TableCell
                        data-testid={`cell-${orgType}-member-pec-${m.membershipId}`}
                      >
                        <PecStatusBadge
                          expirationDate={m.pecExpirationDate ?? null}
                        />
                      </TableCell>
                    ) : null}
                    <TableCell className="text-right">
                      {(
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <button
                              className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30 disabled:cursor-not-allowed p-1"
                              disabled={isSelf || removeMutation.isPending}
                              title={
                                isSelf
                                  ? "You can't remove yourself"
                                  : "Remove member"
                              }
                              data-testid={`button-remove-${orgType}-member-${m.membershipId}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Remove {m.displayName}?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                {m.username} will lose access to this {orgType}.
                                The login itself stays active for any other
                                organizations they belong to.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() =>
                                  removeMutation.mutate({
                                    orgType,
                                    orgId,
                                    membershipId: m.membershipId,
                                  })
                                }
                                data-testid={`button-confirm-remove-${orgType}-member-${m.membershipId}`}
                              >
                                Remove
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {/* Edit Team Member modal — opens when an admin clicks a
          teammate's display name in the table. Lets the admin swap
          the member's role (same patchMutation as the inline Select)
          and reset their password (admin-types a temporary password
          → backend rotates the hash, bumps sessionVersion to kill
          existing sessions, sets must_change_password=true so the
          user picks a new one on next sign-in, and emails the
          temp password to the user). Email is shown read-only —
          changing another user's login email isn't supported by
          the backend yet. */}
      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open && !resetPending) {
            setEditTarget(null);
            setEditTempPassword("");
            setResetPasswordError(null);
          }
        }}
      >
        <DialogContent
          className="max-w-md"
          data-testid={`dialog-edit-${orgType}-member`}
        >
          <DialogHeader>
            <DialogTitle>Edit Team Member</DialogTitle>
            <DialogDescription>
              Change this teammate&apos;s role or send them a temporary
              password.
            </DialogDescription>
          </DialogHeader>
          {editTarget ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>Display name</Label>
                <p
                  className="text-sm font-medium"
                  data-testid={`text-edit-${orgType}-member-display-name`}
                >
                  {editTarget.displayName}
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-member-email">Email</Label>
                <Input
                  id="edit-member-email"
                  value={editTarget.username}
                  readOnly
                  disabled
                  data-testid={`input-edit-${orgType}-member-email`}
                />
                <p className="text-xs text-muted-foreground">
                  Email changes aren&apos;t supported here yet — the
                  member can update their own email from their account
                  settings.
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-member-role">Role</Label>
                <Select
                  value={editTarget.role === "field_employee" ? "member" : editTarget.role}
                  disabled={patchMutation.isPending}
                  onValueChange={(v) => {
                    const newRole = v as "admin" | "member" | "ap";
                    patchMutation.mutate(
                      {
                        orgType,
                        orgId,
                        membershipId: editTarget.membershipId,
                        data: { role: newRole },
                      },
                      {
                        onSuccess: () => {
                          // Keep the modal in sync with the new role
                          // so the Select reflects the change without
                          // having to re-open the row.
                          setEditTarget((t) =>
                            t ? { ...t, role: newRole } : t,
                          );
                        },
                      },
                    );
                  }}
                >
                  <SelectTrigger
                    id="edit-member-role"
                    data-testid={`select-edit-${orgType}-member-role`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      value="member"
                      className="focus:bg-transparent data-[highlighted]:bg-transparent"
                    >
                      <RoleBadge role="member" />
                    </SelectItem>
                    <SelectItem
                      value="admin"
                      className="focus:bg-transparent data-[highlighted]:bg-transparent"
                    >
                      <RoleBadge role="admin" />
                    </SelectItem>
                    {orgType === "partner" && (
                      <SelectItem
                        value="ap"
                        className="focus:bg-transparent data-[highlighted]:bg-transparent"
                        data-testid={`select-edit-${orgType}-member-role-ap`}
                      >
                        <RoleBadge role="ap" />
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3">
                <Label
                  htmlFor="edit-member-temp-password"
                  className="flex items-center gap-1.5"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  Reset password
                </Label>
                <p className="text-xs text-muted-foreground">
                  Type a temporary password (min 8 chars). We&apos;ll
                  email it to {editTarget.username} and force them to
                  pick a new one on next sign-in. All their existing
                  sessions will be signed out.
                </p>
                <Input
                  id="edit-member-temp-password"
                  type="text"
                  autoComplete="off"
                  value={editTempPassword}
                  onChange={(e) => {
                    setEditTempPassword(e.target.value);
                    if (resetPasswordError) setResetPasswordError(null);
                  }}
                  placeholder="Temporary password"
                  disabled={resetPending}
                  aria-invalid={resetPasswordError ? true : undefined}
                  className={
                    resetPasswordError
                      ? "border-red-500 focus-visible:ring-red-500"
                      : undefined
                  }
                  data-testid={`input-edit-${orgType}-member-temp-password`}
                />
                {resetPasswordError ? (
                  <p
                    className="text-xs text-red-600"
                    data-testid={`text-edit-${orgType}-member-reset-error`}
                  >
                    {resetPasswordError}
                  </p>
                ) : null}
                <PngPillButton color="blue"
                  type="button"
                  disabled={
                    resetPending || editTempPassword.trim().length < 8
                  }
                  onClick={async () => {
                    if (!editTarget) return;
                    const pwd = editTempPassword.trim();
                    if (pwd.length < 8) {
                      setResetPasswordError(
                        "Temporary password must be at least 8 characters",
                      );
                      return;
                    }
                    setResetPending(true);
                    setResetPasswordError(null);
                    try {
                      const res = await fetch(
                        `${API_BASE}/api/users/${editTarget.userId}/admin-reset-password`,
                        {
                          method: "POST",
                          credentials: "include",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ tempPassword: pwd }),
                        },
                      );
                      const body: {
                        message?: string;
                        code?: string;
                        emailSent?: boolean;
                      } = await res.json().catch(() => ({}));
                      if (!res.ok) {
                        const apiErr = new Error(
                          body?.message ?? "Reset failed",
                        ) as Error & {
                          data?: unknown;
                          status?: number;
                        };
                        apiErr.data = body;
                        apiErr.status = res.status;
                        throw apiErr;
                      }
                      const msg =
                        body?.emailSent === false
                          ? "Password reset, but email delivery failed — share the temporary password with the user manually"
                          : "Temporary password emailed to the member";
                      toast({ title: msg });
                      setEditTempPassword("");
                    } catch (err) {
                      const msg = translateApiError(
                        err as Error,
                        t,
                        (err as Error).message,
                      );
                      setResetPasswordError(msg);
                      toast({ title: msg, variant: "destructive" });
                    } finally {
                      setResetPending(false);
                    }
                  }}
                  className="w-full"
                  data-testid={`button-edit-${orgType}-member-reset-password`}
                >
                  {resetPending ? "Sending…" : "Send temporary password"}
                </PngPillButton>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <PngPillButton
                  type="button"
                  onClick={() => {
                    if (resetPending) return;
                    setEditTarget(null);
                    setEditTempPassword("");
                    setResetPasswordError(null);
                  }}
                  data-testid={`button-edit-${orgType}-member-close`}
                >
                  Close
                </PngPillButton>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
