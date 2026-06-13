import { useCallback, useState, useEffect, useRef } from "react";
import { useSearch, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CARD_INNER_RULE_CLASS, CARD_INNER_TILE_CLASS, CARD_INNER_TILE_CLICKABLE_CLASS, CARD_SUBCARD_META_ICON_CLASS, CARD_TITLE_ICON_CLASS } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import LiveConnectionPill, { type LiveConnectionStatus } from "@/components/live-connection-pill";
import { useLiveConnectionStatus } from "@/hooks/use-live-connection-status";
import { useRateLimitGate } from "@/hooks/use-rate-limit-gate";
import { type PillColor } from "@/components/status-pill-assets";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Flame, Plus, MapPin, Calendar, Clock, Trash2, Award, FileText, Copy, ExternalLink, Printer, Undo2, ListChecks, MessageCircle } from "lucide-react";
import ImagePill, { type ImagePillColor } from "@/components/image-pill";
import RemovePill from "@/components/remove-pill";
import CommentsPanel from "@/components/comments-panel";
import { PngPillButton } from "@/components/png-pill-rollover";
import { PILL_HEIGHT_CLASS, PILL_HEIGHT_PX, PILL_LABEL_CLASS, PILL_WRAPPER_CLASS, pillLabelToneClass } from "@/lib/pill-doctrine";
import { PillColorLayer } from "@/components/png-pill-chrome";
import {
  pillAmber,
  pillBlue,
  pillGreen,
  pillOrange,
  pillRed,
  PILL_IDLE,
} from "@/lib/pill-palette-assets";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { hotlistApi, isVendorListResponse, type HotlistJobRow, type HotlistBidRow } from "@/lib/hotlist-api";
import { useOnboardingProgress } from "@/hooks/use-onboarding-progress";
import {
  vendorFeatureUnlockMessage,
  vendorFeatureUnlocked,
} from "@/lib/onboarding-progress-utils";
import type { OnboardingProgressRow } from "@/lib/onboarding-api";
import { Link } from "wouter";
import {
  useListPartners,
  useGetDirectAwardCandidates,
  getGetDirectAwardCandidatesQueryKey,
  type DirectAwardCandidate,
  type HotlistJobStatus,
  type HotlistBidStatus,
} from "@workspace/api-client-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NEW_PILL_ASPECT = 900 / 229;

const hotlistSubcardMetaIconProps = {
  className: CARD_SUBCARD_META_ICON_CLASS,
  style: { color: "var(--brand-primary)" },
} as const;

function formatMoney(n: string | number) {
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (!Number.isFinite(v)) return "$-";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function toTitleCase(s: string): string {
  return s
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

// Mirror the `SiteLocationStatus` pattern in
// `artifacts/vndrly/src/components/status-badge.tsx`: typing the color
// map as `Record<HotlistJobStatus | HotlistBidStatus, PillColor>` makes
// adding a value to either OpenAPI enum a compile error here, so the UI
// can never silently fall back to grey for a real status. Runtime grey
// fallback is kept for resilience against malformed payloads only.
const HOTLIST_STATUS_PILL_COLOR: Record<
  HotlistJobStatus | HotlistBidStatus,
  PillColor
> = {
  open: "green",
  pending: "amber",
  awarded: "blue",
  declined: "red",
};

const HOTLIST_STATUS_COLOR: Record<
  HotlistJobStatus | HotlistBidStatus,
  ImagePillColor
> = {
  open: "green",
  pending: "amber",
  awarded: "blue",
  declined: "red",
};

function HotlistStatusPill({ status, className }: { status: HotlistJobStatus | HotlistBidStatus; className?: string }) {
  const color = HOTLIST_STATUS_COLOR[status] ?? "grey";
  return (
    <ImagePill
      color={color}
      className={cn("min-w-[98px] pointer-events-none", className)}
      data-testid={`badge-status-${status}`}
    >
      {toTitleCase(status)}
    </ImagePill>
  );
}

function HotlistBidCountBadge({ count }: { count: number }) {
  return (
    <Badge variant="outline" className="text-xs pointer-events-none">
      {count} bid{count === 1 ? "" : "s"}
    </Badge>
  );
}

/**
 * Task #51 — outline chip (same family as bid count) that opens the job's
 * comment thread. The panel loads every comment on the job, including
 * the viewer's own posts; unread count is a hint only and clears once
 * the thread fetch runs markAllSeen.
 */
function HotlistCommentsLink({
  jobId,
  unreadCount = 0,
  onClick,
}: {
  jobId: number;
  unreadCount?: number;
  onClick: (e: React.MouseEvent) => void;
}) {
  const unread = unreadCount ?? 0;
  const label =
    unread > 0
      ? `${unread} unread comment${unread === 1 ? "" : "s"}`
      : "View comments";
  const text = unread > 0 ? `${unread} comment${unread === 1 ? "" : "s"}` : "Comments";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 text-xs text-muted-foreground p-0 bg-transparent border-0",
        "hover:text-[color:var(--brand-primary)] transition-colors cursor-pointer",
        unread > 0 && "font-medium",
      )}
      title={label}
      aria-label={label}
      data-testid={`link-hotlist-comments-${jobId}`}
    >
      <MessageCircle className="w-3 h-3 shrink-0" />
      <span>{text}</span>
    </button>
  );
}

function HotlistJobMetaBadges({
  job,
  onOpenComments,
}: {
  job: HotlistJobRow;
  onOpenComments: (e: React.MouseEvent) => void;
}) {
  return (
    <>
      <HotlistBidCountBadge count={job.bidCount ?? 0} />
      <HotlistCommentsLink
        jobId={job.id}
        unreadCount={job.unreadCommentCount}
        onClick={onOpenComments}
      />
    </>
  );
}

