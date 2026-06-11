import { useEffect, useState } from "react";

// Mirrors the API_BASE pattern used elsewhere (e.g. partner-detail.tsx) so
// the preview fetch lands on the API service through the shared proxy
// regardless of the artifact's base path.
const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useNotificationsModal } from "@/components/notifications-modal-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { notificationsApi, type NotificationPreferences } from "@/lib/notifications-api";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import SphereBackButton from "@/components/sphere-back-button";
import { useBrowserNotifications } from "@/hooks/use-browser-notifications";

// Task #796 — collapse the two underlying booleans into a single 4-option
// channel picker for the QB bulk-action expiry warning. The mapping has to
// be a pure function in both directions so the radio group reflects what
// will actually be saved (no surprise "I picked Email but it saved as Both").
type QbBulkExpiryChannel = "in_app" | "email" | "both" | "off";

function channelFromPrefs(p: NotificationPreferences): QbBulkExpiryChannel {
  const inApp = p.qbBulkExpiryInAppEnabled;
  const email = p.qbBulkExpiryEmailEnabled;
  if (inApp && email) return "both";
  if (inApp && !email) return "in_app";
  if (!inApp && email) return "email";
  return "off";
}

function prefsFromChannel(c: QbBulkExpiryChannel): {
  qbBulkExpiryInAppEnabled: boolean;
  qbBulkExpiryEmailEnabled: boolean;
} {
  switch (c) {
    case "in_app":
      return { qbBulkExpiryInAppEnabled: true, qbBulkExpiryEmailEnabled: false };
    case "email":
      return { qbBulkExpiryInAppEnabled: false, qbBulkExpiryEmailEnabled: true };
    case "both":
      return { qbBulkExpiryInAppEnabled: true, qbBulkExpiryEmailEnabled: true };
    case "off":
      return { qbBulkExpiryInAppEnabled: false, qbBulkExpiryEmailEnabled: false };
  }
}

const QB_BULK_EXPIRY_OPTIONS: { value: QbBulkExpiryChannel; labelKey: string }[] = [
  { value: "in_app", labelKey: "qbBulkExpiryInApp" },
  { value: "email", labelKey: "qbBulkExpiryEmail" },
  { value: "both", labelKey: "qbBulkExpiryBoth" },
  { value: "off", labelKey: "qbBulkExpiryOff" },
];

// Each row in the categories table now shows three controls per category:
// the in-app/push toggle (existing), and the per-category email toggle
// (Task #47). Keep them in sync via this single source of truth so a new
// category only needs to be added in one place.
const CATEGORY_KEYS: {
  inAppKey: keyof NotificationPreferences;
  emailKey: keyof NotificationPreferences;
  labelKey: string;
  descKey: string;
}[] = [
  { inAppKey: "ticketsEnabled", emailKey: "ticketsEmailEnabled", labelKey: "tickets", descKey: "ticketsDesc" },
  { inAppKey: "hotlistEnabled", emailKey: "hotlistEmailEnabled", labelKey: "hotlist", descKey: "hotlistDesc" },
  { inAppKey: "complianceEnabled", emailKey: "complianceEmailEnabled", labelKey: "compliance", descKey: "complianceDesc" },
  { inAppKey: "crewEnabled", emailKey: "crewEmailEnabled", labelKey: "crew", descKey: "crewDesc" },
  { inAppKey: "systemEnabled", emailKey: "systemEmailEnabled", labelKey: "system", descKey: "systemDesc" },
  { inAppKey: "visitorEnabled", emailKey: "visitorEmailEnabled", labelKey: "visitors", descKey: "visitorsDesc" },
  // Task #50 — comments row. The email column here gates *@mention* emails
  // only; the reply-digest email has its own dedicated toggle below the
  // grid because it follows the every-5-minute batched-digest path
  // instead of the instant-alert path.
  { inAppKey: "commentsEnabled", emailKey: "commentMentionEmailEnabled", labelKey: "comments", descKey: "commentsDesc" },
];