function scrollToHotlistComments(jobId: number) {
  const el = document.getElementById(`hotlist-comments-${jobId}`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const hash = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
  if (hash.startsWith("comment-")) {
    const target = document.getElementById(hash);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function HotlistCommentsSection({ jobId }: { jobId: number }) {
  return (
    <div
      id={`hotlist-comments-${jobId}`}
      className="border-t pt-3 mt-3"
      data-testid={`section-hotlist-comments-${jobId}`}
    >
      <CommentsPanel
        source="hotlist"
        parentId={jobId}
        testIdPrefix={`hotlist-job-${jobId}-comments`}
      />
    </div>
  );
}

// Task #847 — short, partner-facing label for an ineligible bid. The
// long-form `ineligibleMessage` from the server lands in the row's
// native tooltip; this is what we render inline next to the vendor name.
function shortBidIneligibleReason(
  reason: HotlistBidRow["ineligibleReason"],
): string {
  switch (reason) {
    case "vendor_out_of_radius":
      return "out of radius";
    case "vendor_no_operating_area":
      return "no service area";
    case "job_not_geocoded":
      return "job not geocoded";
    case "missing_coi_document":
      return "no COI on file";
    case "missing_insurance_expiration":
      return "no insurance date";
    case "expired_insurance":
      return "insurance expired";
    case "missing_federal_tax_id":
      return "no tax ID";
    default:
      return "ineligible";
  }
}

/**
 * Small chip indicating whether the bidder has a preferred or approved
 * relationship with the partner that posted the job. Renders nothing
 * for unaffiliated bids — those rows already imply unaffiliated status
 * by being hidden behind the toggle.
 */
function RelationshipBadge({ status }: { status: "preferred" | "approved" | null }) {
  if (status === "approved") {
    return (
      <Badge
        variant="outline"
        className="bg-green-100 text-green-800 border-green-300 text-[10px] uppercase tracking-wide"
        data-testid="badge-relationship-approved"
      >
        Approved
      </Badge>
    );
  }
  if (status === "preferred") {
    return (
      <Badge
        variant="outline"
        className="bg-amber-100 text-amber-800 border-amber-300 text-[10px] uppercase tracking-wide"
        data-testid="badge-relationship-preferred"
      >
        Preferred
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="bg-gray-100 text-gray-700 border-gray-300 text-[10px] uppercase tracking-wide"
      data-testid="badge-relationship-unaffiliated"
    >
      Unaffiliated
    </Badge>
  );
}

function useFocusedHotlistJobId(): number | null {
  const search = useSearch();
  const v = new URLSearchParams(search).get("hotlistJob");
  return v ? parseInt(v) : null;
}

export default function HotlistSection() {
  const { user } = useAuth();
  const focusedJobId = useFocusedHotlistJobId();
  if (!user) return null;
  if (user.role === "partner") return <PartnerHotlist focusedJobId={focusedJobId} />;
  if (user.role === "vendor") return <VendorHotlist focusedJobId={focusedJobId} />;
  if (user.role === "admin") return <AdminHotlist />;
  return null;
}

function HotlistHeader({
  subtitle,
  action,
  liveStatus,
  liveTestId,
}: {
  subtitle: string;
  action?: React.ReactNode;
  // Task #666 — optional so the loading-state HotlistHeader instances
  // (which mount before any SSE state exists) can render without
  // showing a misleading pill. Each role view threads its own
  // liveStatus through once the page is past the loading skeleton.
  liveStatus?: LiveConnectionStatus;
  liveTestId?: string;
}) {
  return (
    <CardHeader className="flex flex-row items-center justify-between">
      <div>
        <CardTitle className="text-lg flex items-center gap-2">
          <Flame className={CARD_TITLE_ICON_CLASS} style={{ color: "var(--brand-primary)" }} />
          Hotlist
          {/* Live pill sits LEFT-aligned next to the title per the
              global Live-indicator placement doctrine. */}
          {liveStatus && (
            <LiveConnectionPill
              status={liveStatus}
              testId={liveTestId ?? "hotlist-live-connection-pill"}
            />
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
      </div>
      <div className="flex items-center gap-2">
        {action}
      </div>
    </CardHeader>
  );
}

/* ---------------- Partner view ---------------- */

function PartnerHotlist({ focusedJobId }: { focusedJobId: number | null }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const listKey = ["hotlist", "list", "partner", user?.partnerId];
  // Task #699 — gate the partner hotlist on `hotlist.rate_limited`.
  // The live ticket-feed pill below is repurposed to "reconnecting"
  // while the limiter has us parked, mirroring the tickets-page UX
  // (Task #675). The query is `enabled: !rateLimited` so SSE-driven
  // invalidations during the cooldown mark the cache stale but do
  // not refetch — the auto-clear in `useRateLimitGate` resumes
  // polling on its own.
  const [rateLimitedState, setRateLimitedState] = useState(false);
  const { data, isLoading, error: listError } = useQuery({
    queryKey: listKey,
    queryFn: () => hotlistApi.list() as Promise<HotlistJobRow[]>,
    enabled: !rateLimitedState,
    retry: (failureCount: number, err: unknown) => {
      const status = (err as { status?: number } | null)?.status;
      if (status === 429) return false;
      return failureCount < 3;
    },
  });
  const { rateLimited } = useRateLimitGate(listError, "hotlist.rate_limited");
  useEffect(() => {
    setRateLimitedState(rateLimited);
  }, [rateLimited]);
  // Task #666 — surface the live ticket-feed status the same way the
  // ticket list does. Hotlist jobs become tickets, so the ticket-events
  // SSE channel is the closest existing live-feed signal we have here.
  // On a hello-with-gap (browser auto-reconnected with a stale
  // Last-Event-ID, server replayed past us) we re-fetch the partner's
  // hotlist so any awarded/converted/expired transitions that happened
  // while we were offline catch up immediately instead of waiting on
  // the next focus refetch.
  const partnerId = user?.partnerId;
  const refetchHotlist = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["hotlist", "list", "partner", partnerId] });
  }, [qc, partnerId]);
  const liveStatus = useLiveConnectionStatus({
    url: `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/tickets/events`,
    helloEventName: "ticket.hello",
    onHelloWithGap: refetchHotlist,
  });
  const [postOpen, setPostOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    locationAddress: "",
    deadline: "",
    estimatedDurationDays: "",
    workTypeId: "",
  });
  const { data: partnerCatalogItems } = useQuery({
    queryKey: ["partner-hotlist-work-types", partnerId],
    queryFn: async () => {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(
        `${base}/api/partners/${partnerId}/work-type-afes`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = (await res.json()) as {
        items: { workTypeId: number; name: string; category: string }[];
      };
      return json.items ?? [];
    },
    enabled: !!partnerId,
  });
  const [expanded, setExpanded] = useState<number | null>(focusedJobId);
  const [commentsFocusJobId, setCommentsFocusJobId] = useState<number | null>(
    focusedJobId != null && typeof window !== "undefined" && window.location.hash.startsWith("#comment-")
      ? focusedJobId
      : null,
  );
  useEffect(() => {
    if (focusedJobId != null) {
      setExpanded(focusedJobId);
      if (typeof window !== "undefined" && window.location.hash.startsWith("#comment-")) {
        setCommentsFocusJobId(focusedJobId);
      }
    }
  }, [focusedJobId]);

  const createJob = useMutation({
    mutationFn: () =>
      hotlistApi.createJob({
        title: form.title,
        description: form.description || null,
        locationAddress: form.locationAddress,
        deadline: form.deadline || null,
        estimatedDurationDays: form.estimatedDurationDays
          ? parseInt(form.estimatedDurationDays)
          : null,
        workTypeId: form.workTypeId ? parseInt(form.workTypeId, 10) : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: listKey });
      setPostOpen(false);
      setForm({
        title: "",
        description: "",
        locationAddress: "",
        deadline: "",
        estimatedDurationDays: "",
        workTypeId: "",
      });
      toast({ title: "Hotlist job posted" });
    },
    onError: (e) => toast({ title: translateApiError(e, t, t("hotlist.errorToasts.postFailed")), variant: "destructive" }),
  });

  const deleteJob = useMutation({
    mutationFn: (id: number) => hotlistApi.deleteJob(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: listKey });
      toast({ title: "Job removed" });
    },
  });

  const jobs = (data ?? []) as HotlistJobRow[];

  return (
    <Card data-testid="hotlist-section">
      <HotlistHeader
        subtitle="Post jobs and review incoming vendor bids"
        liveStatus={rateLimited ? "reconnecting" : liveStatus}
        liveTestId="hotlist-partner-live-connection-pill"
        action={
          <div className="flex items-center gap-2">
            <a
              href={`${import.meta.env.BASE_URL}print-hotlist`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center"
            >
              <PngPillButton color="blue" data-testid="button-print-hotlist">
                <Printer className="w-4 h-4" />
                Print
              </PngPillButton>
            </a>
          <Dialog open={postOpen} onOpenChange={setPostOpen}>
            <DialogTrigger asChild>
              <PngPillButton color="blue" data-testid="button-post-hotlist">
                <Plus className="w-4 h-4" />Post Job
              </PngPillButton>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Post Hotlist Job</DialogTitle></DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!form.title || !form.locationAddress) return;
                  createJob.mutate();
                }}
                className="space-y-4"
              >
                <div><Label>Title</Label><Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-hotlist-title" /></div>
                <div>
                  <Label>{t("hotlist.productOrService", { defaultValue: "Product or service" })}</Label>
                  <Select
                    value={form.workTypeId || "__none__"}
                    onValueChange={(v) =>
                      setForm({ ...form, workTypeId: v === "__none__" ? "" : v })
                    }
                  >
                    <SelectTrigger data-testid="select-hotlist-work-type">
                      <SelectValue placeholder={t("hotlist.selectProductOrService", { defaultValue: "Optional — link to catalog" })} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{t("hotlist.noProductOrService", { defaultValue: "None (free text)" })}</SelectItem>
                      {(partnerCatalogItems ?? []).map((it) => (
                        <SelectItem key={it.workTypeId} value={String(it.workTypeId)}>
                          {it.name}{it.category ? ` · ${it.category}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="input-hotlist-description" /></div>
                <div><Label>Location Address</Label><Input required value={form.locationAddress} onChange={(e) => setForm({ ...form, locationAddress: e.target.value })} placeholder="Street, City, State" data-testid="input-hotlist-address" /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Deadline</Label><Input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} data-testid="input-hotlist-deadline" /></div>
                  <div><Label>Est. Duration (days)</Label><Input type="number" min="1" value={form.estimatedDurationDays} onChange={(e) => setForm({ ...form, estimatedDurationDays: e.target.value })} data-testid="input-hotlist-duration" /></div>
                </div>
                <PngPillButton type="submit" color="blue" disabled={createJob.isPending} className="w-full" data-testid="button-submit-hotlist">{createJob.isPending ? "Posting..." : "Post Job"}</PngPillButton>
              </form>
            </DialogContent>
          </Dialog>
          </div>
        }
      />
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">{[1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No Hotlist jobs posted yet.</p>
        ) : (
          <div className="space-y-3">
            {jobs.map((j) => (
              <PartnerJobCard
                key={j.id}
                job={j}
                expanded={expanded === j.id}
                commentsFocus={commentsFocusJobId === j.id}
                isFocused={focusedJobId === j.id}
                onToggle={() => {
                  if (expanded === j.id) {
                    setExpanded(null);
                    setCommentsFocusJobId((prev) => (prev === j.id ? null : prev));
                  } else {
                    setExpanded(j.id);
                  }
                }}
                onOpenComments={(e) => {
                  e.stopPropagation();
                  setExpanded(j.id);
                  setCommentsFocusJobId(j.id);
                }}
                onDelete={() => deleteJob.mutate(j.id)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PartnerJobCard({
  job,
  expanded,
  commentsFocus,
  isFocused,
  onToggle,
  onOpenComments,
  onDelete,
}: {
  job: HotlistJobRow;
  expanded: boolean;
  commentsFocus?: boolean;
  isFocused?: boolean;
  onToggle: () => void;
  onOpenComments: (e: React.MouseEvent) => void;
  onDelete: () => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { toast } = useToast();
  const listKey = ["hotlist", "list", "partner", user?.partnerId];
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (isFocused && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isFocused]);
  useEffect(() => {
    if (!expanded || !commentsFocus) return;
    const t = window.setTimeout(() => scrollToHotlistComments(job.id), 150);
    return () => window.clearTimeout(t);
  }, [expanded, commentsFocus, job.id]);
  const [includeUnaffiliated, setIncludeUnaffiliated] = useState(false);
  const { data: detail } = useQuery({
    queryKey: ["hotlist", "job", job.id, { includeUnaffiliated }],
    queryFn: () => hotlistApi.getJob(job.id, { includeUnaffiliated }),
    enabled: expanded,
  });
  const award = useMutation({
    mutationFn: (bidId: number) => hotlistApi.award(bidId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: listKey });
      qc.invalidateQueries({ queryKey: ["hotlist", "job", job.id] });
      toast({ title: "Bid awarded" });
    },
    onError: (e) => toast({ title: translateApiError(e, t, t("hotlist.errorToasts.awardFailed")), variant: "destructive" }),
  });

  return (
    <div
      ref={ref}
      className={cn(
        CARD_INNER_TILE_CLICKABLE_CLASS,
        "overflow-hidden p-0",
      )}
      data-testid={`hotlist-job-${job.id}`}
    >
      <div className="group p-3 flex items-center gap-3 cursor-pointer" onClick={onToggle}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="hotlist-job-title font-medium truncate transition-[color,text-shadow]" data-testid={`text-job-title-${job.id}`}>{job.title}</span>
            {job.partnerLogoUrl ? (
              <img
                src={job.partnerLogoUrl}
                alt={job.partnerName ?? "Partner"}
                className="h-[23px] w-auto max-w-[100px] object-contain shrink-0"
                data-testid={`img-partner-logo-${job.id}`}
              />
            ) : (
              job.partnerName && <span className="text-xs text-muted-foreground">· {job.partnerName}</span>
            )}
            <HotlistStatusPill status={job.status} className="w-[100px]" />
            <span onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-2 flex-wrap">
              <HotlistJobMetaBadges job={job} onOpenComments={onOpenComments} />
            </span>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-1">
            <span className="flex items-start gap-1"><MapPin {...hotlistSubcardMetaIconProps} />{job.locationAddress}</span>
            {job.deadline && <span className="flex items-start gap-1"><Calendar {...hotlistSubcardMetaIconProps} />{job.deadline}</span>}
            {job.estimatedDurationDays != null && <span className="flex items-start gap-1"><Clock {...hotlistSubcardMetaIconProps} />{job.estimatedDurationDays}d</span>}
          </div>
        </div>
        {job.status === "open" && (
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <DirectAwardButton job={job} />
            <button onClick={() => { if (confirm("Remove this job?")) onDelete(); }} className="text-muted-foreground hover:text-destructive transition-colors" data-testid={`button-delete-job-${job.id}`}>
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
      {expanded && (
        <div className={cn(CARD_INNER_RULE_CLASS, "px-3 py-3 space-y-2")}>
          {job.description && <p className="text-sm text-muted-foreground">{job.description}</p>}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              Bids ({detail?.bids?.length ?? 0}
              {detail?.totalBidCount != null && detail.totalBidCount !== (detail.bids?.length ?? 0)
                ? ` of ${detail.totalBidCount}`
                : ""})
            </p>
            {detail && (detail.unaffiliatedCount ?? 0) > 0 && !includeUnaffiliated && (
              <button
                type="button"
                onClick={() => setIncludeUnaffiliated(true)}
                className="text-xs underline underline-offset-2 hover:opacity-80"
                style={{ color: "var(--brand-primary)" }}
                data-testid={`button-show-unaffiliated-${job.id}`}
              >
                Show {detail.unaffiliatedCount} unaffiliated bid{detail.unaffiliatedCount === 1 ? "" : "s"}
              </button>
            )}
            {detail && includeUnaffiliated && (
              <button
                type="button"
                onClick={() => setIncludeUnaffiliated(false)}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                data-testid={`button-hide-unaffiliated-${job.id}`}
              >
                Hide unaffiliated bids
              </button>
            )}
          </div>
          {!detail ? (
            <Skeleton className="h-10 w-full" />
          ) : detail.bids.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {(detail.unaffiliatedCount ?? 0) > 0
                ? `No preferred or approved bids yet (${detail.unaffiliatedCount} unaffiliated hidden).`
                : "No bids yet."}
            </p>
          ) : (
            <div className="space-y-2">
              {detail.bids.map((b) => {
                // Task #847 — annotation arrives optional from the API
                // (older clients / cached responses may lack it). Treat
                // a missing `eligible` as "no opinion" so we don't grey
                // out bids that the server didn't annotate.
                const annotated = b.eligible !== undefined;
                const ineligible = annotated && b.eligible === false;
                const distanceLabel =
                  b.distanceMiles != null ? `${b.distanceMiles} mi` : null;
                const tooltip = b.ineligibleMessage ?? undefined;
                return (
                  <div
                    key={b.id}
                    className={`flex items-center gap-3 p-2 rounded bg-card border ${ineligible ? "opacity-60 bg-muted/40" : ""}`}
                    data-testid={`bid-${b.id}`}
                    data-bid-eligible={annotated ? (b.eligible ? "true" : "false") : undefined}
                    data-bid-ineligible-reason={b.ineligibleReason ?? undefined}
                    title={tooltip}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/vendors/${b.vendorId}`} className="text-sm font-medium text-primary hover:underline">{b.vendorName ?? `Vendor #${b.vendorId}`}</Link>
                        <HotlistStatusPill status={b.status} className="w-[100px]" />
                        <RelationshipBadge status={b.relationshipStatus ?? null} />
                        {distanceLabel && (
                          <Badge
                            variant="outline"
                            className={`text-[10px] uppercase tracking-wide ${b.inRadius ? "bg-emerald-50 text-emerald-800 border-emerald-300" : "bg-red-50 text-red-700 border-red-300"}`}
                            data-testid={`badge-bid-distance-${b.id}`}
                            title={
                              b.operatingRadiusMiles != null
                                ? `Vendor's operating radius is ${b.operatingRadiusMiles} mi`
                                : undefined
                            }
                          >
                            {distanceLabel}
                            {b.inRadius ? " · in radius" : " · out of radius"}
                          </Badge>
                        )}
                        {ineligible && (
                          <Badge
                            variant="outline"
                            className="bg-red-100 text-red-800 border-red-300 text-[10px] uppercase tracking-wide"
                            data-testid={`badge-bid-ineligible-${b.id}`}
                          >
                            {shortBidIneligibleReason(b.ineligibleReason)}
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">{formatMoney(b.amountUsd)}</span>
                        {b.etaDays != null && <span className="ml-2">ETA {b.etaDays}d</span>}
                      </div>
                      {b.notes && <p className="text-xs text-muted-foreground mt-1 italic">"{b.notes}"</p>}
                      {ineligible && b.ineligibleMessage && (
                        <p
                          className="text-[11px] text-red-700 mt-1"
                          data-testid={`text-bid-ineligible-message-${b.id}`}
                        >
                          {b.ineligibleMessage}
                        </p>
                      )}
                    </div>
                    {job.status === "open" && (
                      <span
                        title={
                          ineligible
                            ? (b.ineligibleMessage ?? "Bidder does not meet the award gate")
                            : undefined
                        }
                      >
                        <PngPillButton
                          color="amber"
                          onClick={() => award.mutate(b.id)}
                          disabled={award.isPending || ineligible}
                          data-testid={`button-award-${b.id}`}
                        >
                          <Award className="w-3 h-3" />Award
                        </PngPillButton>
                      </span>
                    )}
                    {job.status === "awarded" && b.status === "awarded" && (
                      <ConvertToTicketButton job={job} bid={b} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {commentsFocus && <HotlistCommentsSection jobId={job.id} />}
        </div>
      )}
    </div>
  );
}

/**
 * Task #495 — Partner-side Direct Award.
 * Lets the partner skip the bid auction and hand-pick a vendor for an
 * open hotlist job. The chosen vendor still has to clear the compliance
 * floor on the server (lib/vendor-tier.ts) and be in radius — those
 * checks bubble back as inline error messages.
 */
function DirectAwardButton({ job }: { job: HotlistJobRow }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [siteLocationId, setSiteLocationId] = useState<string>("");
  const [workTypeId, setWorkTypeId] = useState<string>("");
  const [vendorId, setVendorId] = useState<string>("");
  const [duration, setDuration] = useState<string>("");

  // Lookups — sites and work types are global partner-scoped reads.
  // Vendors come from /tickets/direct-award/candidates so the partner
  // can pick "unapproved" (onboarded but not yet preferred) vendors,
  // not just those with an existing partner_vendor_relationships row
  // — that's the whole point of Direct Award.
  const sites = useQuery<any[]>({
    queryKey: ["site-locations", "for-direct-award"],
    queryFn: async () => {
      const r = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/site-locations`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load sites");
      return r.json();
    },
    enabled: open,
  });
  const workTypes = useQuery<any[]>({
    queryKey: ["work-types", "for-direct-award"],
    queryFn: async () => {
      const r = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/work-types`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load work types");
      return r.json();
    },
    enabled: open,
  });
  // Candidates depend on BOTH site and work type — the server returns
  // every onboarded vendor with the matching work type and annotates
  // each with their tier, distance, in-radius flag, compliance-floor
  // result, and (for ineligible ones) a structured reason + human
  // message. Ineligible vendors are still returned so the partner can
  // see *why* a vendor isn't pickable instead of being silently
  // filtered out and getting rejected at submit time.
  //
  // Task #848 — uses the orval-generated `useGetDirectAwardCandidates`
  // hook so the response shape (`DirectAwardCandidate`) is sourced from
  // the OpenAPI spec instead of duplicated by hand. The generated query
  // key already includes the params, so it re-runs whenever the partner
  // changes the site or work type.
  type Candidate = DirectAwardCandidate;
  const candidateParams = {
    workTypeId: workTypeId ? parseInt(workTypeId, 10) : 0,
    siteLocationId: siteLocationId ? parseInt(siteLocationId, 10) : 0,
  };
  const vendors = useGetDirectAwardCandidates(candidateParams, {
    query: {
      enabled: open && !!workTypeId && !!siteLocationId,
      queryKey: getGetDirectAwardCandidatesQueryKey(candidateParams),
    },
  });

  const submit = useMutation({
    mutationFn: () =>
      hotlistApi.directAward({
        hotlistJobId: job.id,
        vendorId: parseInt(vendorId, 10),
        siteLocationId: parseInt(siteLocationId, 10),
        workTypeId: parseInt(workTypeId, 10),
        scheduledDurationMinutes: duration ? parseInt(duration, 10) : null,
      }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["hotlist", "list", "partner", user?.partnerId] });
      qc.invalidateQueries({ queryKey: ["hotlist", "job", job.id] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
      toast({ title: "Direct-awarded", description: `Ticket #${String(t?.id ?? "").padStart(8, "0")} created and sent to vendor for acceptance.` });
      setOpen(false);
      setSiteLocationId("");
      setWorkTypeId("");
      setVendorId("");
      setDuration("");
    },
    onError: (e) => toast({ title: translateApiError(e, t, t("hotlist.errorToasts.directAwardFailed")), variant: "destructive" }),
  });

  const canSubmit = !!siteLocationId && !!workTypeId && !!vendorId && !submit.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <PngPillButton color="amber" activeSrc={pillOrange} data-testid={`button-direct-award-${job.id}`}>
          <Award className="w-3 h-3" />Direct Award
        </PngPillButton>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Direct Award — {job.title}</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); submit.mutate(); }} className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Hand-pick a vendor for this hotlist job. The vendor must have a
            valid COI on file, federal tax ID, and an operating area that
            covers the site. The ticket will be sent to them for acceptance.
          </p>
          <div>
            <Label>Site</Label>
            <Select
              value={siteLocationId}
              onValueChange={(v) => {
                // Reset the vendor when the site changes — the candidate
                // list is keyed off the site (radius check), so the
                // previously selected vendor may no longer be in radius
                // for the new site.
                setSiteLocationId(v);
                setVendorId("");
              }}
            >
              <SelectTrigger data-testid="select-direct-award-site"><SelectValue placeholder="Choose a site" /></SelectTrigger>
              <SelectContent>
                {(sites.data ?? []).map((s: any) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name ?? `Site #${s.id}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Work type</Label>
            <Select
              value={workTypeId}
              onValueChange={(v) => {
                // Reset the vendor when the work type changes — the
                // candidate list is keyed off work type, so the
                // previously selected vendor may no longer be a valid
                // choice.
                setWorkTypeId(v);
                setVendorId("");
              }}
            >
              <SelectTrigger data-testid="select-direct-award-work-type"><SelectValue placeholder="Choose a work type" /></SelectTrigger>
              <SelectContent>
                {(workTypes.data ?? []).map((wt: any) => (
                  <SelectItem key={wt.id} value={String(wt.id)}>{wt.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Vendor</Label>
            {(() => {
              const ready = !!workTypeId && !!siteLocationId;
              const list = vendors.data ?? [];
              // Server already returns vendors grouped by tier and sorted
              // by distance within each tier. We split locally so we can
              // render a labelled "Approved" section first, then an
              // "Unapproved — Direct Award" section with the explainer.
              const approved = list.filter((v) => v.tier === "approved");
              const unapproved = list.filter((v) => v.tier !== "approved");
              const eligibleCount = list.filter((v) => v.eligible).length;

              // Short label rendered inline in the disabled select item;
              // the full explanation lands in the row's `title` (native
              // browser tooltip) so the partner can hover to read why.
              const shortReason = (v: Candidate): string => {
                if (v.eligible) return "";
                switch (v.ineligibleReason) {
                  case "vendor_out_of_radius":
                    return "out of radius";
                  case "vendor_no_operating_area":
                    return "no service area";
                  case "site_not_geocoded":
                    return "site not geocoded";
                  case "missing_coi_document":
                    return "no COI on file";
                  case "missing_insurance_expiration":
                    return "no insurance date";
                  case "expired_insurance":
                    return "insurance expired";
                  case "missing_federal_tax_id":
                    return "no tax ID";
                  default:
                    return "ineligible";
                }
              };
              const distanceLabel = (v: Candidate): string =>
                v.distanceMiles == null ? "—" : `${v.distanceMiles} mi`;

              const renderItem = (v: Candidate) => (
                <SelectItem
                  key={v.id}
                  value={String(v.id)}
                  disabled={!v.eligible}
                  data-testid={`select-direct-award-vendor-option-${v.id}`}
                  data-eligible={v.eligible ? "true" : "false"}
                  data-ineligible-reason={v.ineligibleReason ?? undefined}
                  className={!v.eligible ? "opacity-60" : undefined}
                >
                  {/* Two-line layout for ineligible vendors so the full
                      reason is always visible. We can't rely on a hover
                      tooltip here because Radix's SelectItem disables
                      pointer events on disabled rows. */}
                  <span className="flex flex-col gap-0.5 py-0.5">
                    <span className="flex items-center gap-2">
                      <span>{v.name}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground">
                        {distanceLabel(v)}
                      </span>
                      {!v.eligible && (
                        <>
                          <span className="text-muted-foreground">·</span>
                          <span
                            className="text-red-600 text-[11px] font-medium"
                            data-testid={`select-direct-award-vendor-reason-${v.id}`}
                          >
                            {shortReason(v)}
                          </span>
                        </>
                      )}
                    </span>
                    {!v.eligible && v.ineligibleMessage && (
                      <span
                        className="text-[10px] text-muted-foreground leading-tight"
                        data-testid={`select-direct-award-vendor-message-${v.id}`}
                      >
                        {v.ineligibleMessage}
                      </span>
                    )}
                  </span>
                </SelectItem>
              );

              return (
                <Select value={vendorId} onValueChange={setVendorId} disabled={!ready}>
                  <SelectTrigger data-testid="select-direct-award-vendor">
                    <SelectValue
                      placeholder={
                        ready
                          ? list.length === 0
                            ? "No vendors with this work type"
                            : eligibleCount === 0
                              ? "No eligible vendors — see reasons below"
                              : "Choose a vendor"
                          : "Pick a site and work type first"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {approved.length > 0 && (
                      <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Approved
                      </div>
                    )}
                    {approved.map(renderItem)}
                    {unapproved.length > 0 && (
                      <div className="px-2 py-1 mt-1 text-[11px] font-semibold text-amber-700 uppercase tracking-wider border-t">
                        Unapproved — Direct Award
                      </div>
                    )}
                    {unapproved.length > 0 && (
                      <p className="px-2 pb-1 text-[11px] text-muted-foreground">
                        These vendors haven't been approved by your team
                        yet. Direct-awarding sends the ticket directly to
                        them, bypassing the bid auction. They must still
                        accept and clear the compliance floor.
                      </p>
                    )}
                    {unapproved.map(renderItem)}
                  </SelectContent>
                </Select>
              );
            })()}
            <p className="text-[11px] text-muted-foreground mt-1">
              Vendors out of radius or missing COI / insurance / tax ID
              are greyed out with the reason shown inline.
            </p>
          </div>
          <div>
            <Label>Scheduled duration (minutes, optional)</Label>
            <Input type="number" min="0" value={duration} onChange={(e) => setDuration(e.target.value)} data-testid="input-direct-award-duration" />
          </div>
          <div className="flex gap-2">
            <PngPillButton type="submit" color="blue" disabled={!canSubmit} className="flex-1" data-testid="button-submit-direct-award">{submit.isPending ? "Awarding..." : "Direct Award"}</PngPillButton>
            <PngPillButton type="button" color="red" onClick={() => setOpen(false)}>Cancel</PngPillButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConvertToTicketButton({ job, bid }: { job: HotlistJobRow; bid: HotlistBidRow }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [siteLocationId, setSiteLocationId] = useState<string>("");
  const [workTypeId, setWorkTypeId] = useState<string>("");
  const [duration, setDuration] = useState<string>("");

  // If the job has already been converted, jump to the existing ticket.
  const alreadyConvertedTicketId = job.convertedTicketId ?? null;

  const sites = useQuery<any[]>({
    queryKey: ["site-locations", "for-hotlist-convert"],
    queryFn: async () => {
      const r = await fetch(
        `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/site-locations`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error("Failed to load sites");
      return r.json();
    },
    enabled: open && !alreadyConvertedTicketId,
  });
  const workTypes = useQuery<any[]>({
    queryKey: ["work-types", "for-hotlist-convert"],
    queryFn: async () => {
      const r = await fetch(
        `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/work-types`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error("Failed to load work types");
      return r.json();
    },
    enabled: open && !alreadyConvertedTicketId,
  });

  const submit = useMutation({
    mutationFn: () =>
      hotlistApi.convertToTicket(job.id, {
        siteLocationId: parseInt(siteLocationId, 10),
        workTypeId: parseInt(workTypeId, 10),
        scheduledDurationMinutes: duration ? parseInt(duration, 10) : null,
      }),
    onSuccess: (resp) => {
      qc.invalidateQueries({
        queryKey: ["hotlist", "list", "partner", user?.partnerId],
      });
      qc.invalidateQueries({ queryKey: ["hotlist", "job", job.id] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
      toast({
        title: "Ticket created",
        description: `Tracking #${String(resp.ticketId).padStart(8, "0")} sent to ${
          bid.vendorName ?? `Vendor #${bid.vendorId}`
        } for acceptance.`,
      });
      setOpen(false);
      navigate(`/tickets/${resp.ticketId}`);
    },
    onError: (e: any) => {
      // If a concurrent click already converted, jump to that ticket
      // instead of just toasting an error.
      const data = e?.data ?? null;
      if (data?.error === "already_converted" && data?.convertedTicketId) {
        toast({
          title: "Already converted",
          description: `Opening ticket #${String(data.convertedTicketId).padStart(8, "0")}.`,
        });
        setOpen(false);
        navigate(`/tickets/${data.convertedTicketId}`);
        return;
      }
      toast({
        title: translateApiError(e, t, "Failed to create ticket"),
        variant: "destructive",
      });
    },
  });

  const canSubmit = !!siteLocationId && !!workTypeId && !submit.isPending;

  if (alreadyConvertedTicketId) {
    return (
      <Link href={`/tickets/${alreadyConvertedTicketId}`}>
        <PngPillButton
          data-testid={`button-view-converted-ticket-${job.id}`}
        >
          <ExternalLink className="w-3 h-3" />
          View Ticket #{String(alreadyConvertedTicketId).padStart(8, "0")}
        </PngPillButton>
      </Link>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <PngPillButton color="blue" data-testid={`button-convert-ticket-${job.id}`}>
          <FileText className="w-3 h-3" />Create Ticket
        </PngPillButton>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Ticket — {job.title}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
          className="space-y-4"
        >
          <div className="rounded border bg-muted/30 px-3 py-2 text-xs space-y-1">
            <div>
              <span className="font-semibold">Awarded vendor:</span>{" "}
              {bid.vendorName ?? `Vendor #${bid.vendorId}`}
            </div>
            <div>
              <span className="font-semibold">Winning bid:</span>{" "}
              {formatMoney(bid.amountUsd)}
              {bid.etaDays != null ? ` · ETA ${bid.etaDays}d` : ""}
            </div>
            <div>
              <span className="font-semibold">Location:</span> {job.locationAddress}
            </div>
            {job.deadline && (
              <div>
                <span className="font-semibold">Deadline:</span> {job.deadline}
              </div>
            )}
          </div>
          <div>
            <Label>Site</Label>
            <Select value={siteLocationId} onValueChange={setSiteLocationId}>
              <SelectTrigger data-testid="select-convert-ticket-site">
                <SelectValue placeholder="Choose a site" />
              </SelectTrigger>
              <SelectContent>
                {(sites.data ?? []).map((s: any) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name ?? `Site #${s.id}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Work type</Label>
            <Select value={workTypeId} onValueChange={setWorkTypeId}>
              <SelectTrigger data-testid="select-convert-ticket-work-type">
                <SelectValue placeholder="Choose a work type" />
              </SelectTrigger>
              <SelectContent>
                {(workTypes.data ?? []).map((wt: any) => (
                  <SelectItem key={wt.id} value={String(wt.id)}>
                    {wt.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">
              The site and work type identify which catalog row this ticket
              ties to. If no assignment exists yet for this vendor at this
              site/work-type, one will be created.
            </p>
          </div>
          <div>
            <Label>Scheduled duration (minutes, optional)</Label>
            <Input
              type="number"
              min="0"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              data-testid="input-convert-ticket-duration"
            />
          </div>
          <div className="flex gap-2">
            <PngPillButton
              type="submit"
              color="blue"
              disabled={!canSubmit}
              className="flex-1"
              data-testid="button-submit-convert-ticket"
            >
              {submit.isPending ? "Creating…" : "Create Ticket"}
            </PngPillButton>
            <PngPillButton type="button" color="red" onClick={() => setOpen(false)}>
              Cancel
            </PngPillButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Vendor view ---------------- */

function VendorHotlist({ focusedJobId }: { focusedJobId: number | null }) {
  const { user } = useAuth();
  const { progress: onboardingProgress } = useOnboardingProgress();
  const qc = useQueryClient();
  // Task #727 — vendors see only jobs that match their work-type catalog
  // by default. The "Show all" pill flips includeAll=1 so the API
  // returns the full list. We key this into the queryKey so toggling
  // off the filter actually refetches instead of pulling from cache.
  const [includeAll, setIncludeAll] = useState(false);
  const listKey = ["hotlist", "list", "vendor", user?.vendorId, includeAll];
  // Task #699 — see PartnerHotlist for the gate rationale; same shape.
  const [rateLimitedState, setRateLimitedState] = useState(false);
  const { data, isLoading, error: listError } = useQuery({
    queryKey: listKey,
    queryFn: () => hotlistApi.list({ includeAll }),
    enabled: !rateLimitedState,
    retry: (failureCount: number, err: unknown) => {
      const status = (err as { status?: number } | null)?.status;
      if (status === 429) return false;
      return failureCount < 3;
    },
  });
  const { rateLimited } = useRateLimitGate(listError, "hotlist.rate_limited");
  useEffect(() => {
    setRateLimitedState(rateLimited);
  }, [rateLimited]);
  // Task #666 — same live ticket-feed pill the partner view shows.
  // Vendors care about ticket lifecycle just as much (their own bids
  // get awarded → become tickets), so on a hello-with-gap we re-fetch
  // their hotlist so any status flips that landed while we were
  // offline catch up immediately.
  const vendorId = user?.vendorId;
  const refetchVendorHotlist = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["hotlist", "list", "vendor", vendorId] });
  }, [qc, vendorId]);
  const liveStatus = useLiveConnectionStatus({
    url: `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/tickets/events`,
    helloEventName: "ticket.hello",
    onHelloWithGap: refetchVendorHotlist,
  });
  const [commentsFocusJobId, setCommentsFocusJobId] = useState<number | null>(
    focusedJobId != null && typeof window !== "undefined" && window.location.hash.startsWith("#comment-")
      ? focusedJobId
      : null,
  );
  useEffect(() => {
    if (focusedJobId != null && typeof window !== "undefined" && window.location.hash.startsWith("#comment-")) {
      setCommentsFocusJobId(focusedJobId);
    }
  }, [focusedJobId]);

  if (isLoading) {
    return (
      <Card data-testid="hotlist-section">
        <HotlistHeader
          subtitle="Open jobs near you"
          liveStatus={rateLimited ? "reconnecting" : liveStatus}
          liveTestId="hotlist-vendor-live-connection-pill"
        />
        <CardContent><Skeleton className="h-16 w-full" /></CardContent>
      </Card>
    );
  }

  if (!data || !isVendorListResponse(data)) return null;

  if (data.reason === "missing_operating_area" || !data.vendor || data.vendor.operatingRadiusMiles == null || data.vendor.latitude == null) {
    return (
      <Card data-testid="hotlist-section">
        <HotlistHeader
          subtitle="Open jobs near you"
          liveStatus={rateLimited ? "reconnecting" : liveStatus}
          liveTestId="hotlist-vendor-live-connection-pill"
        />
        <CardContent>
          <div className="text-center py-6 space-y-2">
            <p className="text-sm">Set your operating area to see Hotlist jobs.</p>
            <Link href={`/vendors/${user?.vendorId}`}>
              <PngPillButton color="blue" data-testid="link-set-operating-area">Set Operating Area</PngPillButton>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  const inRadius = data.jobs.filter((j) => !(j as any).outOfRadius);
  const outOfRadius = data.jobs.filter((j) => (j as any).outOfRadius);
  // Task #727 — only show the filter UI when there's a non-empty
  // catalog. With an empty catalog the API returns the full list with
  // no filter applied (so the pill would be misleading).
  const catalogActive = !!data.catalog && data.catalog.size > 0;
  const filteredCount = data.catalog?.filteredCount ?? 0;
  return (
    <Card data-testid="hotlist-section">
      <HotlistHeader
        subtitle={`Open jobs within ${data.vendor.operatingRadiusMiles} miles`}
        liveStatus={rateLimited ? "reconnecting" : liveStatus}
        liveTestId="hotlist-vendor-live-connection-pill"
      />
      <CardContent>
        {catalogActive ? (
          <div
            className="mb-3 flex flex-wrap items-center gap-2 text-xs"
            data-testid="hotlist-catalog-filter-bar"
          >
            {includeAll ? (
              <>
                <span
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted text-muted-foreground"
                  data-testid="pill-catalog-all"
                >
                  <ListChecks className="w-3 h-3" />
                  Showing all jobs
                </span>
                <button
                  type="button"
                  onClick={() => setIncludeAll(false)}
                  className="font-medium hover:opacity-80"
                  style={{ color: "var(--brand-primary)" }}
                  data-testid="button-filter-by-catalog"
                >
                  Filter to my services
                </button>
              </>
            ) : (
              <>
                <span
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-300"
                  data-testid="pill-catalog-filtered"
                  title="Only jobs that match your work-type catalog are shown."
                >
                  <ListChecks className="w-3 h-3" />
                  Filtered by your services
                </span>
                {filteredCount > 0 ? (
                  <span
                    className="text-muted-foreground"
                    data-testid="text-catalog-filtered-count"
                  >
                    {filteredCount} hidden
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => setIncludeAll(true)}
                  className="font-medium ml-auto hover:opacity-80"
                  style={{ color: "var(--brand-primary)" }}
                  data-testid="button-show-all-jobs"
                >
                  Show all
                </button>
              </>
            )}
          </div>
        ) : null}
        {inRadius.length === 0 && outOfRadius.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No open jobs right now.</p>
        ) : (
          <div className="space-y-3">
            {inRadius.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-3">No open jobs in your operating area right now.</p>
            ) : (
              inRadius.map((j) => (
                <VendorJobCard
                  key={j.id}
                  job={j}
                  onboardingProgress={onboardingProgress}
                  isFocused={focusedJobId === j.id}
                  commentsFocus={commentsFocusJobId === j.id}
                  onOpenComments={() => setCommentsFocusJobId(j.id)}
                />
              ))
            )}
            {outOfRadius.length > 0 && (
              <details className={cn(CARD_INNER_TILE_CLASS, "p-0")} data-testid="section-out-of-radius" open={outOfRadius.some((j) => focusedJobId === j.id)}>
                <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground hover:bg-muted/40">
                  Show {outOfRadius.length} job{outOfRadius.length === 1 ? "" : "s"} outside your radius
                </summary>
                <div className="space-y-2 p-2 border-t">
                  {outOfRadius.map((j) => (
                    <VendorJobCard
                      key={j.id}
                      job={j}
                      onboardingProgress={onboardingProgress}
                      radiusMiles={data.vendor!.operatingRadiusMiles!}
                      isFocused={focusedJobId === j.id}
                      commentsFocus={commentsFocusJobId === j.id}
                      onOpenComments={() => setCommentsFocusJobId(j.id)}
                    />
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VendorJobCard({
  job,
  onboardingProgress,
  radiusMiles,
  isFocused,
  commentsFocus,
  onOpenComments,
}: {
  job: HotlistJobRow;
  onboardingProgress?: OnboardingProgressRow | null;
  radiusMiles?: number;
  isFocused?: boolean;
  commentsFocus?: boolean;
  onOpenComments: () => void;
}) {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { toast } = useToast();
  const listKey = ["hotlist", "list", "vendor", user?.vendorId];
  const [open, setOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(!!commentsFocus);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (isFocused && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isFocused]);
  useEffect(() => {
    if (commentsFocus) setCommentsOpen(true);
  }, [commentsFocus]);
  useEffect(() => {
    if (!commentsOpen) return;
    const timer = window.setTimeout(() => scrollToHotlistComments(job.id), 150);
    return () => window.clearTimeout(timer);
  }, [commentsOpen, job.id]);
  const [form, setForm] = useState({
    amountUsd: job.myBid?.amountUsd ?? "",
    etaDays: job.myBid?.etaDays != null ? String(job.myBid.etaDays) : "",
    notes: job.myBid?.notes ?? "",
  });
  const outOfRadius = !!(job as any).outOfRadius;
  const onboardingBidLocked = !vendorFeatureUnlocked(
    onboardingProgress,
    "hotlist_bid_area",
  );
  const onboardingUnlock = vendorFeatureUnlockMessage(
    onboardingProgress,
    "hotlist_bid_area",
  );
  const myTier: "approved" | "unapproved" | "pre_onboarded" = (job as any).myTier ?? "pre_onboarded";
  const tierBlocked = myTier !== "approved";

  const bid = useMutation({
    mutationFn: () => hotlistApi.bid(job.id, { amountUsd: parseFloat(form.amountUsd as string), etaDays: form.etaDays ? parseInt(form.etaDays) : null, notes: form.notes || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: listKey });
      setOpen(false);
      toast({ title: job.myBid ? "Bid updated" : "Bid placed" });
    },
    onError: (e) => toast({ title: translateApiError(e, t, t("hotlist.errorToasts.bidFailed")), variant: "destructive" }),
  });

  return (
    <div
      ref={ref}
      className={cn(
        CARD_INNER_TILE_CLICKABLE_CLASS,
        "group overflow-hidden p-0",
        outOfRadius && "opacity-60",
      )}
      data-testid={`hotlist-job-${job.id}`}
    >
      <div className="p-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="hotlist-job-title font-medium truncate transition-[color,text-shadow]">{job.title}</span>
          {job.partnerLogoUrl ? (
            <img
              src={job.partnerLogoUrl}
              alt={job.partnerName ?? "Partner"}
              className="h-[23px] w-auto max-w-[100px] object-contain shrink-0"
              data-testid={`img-partner-logo-${job.id}`}
            />
          ) : (
            job.partnerName && <span className="text-xs text-muted-foreground">· {job.partnerName}</span>
          )}
          {job.distanceMiles != null && (
            <Badge variant="outline" className={`text-xs ${outOfRadius ? "border-amber-400 text-amber-700" : ""}`}>{job.distanceMiles} mi</Badge>
          )}
          <HotlistJobMetaBadges
            job={job}
            onOpenComments={(e) => {
              e.stopPropagation();
              setCommentsOpen(true);
              onOpenComments();
            }}
          />
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-1">
          <span className="flex items-start gap-1"><MapPin {...hotlistSubcardMetaIconProps} />{job.locationAddress}</span>
          {job.deadline && <span className="flex items-start gap-1"><Calendar {...hotlistSubcardMetaIconProps} />{job.deadline}</span>}
          {job.estimatedDurationDays != null && <span className="flex items-start gap-1"><Clock {...hotlistSubcardMetaIconProps} />{job.estimatedDurationDays}d</span>}
        </div>
        {job.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{job.description}</p>}
        {outOfRadius && (
          <p className="text-xs text-amber-700 mt-1" data-testid={`text-out-of-radius-${job.id}`}>
            Outside your operating radius ({job.distanceMiles} mi away{radiusMiles ? `, limit ${radiusMiles} mi` : ""}). Increase your radius to bid.
          </p>
        )}
        {!outOfRadius && onboardingBidLocked && onboardingUnlock && (
          <p className="text-xs text-amber-700 mt-1" data-testid={`text-onboarding-bid-locked-${job.id}`}>
            {t("onboardingProgress.hotlistBidLocked")}{" "}
            <button
              type="button"
              className="font-medium underline underline-offset-2"
              onClick={(e) => {
                e.stopPropagation();
                navigate(onboardingUnlock.href);
              }}
            >
              {t("onboardingProgress.continueSetup")}
            </button>
          </p>
        )}
        {!outOfRadius && !onboardingBidLocked && tierBlocked && (
          <p className="text-xs text-amber-700 mt-1" data-testid={`text-tier-blocked-${job.id}`}>
            Only approved vendors can bid on hotlist jobs. Reach out to {job.partnerName ?? "the partner"} to request approval.
          </p>
        )}
        {job.myBid && (
          <div className="text-xs mt-1"><span className="text-muted-foreground">Your bid:</span> <span className="font-semibold">{formatMoney(job.myBid.amountUsd)}</span> <HotlistStatusPill status={job.myBid.status} className="w-[100px]" /></div>
        )}
      </div>
      {outOfRadius ? (
        <PngPillButton disabled className="mr-2" data-testid={`button-bid-disabled-${job.id}`}>Out of radius</PngPillButton>
      ) : onboardingBidLocked ? (
        <PngPillButton
          disabled
          className="mr-2"
          data-testid={`button-bid-onboarding-locked-${job.id}`}
        >
          {t("onboardingProgress.finishSetupFirst")}
        </PngPillButton>
      ) : tierBlocked ? (
        <PngPillButton disabled className="mr-2" data-testid={`button-bid-blocked-${job.id}`}>Approval needed</PngPillButton>
      ) : (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <PngPillButton color="blue" className="mr-2" data-testid={`button-bid-${job.id}`}>{job.myBid ? "Update Bid" : "Bid"}</PngPillButton>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>{job.myBid ? "Update Bid" : "Place Bid"} — {job.title}</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); bid.mutate(); }} className="space-y-4">
            <div><Label>Bid Amount (USD)</Label><Input required type="number" min="0" step="0.01" value={form.amountUsd} onChange={(e) => setForm({ ...form, amountUsd: e.target.value })} data-testid="input-bid-amount" /></div>
            <div><Label>ETA (days)</Label><Input type="number" min="0" value={form.etaDays} onChange={(e) => setForm({ ...form, etaDays: e.target.value })} data-testid="input-bid-eta" /></div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Crew size, scope clarifications, etc." data-testid="input-bid-notes" /></div>
            <div className="flex gap-2">
              <PngPillButton type="submit" color="blue" disabled={bid.isPending} className="flex-1" data-testid="button-submit-bid">{bid.isPending ? "Saving..." : job.myBid ? "Update Bid" : "Submit Bid"}</PngPillButton>
              <PngPillButton type="button" color="red" onClick={() => setOpen(false)}>Cancel</PngPillButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      )}
      </div>
      {commentsOpen && (
        <div className={cn(CARD_INNER_RULE_CLASS, "px-3 pb-3")}>
          <HotlistCommentsSection jobId={job.id} />
        </div>
      )}
    </div>
  );
}

/* ---------------- Admin view ---------------- */

function AdminHotlist() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [showRemoved, setShowRemoved] = useState(false);
  const [postOpen, setPostOpen] = useState(false);
  const [form, setForm] = useState({
    partnerId: "",
    title: "",
    description: "",
    locationAddress: "",
    deadline: "",
    estimatedDurationDays: "",
  });
  const [confirmRemoveId, setConfirmRemoveId] = useState<number | null>(null);
  const [detailJobId, setDetailJobId] = useState<number | null>(null);
  const [detailScrollToComments, setDetailScrollToComments] = useState(false);

  const listKey = ["hotlist", "list", "admin", showRemoved];
  // Task #699 — see PartnerHotlist for the gate rationale; same shape.
  const [rateLimitedState, setRateLimitedState] = useState(false);
  const { data, isLoading, error: listError } = useQuery({
    queryKey: listKey,
    queryFn: () => hotlistApi.list({ includeDeleted: showRemoved }) as Promise<HotlistJobRow[]>,
    enabled: !rateLimitedState,
    retry: (failureCount: number, err: unknown) => {
      const status = (err as { status?: number } | null)?.status;
      if (status === 429) return false;
      return failureCount < 3;
    },
  });
  const { rateLimited } = useRateLimitGate(listError, "hotlist.rate_limited");
  useEffect(() => {
    setRateLimitedState(rateLimited);
  }, [rateLimited]);
  const jobs = (data ?? []) as HotlistJobRow[];

  // Task #666 — same live ticket-feed pill the partner/vendor views show.
  // Admins watch every partner/vendor stream at once, so the pill is
  // arguably most useful here. On a hello-with-gap we re-fetch every
  // admin hotlist view (showRemoved=true and false) so the dispatcher's
  // current and toggled-state caches stay current after a reconnect.
  const refetchAdminHotlist = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["hotlist", "list", "admin"] });
  }, [qc]);
  const liveStatus = useLiveConnectionStatus({
    url: `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/tickets/events`,
    helloEventName: "ticket.hello",
    onHelloWithGap: refetchAdminHotlist,
  });

  // Auto-close the Job Particulars dialog if the focused job disappears from
  // the visible list (e.g. removed while showRemoved=false).
  useEffect(() => {
    if (detailJobId != null && !jobs.some((j) => j.id === detailJobId)) {
      setDetailJobId(null);
      setDetailScrollToComments(false);
    }
  }, [detailJobId, jobs]);

  useEffect(() => {
    if (detailJobId == null || !detailScrollToComments) return;
    const timer = window.setTimeout(() => scrollToHotlistComments(detailJobId), 200);
    return () => window.clearTimeout(timer);
  }, [detailJobId, detailScrollToComments]);

  const { data: partners } = useListPartners();

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["hotlist", "list", "admin"] });
  };

  const createJob = useMutation({
    mutationFn: () =>
      hotlistApi.createJob({
        partnerId: parseInt(form.partnerId),
        title: form.title,
        description: form.description || null,
        locationAddress: form.locationAddress,
        deadline: form.deadline || null,
        estimatedDurationDays: form.estimatedDurationDays ? parseInt(form.estimatedDurationDays) : null,
      }),
    onSuccess: () => {
      invalidateAll();
      setPostOpen(false);
      setForm({ partnerId: "", title: "", description: "", locationAddress: "", deadline: "", estimatedDurationDays: "" });
      toast({ title: "Hotlist job posted" });
    },
    onError: (e) => toast({ title: translateApiError(e, t, t("hotlist.errorToasts.postFailed")), variant: "destructive" }),
  });

  const removeJob = useMutation({
    mutationFn: (id: number) => hotlistApi.deleteJob(id),
    onSuccess: () => {
      invalidateAll();
      setConfirmRemoveId(null);
      toast({ title: "Job removed from Hotlist" });
    },
    onError: (e) => toast({ title: translateApiError(e, t, t("hotlist.errorToasts.removeFailed")), variant: "destructive" }),
  });

  const restoreJob = useMutation({
    mutationFn: (id: number) => hotlistApi.restoreJob(id),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Job restored to Hotlist" });
    },
    onError: (e) => toast({ title: translateApiError(e, t, t("hotlist.errorToasts.restoreFailed")), variant: "destructive" }),
  });

  const jobPendingRemoval = confirmRemoveId != null ? jobs.find((j) => j.id === confirmRemoveId) ?? null : null;

  return (
    <Card data-testid="hotlist-section">
      <HotlistHeader
        subtitle={showRemoved ? "All Hotlist jobs (including removed)" : "All Hotlist jobs across partners"}
        liveStatus={rateLimited ? "reconnecting" : liveStatus}
        liveTestId="hotlist-admin-live-connection-pill"
        action={
          <div className="flex items-center gap-2">
            <a
              href={`${import.meta.env.BASE_URL}print-hotlist`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center"
            >
              <PngPillButton color="blue" data-testid="button-print-hotlist-admin">
                <Printer className="w-4 h-4" />
                Print
              </PngPillButton>
            </a>
            <Dialog open={postOpen} onOpenChange={setPostOpen}>
              <DialogTrigger asChild>
                <PngPillButton color="blue" data-testid="button-post-hotlist-admin">
                  <Plus className="w-4 h-4" />Post Job
                </PngPillButton>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Post Hotlist Job (Admin)</DialogTitle></DialogHeader>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!form.partnerId || !form.title || !form.locationAddress) return;
                    createJob.mutate();
                  }}
                  className="space-y-4"
                >
                  <div>
                    <Label>Partner</Label>
                    <Select value={form.partnerId} onValueChange={(v) => setForm({ ...form, partnerId: v })}>
                      <SelectTrigger data-testid="select-hotlist-partner"><SelectValue placeholder="Select a partner" /></SelectTrigger>
                      <SelectContent>
                        {(partners ?? []).map((p: any) => (
                          <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Title</Label><Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-hotlist-admin-title" /></div>
                  <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="input-hotlist-admin-description" /></div>
                  <div><Label>Location Address</Label><Input required value={form.locationAddress} onChange={(e) => setForm({ ...form, locationAddress: e.target.value })} placeholder="Street, City, State" data-testid="input-hotlist-admin-address" /></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><Label>Deadline</Label><Input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} data-testid="input-hotlist-admin-deadline" /></div>
                    <div><Label>Est. Duration (days)</Label><Input type="number" min="1" value={form.estimatedDurationDays} onChange={(e) => setForm({ ...form, estimatedDurationDays: e.target.value })} data-testid="input-hotlist-admin-duration" /></div>
                  </div>
                  <PngPillButton type="submit" color="blue" disabled={createJob.isPending || !form.partnerId} className="w-full" data-testid="button-submit-hotlist-admin">{createJob.isPending ? "Posting..." : "Post Job"}</PngPillButton>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        }
      />
      <CardContent>
        <div className="flex items-center justify-end -mt-4 mb-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none" data-testid="toggle-show-removed">
            <input
              type="checkbox"
              checked={showRemoved}
              onChange={(e) => setShowRemoved(e.target.checked)}
              className="cursor-pointer"
            />
            Show removed jobs
          </label>
        </div>
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No Hotlist jobs.</p>
        ) : (
          <div className="space-y-2">
            {jobs.map((j) => {
              const isRemoved = !!j.deletedAt;
              return (
                <div
                  key={j.id}
                  className={cn(
                    CARD_INNER_TILE_CLICKABLE_CLASS,
                    "group flex items-center gap-3",
                    isRemoved && "opacity-60",
                  )}
                  data-testid={`hotlist-job-${j.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setDetailJobId(j.id)}
                        className={`hotlist-job-title font-semibold text-gray-700 truncate text-left transition-[color,text-shadow] cursor-pointer focus:outline-none focus-visible:[color:var(--brand-primary)] ${isRemoved ? "line-through" : ""}`}
                        data-testid={`link-job-title-${j.id}`}
                        title={j.description ?? j.title}
                      >
                        {j.title}
                      </button>
                      {j.partnerLogoUrl ? (
                        <img
                          src={j.partnerLogoUrl}
                          alt={j.partnerName ?? "Partner"}
                          className="h-[23px] w-auto max-w-[110px] object-contain shrink-0"
                          data-testid={`img-partner-logo-${j.id}`}
                        />
                      ) : (
                        j.partnerName && <span className="text-xs text-muted-foreground">· {j.partnerName}</span>
                      )}
                      {isRemoved && <Badge variant="outline" className="text-xs border-red-300 text-red-700">Removed</Badge>}
                      <HotlistJobMetaBadges
                        job={j}
                        onOpenComments={(e) => {
                          e.stopPropagation();
                          setDetailJobId(j.id);
                          setDetailScrollToComments(true);
                        }}
                      />
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-1">
                      <span className="flex items-start gap-1"><MapPin {...hotlistSubcardMetaIconProps} />{j.locationAddress}</span>
                      {j.deadline && <span className="flex items-start gap-1"><Calendar {...hotlistSubcardMetaIconProps} />{j.deadline}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <HotlistStatusPill status={j.status} />
                    {isRemoved ? (
                      <PngPillButton
                        color="blue"
                        onClick={() => restoreJob.mutate(j.id)}
                        disabled={restoreJob.isPending}
                        data-testid={`button-restore-job-${j.id}`}
                      >
                        <Undo2 className="w-4 h-4" />Restore
                      </PngPillButton>
                    ) : (
                      <RemovePill
                        onClick={() => setConfirmRemoveId(j.id)}
                        data-testid={`button-remove-job-${j.id}`}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog
        open={detailJobId != null}
        onOpenChange={(open) => {
          if (!open) {
            setDetailJobId(null);
            setDetailScrollToComments(false);
          }
        }}
      >
        <DialogContent data-testid="dialog-job-particulars" className="max-h-[90vh] overflow-y-auto">
          {(() => {
            const j = detailJobId != null ? jobs.find((x) => x.id === detailJobId) ?? null : null;
            if (!j) return null;
            return (
              <>
                {j.partnerLogoUrl && (
                  <div className="flex justify-center pb-2">
                    <img
                      src={j.partnerLogoUrl}
                      alt={j.partnerName ?? "Partner"}
                      className="h-12 w-auto max-w-[200px] object-contain"
                      data-testid="img-dialog-partner-logo"
                    />
                  </div>
                )}
                <DialogHeader>
                  <DialogTitle style={{ color: "var(--brand-primary)" }}>{j.title}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 text-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <HotlistStatusPill status={j.status} />
                    {j.deletedAt && <Badge variant="outline" className="text-xs border-red-300 text-red-700">Removed</Badge>}
                    <HotlistJobMetaBadges
                      job={j}
                      onOpenComments={(e) => {
                        e.stopPropagation();
                        scrollToHotlistComments(j.id);
                      }}
                    />
                  </div>
                  {j.partnerName && (
                    <div><span className="font-semibold text-gray-700">Partner:</span> <span className="text-gray-900">{j.partnerName}</span></div>
                  )}
                  <div><span className="font-semibold text-gray-700">Location:</span> <span className="text-gray-900">{j.locationAddress}</span></div>
                  {j.deadline && (
                    <div><span className="font-semibold text-gray-700">Deadline:</span> <span className="text-gray-900">{j.deadline}</span></div>
                  )}
                  {j.estimatedDurationDays != null && (
                    <div><span className="font-semibold text-gray-700">Est. Duration:</span> <span className="text-gray-900">{j.estimatedDurationDays} day{j.estimatedDurationDays === 1 ? "" : "s"}</span></div>
                  )}
                  <div>
                    <div className="font-semibold text-gray-700 mb-1">Description</div>
                    <div className="text-gray-900 whitespace-pre-wrap rounded-md border bg-muted/30 p-3 min-h-[80px]" data-testid="text-job-description">
                      {j.description?.trim() ? j.description : <span className="text-muted-foreground italic">No description provided.</span>}
                    </div>
                  </div>
                  <HotlistCommentsSection jobId={j.id} />
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmRemoveId != null} onOpenChange={(open) => { if (!open) setConfirmRemoveId(null); }}>
        <AlertDialogContent data-testid="dialog-confirm-remove-job">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {jobPendingRemoval ? <>Remove "{jobPendingRemoval.title}"?</> : <>Remove job from Hotlist?</>}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you wish to remove the job from the HotList
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="px-6 -mt-2 text-xs text-gray-500">
            You can restore it later by enabling "Show removed jobs".
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-remove-job">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (confirmRemoveId != null) removeJob.mutate(confirmRemoveId); }}
              disabled={removeJob.isPending}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              data-testid="button-confirm-remove-job"
            >
              {removeJob.isPending ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