export default function NotificationPreferencesPage() {
  const { t } = useTranslation();
  const notificationsModal = useNotificationsModal();
  const qc = useQueryClient();
  const { toast } = useToast();
  // Task #48 — browser-pop-up alerts opt-in. Stored per-browser
  // (localStorage) by the hook itself; the actual permission lives in
  // the browser. We surface the live `permission` state below the
  // toggle so a user who blocked us at the OS prompt sees why no
  // pop-ups arrive.
  const browserNotif = useBrowserNotifications();
  const { data, isLoading } = useQuery({
    queryKey: ["notification-prefs"],
    queryFn: () => notificationsApi.getPreferences(),
  });
  const [draft, setDraft] = useState<NotificationPreferences | null>(null);

  useEffect(() => {
    if (data && !draft) setDraft(data);
  }, [data, draft]);

  const save = useMutation({
    mutationFn: (patch: Partial<NotificationPreferences>) => notificationsApi.updatePreferences(patch),
    onSuccess: (next) => {
      setDraft(next);
      qc.invalidateQueries({ queryKey: ["notification-prefs"] });
      toast({ title: t("notifications.prefs.saved") });
    },
    onError: () => toast({ title: t("notifications.prefs.couldNotSave"), variant: "destructive" }),
  });

  if (isLoading || !draft) {
    return <div className="p-6 text-sm text-muted-foreground">{t("notifications.loading")}</div>;
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="flex items-start gap-4 mb-6">
        <button
          type="button"
          className="group inline-flex shrink-0 items-center mt-1"
          aria-label="Back"
          data-testid="button-back"
          onClick={() => notificationsModal?.openNotifications()}
        >
          <SphereBackButton size={32} />
        </button>
        <div>
          <h1 className="text-2xl font-semibold mb-1">{t("notifications.prefs.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("notifications.prefs.subtitle")}
          </p>
        </div>
      </div>

      <div className="rounded-lg border bg-card divide-y">
        <div className="hidden sm:grid grid-cols-[1fr_auto_auto] items-center gap-6 px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <div />
          <div className="w-16 text-center">{t("notifications.prefs.colInApp")}</div>
          <div className="w-16 text-center">{t("notifications.prefs.colEmail")}</div>
        </div>
        {CATEGORY_KEYS.map((c) => (
          <div
            key={c.inAppKey}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-6 p-4"
          >
            <div className="pr-4">
              <div className="font-medium text-sm">{t(`notifications.prefs.${c.labelKey}`)}</div>
              <div className="text-xs text-muted-foreground">{t(`notifications.prefs.${c.descKey}`)}</div>
            </div>
            <div className="w-16 flex justify-center">
              <Switch
                checked={Boolean(draft[c.inAppKey])}
                onCheckedChange={(v) => setDraft({ ...draft, [c.inAppKey]: v })}
                data-testid={`switch-${c.inAppKey}`}
                aria-label={t("notifications.prefs.colInApp")}
              />
            </div>
            <div className="w-16 flex justify-center">
              <Switch
                checked={Boolean(draft[c.emailKey])}
                onCheckedChange={(v) => setDraft({ ...draft, [c.emailKey]: v })}
                data-testid={`switch-${c.emailKey}`}
                aria-label={t("notifications.prefs.colEmail")}
              />
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between p-4">
          <div className="pr-4">
            <div className="font-medium text-sm">{t("notifications.prefs.mobilePush")}</div>
            <div className="text-xs text-muted-foreground">{t("notifications.prefs.mobilePushDesc")}</div>
          </div>
          <Switch
            checked={draft.pushEnabled}
            onCheckedChange={(v) => setDraft({ ...draft, pushEnabled: v })}
            data-testid="switch-pushEnabled"
          />
        </div>
        {/*
          Task #48 — browser pop-up alerts. Per-browser preference (lives in
          localStorage, not on the server) since the actual permission is a
          browser-level grant. Toggling on prompts for permission via a
          real user click; toggling off just suppresses pop-ups locally.
        */}
        <div className="flex items-start justify-between p-4 gap-4">
          <div className="pr-4">
            <div className="font-medium text-sm">
              {t("notifications.prefs.browserPopups")}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("notifications.prefs.browserPopupsDesc")}
            </div>
            {!browserNotif.supported ? (
              <div
                className="text-xs text-muted-foreground mt-1"
                data-testid="text-browserPopups-unsupported"
              >
                {t("notifications.prefs.browserPopupsUnsupported")}
              </div>
            ) : browserNotif.permission === "denied" ? (
              <div
                className="text-xs text-amber-700 mt-1"
                data-testid="text-browserPopups-denied"
              >
                {t("notifications.prefs.browserPopupsDenied")}
              </div>
            ) : null}
          </div>
          <Switch
            checked={browserNotif.enabled}
            disabled={!browserNotif.supported || browserNotif.permission === "denied"}
            onCheckedChange={(v) => {
              void browserNotif.setEnabled(v).then((perm) => {
                // Task #48 — surface the outcome of the permission prompt
                // so the toggle never silently lies about its state. We
                // only toast on the prompt path (default → granted/denied)
                // so flipping an already-granted toggle off doesn't pop
                // a noisy "permission granted" message.
                if (v && perm === "granted") {
                  toast({ title: t("notifications.prefs.browserPopupsEnabled") });
                } else if (v && perm === "denied") {
                  toast({
                    title: t("notifications.prefs.browserPopupsDenied"),
                    variant: "destructive",
                  });
                }
              });
            }}
            data-testid="switch-browserPopupsEnabled"
            aria-label={t("notifications.prefs.browserPopups")}
          />
        </div>
        <div className="flex items-start justify-between p-4 gap-4">
          <div className="pr-4">
            <div className="font-medium text-sm">
              {t("notifications.prefs.emailDigest")}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("notifications.prefs.emailDigestDesc")}
            </div>
          </div>
          <Switch
            checked={draft.emailDigestEnabled}
            onCheckedChange={(v) => setDraft({ ...draft, emailDigestEnabled: v })}
            data-testid="switch-emailDigestEnabled"
            aria-label={t("notifications.prefs.emailDigest")}
          />
        </div>
        {/* Task #50 — reply-digest email toggle. Lives outside the
            categories table because it controls a *delivery cadence*
            (batched every 5 min) rather than a category. The category
            row above already exposes the in-app/push and the
            instant-mention email toggles. */}
        <div className="flex items-start justify-between p-4 gap-4">
          <div className="pr-4">
            <div className="font-medium text-sm">
              {t("notifications.prefs.commentReplyDigest")}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("notifications.prefs.commentReplyDigestDesc")}
            </div>
          </div>
          <Switch
            checked={draft.commentReplyEmailEnabled}
            onCheckedChange={(v) => setDraft({ ...draft, commentReplyEmailEnabled: v })}
            data-testid="switch-commentReplyEmailEnabled"
            aria-label={t("notifications.prefs.commentReplyDigest")}
          />
        </div>
        <div className="p-4">
          <div className="flex items-start justify-between gap-3 mb-1">
            <div className="font-medium text-sm">
              {t("notifications.prefs.qbBulkExpiry")}
            </div>
            {/*
              Task #963 — let admins preview the rendered email template
              before opting into the Email or Both channel. The preview
              modal renders the same HTML the worker would send (via the
              shared `renderBulkActionExpiringEmail` helper), so what
              they see here is exactly what arrives in their inbox.
            */}
            <QbBulkExpiryPreviewButton />
          </div>
          <div className="text-xs text-muted-foreground mb-3">
            {t("notifications.prefs.qbBulkExpiryDesc")}
          </div>
          <RadioGroup
            value={channelFromPrefs(draft)}
            onValueChange={(v) =>
              setDraft({ ...draft, ...prefsFromChannel(v as QbBulkExpiryChannel) })
            }
            data-testid="radio-qbBulkExpiry"
            className="grid gap-2 sm:grid-cols-2"
          >
            {QB_BULK_EXPIRY_OPTIONS.map((opt) => (
              <Label
                key={opt.value}
                htmlFor={`qbBulkExpiry-${opt.value}`}
                className="flex items-center gap-2 rounded-md border bg-background p-2 text-sm font-normal cursor-pointer hover:bg-accent/40"
              >
                <RadioGroupItem
                  value={opt.value}
                  id={`qbBulkExpiry-${opt.value}`}
                  data-testid={`radio-qbBulkExpiry-${opt.value}`}
                />
                <span>{t(`notifications.prefs.${opt.labelKey}`)}</span>
              </Label>
            ))}
          </RadioGroup>
        </div>
        <div className="p-4">
          <div className="font-medium text-sm mb-1">{t("notifications.prefs.dnd")}</div>
          <div className="text-xs text-muted-foreground mb-3">
            {t("notifications.prefs.dndDesc")}
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Label htmlFor="dnd-start" className="w-12">{t("notifications.prefs.start")}</Label>
            <Input
              id="dnd-start"
              type="number"
              min={0}
              max={23}
              className="w-20"
              value={draft.dndStartHour ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  dndStartHour: e.target.value === "" ? null : parseInt(e.target.value),
                })
              }
              data-testid="input-dnd-start"
            />
            <Label htmlFor="dnd-end" className="w-12 ml-3">{t("notifications.prefs.end")}</Label>
            <Input
              id="dnd-end"
              type="number"
              min={0}
              max={23}
              className="w-20"
              value={draft.dndEndHour ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  dndEndHour: e.target.value === "" ? null : parseInt(e.target.value),
                })
              }
              data-testid="input-dnd-end"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end mt-4">
        <PillButton
          color="blue"
          onClick={() => save.mutate(draft)}
          disabled={save.isPending}
          data-testid="button-save-prefs"
        >
          {t("notifications.prefs.save")}
        </PillButton>
      </div>
    </div>
  );
}

// Task #963 — "Preview email" affordance for the QB bulk-action expiry
// warning channel picker. Fetches a sample render from the API (which
// uses the same `renderBulkActionExpiringEmail` helper as the worker) and
// shows it inside a sandboxed iframe so the email's inline styles can't
// leak into the preferences page chrome.
function QbBulkExpiryPreviewButton() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const preview = useQuery({
    queryKey: ["qb-bulk-expiry-preview"],
    queryFn: async (): Promise<{ subject: string; html: string }> => {
      const res = await fetch(
        `${API_BASE}/api/notifications/qb-bulk-expiry/preview`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`Preview failed (${res.status})`);
      return res.json();
    },
    enabled: open,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (open && preview.isError) {
      toast({
        title: t("notifications.prefs.qbBulkExpiryPreviewFailed", {
          defaultValue: "Could not load email preview.",
        }),
        variant: "destructive",
      });
    }
  }, [open, preview.isError, toast, t]);

  return (
    <>
      <PillButton
        type="button"
        color="image"
        onClick={() => setOpen(true)}
        data-testid="button-qbBulkExpiry-preview"
      >
        {t("notifications.prefs.qbBulkExpiryPreview", {
          defaultValue: "Preview email",
        })}
      </PillButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-2xl"
          data-testid="dialog-qbBulkExpiry-preview"
        >
          <DialogHeader>
            <DialogTitle>
              {t("notifications.prefs.qbBulkExpiryPreviewTitle", {
                defaultValue: "Sample expiry-warning email",
              })}
            </DialogTitle>
            <DialogDescription>
              {t("notifications.prefs.qbBulkExpiryPreviewDesc", {
                defaultValue:
                  "Rendered with sample data using the same template the worker sends.",
              })}
            </DialogDescription>
          </DialogHeader>
          {preview.isLoading ? (
            <div
              className="text-sm text-muted-foreground py-8 text-center"
              data-testid="text-qbBulkExpiry-preview-loading"
            >
              {t("notifications.loading")}
            </div>
          ) : preview.isError || !preview.data ? (
            <div
              className="text-sm text-destructive py-8 text-center"
              data-testid="text-qbBulkExpiry-preview-error"
            >
              {t("notifications.prefs.qbBulkExpiryPreviewFailed", {
                defaultValue: "Could not load email preview.",
              })}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded border bg-muted/40 px-3 py-2 text-xs">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
                  {t("notifications.prefs.qbBulkExpiryPreviewSubject", {
                    defaultValue: "Subject",
                  })}
                </div>
                <div
                  className="font-medium text-foreground break-words"
                  data-testid="text-qbBulkExpiry-preview-subject"
                >
                  {preview.data.subject}
                </div>
              </div>
              <iframe
                title="QB bulk-action expiry email preview"
                sandbox=""
                srcDoc={preview.data.html}
                className="w-full h-[480px] rounded border bg-white"
                data-testid="iframe-qbBulkExpiry-preview"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
