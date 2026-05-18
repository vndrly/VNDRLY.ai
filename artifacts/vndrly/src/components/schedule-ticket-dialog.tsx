import { TogglePillButton } from "@/components/toggle-pill";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { PillButton } from "@/components/pill";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import GreenButton from "@/components/green-button";
import GreyButton from "@/components/grey-button";
import { getGetTicketQueryKey } from "@workspace/api-client-react";
import { TICKET_STATE_CONFLICT_CODES } from "@workspace/ticket-state-conflict-codes";
import {
  CREW_INVALID_FOR_VENDOR,
  CREW_VALIDATION_CODES,
  FOREMAN_NOT_IN_CREW,
} from "@workspace/crew-validation-codes";
import { formatTicketTrackingNumber } from "@workspace/db/format";
import { useQueryClient } from "@tanstack/react-query";
import {
  useEligibleVendorFieldEmployeesByVendorId,
  useClearStaleFieldEmployeeSelection,
} from "@/hooks/use-eligible-vendor-field-employees";
import { CalendarClock, Users, UserCog, Bell, AlertTriangle, ShieldAlert, Cloud, ExternalLink, MapPin, Briefcase, Clock } from "lucide-react";
import { translateApiError } from "@/lib/api-error";

type CertWarning = { employeeId: number; employeeName: string; missing: string[] };
// Task #650: amber tier returned by POST /tickets/:id/schedule when a
// crew member's required cert is still valid today but expires within
// the configurable window after `scheduledStartAt`.
type CertExpiringSoon = {
  employeeId: number;
  employeeName: string;
  expiring: Array<{ name: string; expirationDate: string; daysUntilExpiration: number }>;
};
type Conflict = {
  employeeId: number; employeeName: string; otherTicketId: number;
  otherWorkType: string | null; otherSiteName: string | null;
  otherStartAt: string; otherDurationMinutes: number | null;
};
// Task #651: payload shape returned by POST /tickets/:id/schedule when
// the work type carries `blocking_certifications` and a crew member is
// missing one. `canOverride` is true only for platform admins; the
// modal uses it to decide whether to render the "Override and schedule"
// button. Non-admin sessions get the same 400 but with `canOverride:
// false`, so the only path forward for them is to swap crew.
type CertBlock = {
  blockingCertifications: string[];
  blockingMissing: CertWarning[];
  canOverride: boolean;
};
type WeatherSnapshot = {
  siteName: string; time: string | null;
  temperatureF: number | null; precipitationProbability: number | null;
  windMph: number | null; weatherCode: number | null;
};

type ScheduleSnapshot = {
  scheduledStartAt: string | null;
  scheduledDurationMinutes: number | null;
  foremanUserId: number | null;
  crew: Array<{ employeeId: number; userId: number | null; name: string }>;
  warningKinds: string[];
};

type FE = { id: number; vendorId: number; firstName: string; lastName: string; userId?: number | null; isActive?: boolean };

const KIND_OPTIONS: Array<{ kind: "1d" | "4h" | "1h" | "start"; labelKey: string }> = [
  { kind: "1d", labelKey: "scheduleTicket.warning1d" },
  { kind: "4h", labelKey: "scheduleTicket.warning4h" },
  { kind: "1h", labelKey: "scheduleTicket.warning1h" },
  { kind: "start", labelKey: "scheduleTicket.warningStart" },
];

const DEFAULT_KINDS = ["1d", "1h", "start"];

// Ticket-state-conflict codes the API may emit when the underlying ticket
// has moved on between when this dialog opened and when Save was tapped
// (someone else accepted/denied/cancelled, the lifecycle changed, etc.).
// All of these collapse into the same "refresh and try again" UX rather
// than being pinned under a specific input.
//
// Task #870: source of truth is the shared workspace lib
// `@workspace/ticket-state-conflict-codes`, which the api-server route
// emit sites also import from (and which is mirrored in the OpenAPI
// spec). Importing the constant array here means a server rename
// propagates through `pnpm run typecheck` to this dialog as well — no
// hand-maintained mirror to drift out of sync.
const STATE_CONFLICT_CODES: ReadonlySet<string> = new Set<string>([
  ...TICKET_STATE_CONFLICT_CODES,
  // Mirrors the mobile `apiErrors.ts` extra set: codes that aren't in
  // the canonical 409 contract but should still trigger the same
  // "refresh and try again" UX rather than pinning a stale message
  // under a control that may have just disappeared.
  "ticket.en_route_invalid_state",
  "ticket_not_in_progress",
]);

// Task #881: every membership-class code re-routes to the crew section
// (the web's stand-in for the mobile crew picker) — even codes returned
// from a non-crew control, since the operator's only path forward is to
// fix the crew/foreman pick. Sourced from the shared
// `@workspace/crew-validation-codes` lib so a server rename propagates
// here through `pnpm run typecheck`.
const CREW_PICKER_CODES: ReadonlySet<string> = new Set<string>(
  CREW_VALIDATION_CODES,
);

function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // datetime-local needs YYYY-MM-DDTHH:mm in local time without timezone
  const tzOff = d.getTimezoneOffset();
  const local = new Date(d.getTime() - tzOff * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function ScheduleTicketDialog({
  open,
  onOpenChange,
  ticketId,
  vendorId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ticketId: number;
  vendorId: number;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();

  // Task #523 (supersedes the inline filter Task #519 added here): source
  // the eligible roster through the by-vendorId variant of the shared hook.
  // It applies the same active-vendor + isActive defense Task #515 first
  // added inline, but pinned to the ticket's vendorId so it works for the
  // admin/partner/field_employee sessions that open this dialog from
  // ticket-detail.tsx — the auth-derived variant short-circuits to an empty
  // list for non-vendor sessions, and even for vendor sessions the ticket
  // may belong to a different vendor than the operator's active membership.
  // `fieldEmployees` is the raw list, kept for the cleanup effects' "still
  // loading?" guard.
  const { eligibleForemen, fieldEmployees } =
    useEligibleVendorFieldEmployeesByVendorId(vendorId);
  const employees = eligibleForemen as unknown as FE[];

  const [startInput, setStartInput] = useState("");
  const [durationMinutes, setDurationMinutes] = useState<string>("");
  const [crewIds, setCrewIds] = useState<number[]>([]);
  const [foremanUserId, setForemanUserId] = useState<string>("");
  const [warningKinds, setWarningKinds] = useState<string[]>(DEFAULT_KINDS);
  const [submitting, setSubmitting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [requiredCerts, setRequiredCerts] = useState<string[]>([]);
  // Per-crew cert cache. Stores the full {name, expirationDate} pairs
  // (rather than the previous valid-name-only string[]) so the modal can
  // derive both `inlineCertWarnings` (missing/expired) and the new
  // `inlineCertExpiringSoon` (Task #650: expires within the window after
  // `scheduledStartAt`) from a single source. Keyed by employeeId.
  const [empCerts, setEmpCerts] = useState<
    Record<number, Array<{ name: string; expirationDate: string | null }>>
  >({});
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [siteId, setSiteId] = useState<number | null>(null);
  // Task #527: inline error tied to a specific input. Cleared on each
  // attempt so old errors don't linger after the user fixes them.
  const [fieldError, setFieldError] = useState<{
    field: "start" | "duration" | "crew" | "foreman" | "general";
    message: string;
  } | null>(null);
  // Task #647: rich double-booking confirmation. When the API responds
  // with `requiresConfirm`, store the conflicts here so the secondary
  // AlertDialog can render each clash with employee, work type, site,
  // start time, duration, and a link to the conflicting ticket. Replaces
  // the old `window.confirm` text dump that only showed bare strings.
  const [pendingConflicts, setPendingConflicts] = useState<Conflict[] | null>(null);
  // Task #651: structured blocking-cert error from the server. Pinned
  // here (rather than collapsed into `fieldError`) so the modal can
  // render a per-employee list inline above Save and offer the
  // admin-only override button. Cleared on every Save attempt and
  // whenever the dialog closes.
  const [certBlock, setCertBlock] = useState<CertBlock | null>(null);

  // Load existing schedule on open + ticket details (workType + site for cert + weather lookups).
  useEffect(() => {
    if (!open) { setLoaded(false); setRequiredCerts([]); setEmpCerts({}); setWeather(null); setSiteId(null); setPendingConflicts(null); setCertBlock(null); setFieldError(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const [scheduleRes, ticketRes] = await Promise.all([
          fetch(`/api/tickets/${ticketId}/schedule`, { credentials: "include" }),
          fetch(`/api/tickets/${ticketId}`, { credentials: "include" }),
        ]);
        const j: ScheduleSnapshot = scheduleRes.ok ? await scheduleRes.json() : { scheduledStartAt: null, scheduledDurationMinutes: null, foremanUserId: null, crew: [], warningKinds: [] };
        if (cancelled) return;
        setStartInput(toLocalInputValue(j.scheduledStartAt));
        setDurationMinutes(j.scheduledDurationMinutes != null ? String(j.scheduledDurationMinutes) : "");
        setCrewIds(j.crew.map(c => c.employeeId));
        setForemanUserId(j.foremanUserId != null ? String(j.foremanUserId) : "");
        setWarningKinds(j.warningKinds.length > 0 ? j.warningKinds : DEFAULT_KINDS);

        if (ticketRes.ok) {
          const ticket: any = await ticketRes.json();
          if (cancelled) return;
          setSiteId(ticket.siteLocationId ?? null);
          if (ticket.workTypeId) {
            try {
              const certR = await fetch(`/api/work-types/${ticket.workTypeId}/required-certifications`, { credentials: "include" });
              if (certR.ok) {
                const cj = await certR.json();
                if (!cancelled) setRequiredCerts(Array.isArray(cj.requiredCertifications) ? cj.requiredCertifications : []);
              }
            } catch { /* non-fatal */ }
          }
        }
      } catch {
        // Leave defaults
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [open, ticketId]);

  // Lazily fetch each crew member's certifications when first selected.
  // Cache stores the full cert {name, expirationDate} pairs so both the
  // missing/expired tier and the Task #650 expiring-soon tier can be
  // derived locally without re-fetching when the user adjusts the
  // scheduled start time.
  useEffect(() => {
    if (!open || requiredCerts.length === 0) return;
    const missingIds = crewIds.filter(id => empCerts[id] === undefined);
    if (missingIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(missingIds.map(async (id) => {
        try {
          const r = await fetch(`/api/field-employees/${id}/certifications`, { credentials: "include" });
          if (!r.ok) return [id, [] as Array<{ name: string; expirationDate: string | null }>] as const;
          const list: any[] = await r.json();
          const certs = list.map((c) => ({
            name: String(c.name ?? ""),
            expirationDate:
              typeof c.expirationDate === "string" && c.expirationDate
                ? c.expirationDate
                : null,
          }));
          return [id, certs] as const;
        } catch {
          return [id, [] as Array<{ name: string; expirationDate: string | null }>] as const;
        }
      }));
      if (cancelled) return;
      setEmpCerts((prev) => {
        const next = { ...prev };
        for (const [id, certs] of results) next[id] = certs;
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [open, crewIds, requiredCerts, empCerts]);

  // Weather lookup whenever start time + site are known.
  useEffect(() => {
    if (!open || !siteId || !startInput) { setWeather(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const at = new Date(startInput).toISOString();
        const r = await fetch(`/api/sites/${siteId}/weather?at=${encodeURIComponent(at)}`, { credentials: "include" });
        if (!r.ok) return;
        const j: WeatherSnapshot = await r.json();
        if (!cancelled) setWeather(j);
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [open, siteId, startInput]);

  // Task #519 / #515: drop stale crew picks once an employee leaves the
  // eligible set (vendor membership switch, soft-delete, deactivation since
  // this dialog was opened). Mirrors the spirit of the shared
  // `useClearStaleFieldEmployeeSelection` helper, applied across the array
  // because crewIds is multi-select. Task #523 considered routing this
  // through the shared helper too, but the helper is single-select; we keep
  // the inline filter and just source the eligible set from the shared hook
  // above. The foreman dropdown sources from `crewWithUsers` (derived from
  // crewIds), so a foreman whose crew member just got dropped is also
  // nulled out below — keeping the form from POSTing an id the server's
  // Task #507 tenancy guard would 400 on. Gated on `open && loaded` so we
  // don't filter before the saved schedule snapshot has hydrated crewIds.
  useEffect(() => {
    if (!open || !loaded) return;
    if (!fieldEmployees) return; // wait for the list before deciding
    if (crewIds.length === 0) return;
    const eligibleIds = new Set(employees.map(e => e.id));
    const filtered = crewIds.filter(id => eligibleIds.has(id));
    if (filtered.length !== crewIds.length) setCrewIds(filtered);
  }, [open, loaded, employees, fieldEmployees, crewIds]);

  // Derive crewWithUsers from the api-typed eligibleForemen so it can be
  // passed straight to the shared cleanup helper without a re-cast. Same
  // entries as the FE-typed `employees` view above.
  const crewWithUsers = eligibleForemen.filter(e => crewIds.includes(e.id) && e.userId != null);

  // Task #519 / #523: companion cleanup for the foreman pick. The dropdown
  // options are sourced from `crewWithUsers`, so a foreman who's no longer
  // in the crew (or whose backing employee left the eligible set) must be
  // cleared. The schedule API expects a userId, not an employeeId, so we
  // route through the shared helper with a custom getId that maps each
  // crew-with-user entry to its String(userId). Gated on `open && loaded`
  // so we don't clear before the saved schedule snapshot has hydrated.
  useClearStaleFieldEmployeeSelection({
    selectedId: open && loaded ? foremanUserId : "",
    eligibleForemen: crewWithUsers,
    fieldEmployees,
    onClear: () => setForemanUserId(""),
    getId: (fe) => (fe.userId != null ? String(fe.userId) : null),
  });

  // Per-crew missing/expired certs computed locally for inline display.
  // Mirrors the server's `certWarnings` semantics: a required cert is
  // missing if no row exists for it OR every row's expirationDate is
  // already in the past today.
  const inlineCertWarnings = useMemo<Record<number, string[]>>(() => {
    if (requiredCerts.length === 0) return {};
    const out: Record<number, string[]> = {};
    const today = new Date();
    for (const id of crewIds) {
      const certs = empCerts[id] ?? [];
      const valid = new Set<string>();
      for (const c of certs) {
        if (c.expirationDate && new Date(c.expirationDate) < today) continue;
        valid.add(c.name);
      }
      const miss = requiredCerts.filter(req => !valid.has(req));
      if (miss.length > 0) out[id] = miss;
    }
    return out;
  }, [crewIds, empCerts, requiredCerts]);

  // Task #650: per-crew "expiring soon" certs — required certs that are
  // currently valid (NOT in the missing list above) but whose
  // expirationDate falls inside the 30-day window after the picked
  // `startInput`. Mirrors the server-side logic so the modal can render
  // the amber heads-up as soon as the start time is set, before the
  // operator hits Save. Disjoint from `inlineCertWarnings` per cert
  // (missing dominates expiring-soon) so the same cert never lights up
  // both colors at once. The window matches the API default; if an org
  // overrides `CERT_EXPIRING_SOON_DAYS`, the amber on this preview may
  // briefly disagree with the server until Save, but the toast surfaces
  // the authoritative server list.
  const EXPIRING_SOON_WINDOW_DAYS = 30;
  const inlineCertExpiringSoon = useMemo<
    Record<number, Array<{ name: string; daysUntilExpiration: number }>>
  >(() => {
    if (requiredCerts.length === 0 || !startInput) return {};
    const start = new Date(startInput);
    if (Number.isNaN(start.getTime())) return {};
    const today = new Date();
    const windowEnd = new Date(
      start.getTime() + EXPIRING_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const out: Record<number, Array<{ name: string; daysUntilExpiration: number }>> = {};
    for (const id of crewIds) {
      const certs = empCerts[id] ?? [];
      // Build the "soonest valid expiration per required cert" map first,
      // matching the server's `expByEmp` shape so duplicate/renewed copies
      // collapse to the most-urgent date.
      const soonest = new Map<string, Date>();
      for (const c of certs) {
        if (!requiredCerts.includes(c.name)) continue;
        if (!c.expirationDate) continue;
        const exp = new Date(c.expirationDate);
        if (Number.isNaN(exp.getTime())) continue;
        if (exp < today) continue; // already expired → handled by missing tier
        const prior = soonest.get(c.name);
        if (!prior || exp < prior) soonest.set(c.name, exp);
      }
      const expiring: Array<{ name: string; daysUntilExpiration: number }> = [];
      const missingForEmp = inlineCertWarnings[id] ?? [];
      const missingSet = new Set(missingForEmp);
      for (const req of requiredCerts) {
        if (missingSet.has(req)) continue; // missing dominates
        const exp = soonest.get(req);
        if (!exp) continue;
        if (exp <= windowEnd) {
          const daysUntilExpiration = Math.ceil(
            (exp.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
          );
          expiring.push({ name: req, daysUntilExpiration });
        }
      }
      if (expiring.length > 0) out[id] = expiring;
    }
    return out;
  }, [crewIds, empCerts, requiredCerts, startInput, inlineCertWarnings]);

  function toggleEmployee(id: number) {
    setCrewIds((prev) => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }
  function toggleKind(k: string) {
    setWarningKinds((prev) => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]);
  }

  // postSchedule now surfaces the structured error code from the API
  // (Task #527: scheduled_start_at_required, crew_invalid_for_vendor,
  // foreman_not_in_crew, forbidden_not_scheduler, ticket_not_found, etc.)
  // along with the human-readable message, so the caller can pick the
  // right inline field error for the offending input.
  async function postSchedule(opts: { force: boolean; overrideBlockingCerts?: boolean }): Promise<{
    ok: boolean;
    conflicts?: Conflict[];
    certWarnings?: CertWarning[];
    certExpiringSoon?: CertExpiringSoon[];
    certBlock?: CertBlock;
    errorCode?: string;
    errorMessage?: string;
  }> {
    const r = await fetch(`/api/tickets/${ticketId}/schedule`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scheduledStartAt: new Date(startInput).toISOString(),
        scheduledDurationMinutes: durationMinutes ? Number(durationMinutes) : null,
        foremanUserId: foremanUserId ? Number(foremanUserId) : null,
        crewEmployeeIds: crewIds,
        warningKinds,
        force: opts.force,
        // Only include the override flag when the caller explicitly
        // confirmed the blocking dialog. Sending it on a normal save
        // would silently bypass the new check on every retry.
        ...(opts.overrideBlockingCerts ? { overrideBlockingCerts: true } : {}),
      }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      // Task #651: blocking-cert errors return a structured payload the
      // dialog turns into an inline crew-section banner instead of a
      // generic "Couldn't save schedule" toast.
      if (typeof j?.error === "string" && j.error === "certifications_blocked") {
        return {
          ok: false,
          certBlock: {
            blockingCertifications: Array.isArray(j.blockingCertifications) ? j.blockingCertifications : [],
            blockingMissing: Array.isArray(j.blockingMissing) ? j.blockingMissing : [],
            canOverride: j.canOverride === true,
          },
          errorCode: j.error,
        };
      }
      return {
        ok: false,
        errorCode: typeof j?.error === "string" ? j.error : undefined,
        errorMessage: typeof j?.message === "string"
          ? j.message
          : (typeof j?.error === "string" ? j.error : "Failed"),
      };
    }
    if (j.requiresConfirm) return { ok: false, conflicts: j.conflicts ?? [] };
    return {
      ok: true,
      certWarnings: j.certWarnings ?? [],
      certExpiringSoon: j.certExpiringSoon ?? [],
    };
  }

  // Map a code from postSchedule into a localized inline error keyed off
  // the offending field. Returning a flat shape (instead of mutating per
  // input) keeps the dialog's existing render path simple.
  //
  // Ticket-state-conflict codes (the underlying ticket moved on between
  // when this dialog was opened and when Save was tapped) all collapse
  // into the same "general" branch so the message says "refresh and try
  // again" instead of pinning under a specific input.
  function inlineErrorFor(code: string | undefined): {
    field: "start" | "duration" | "crew" | "foreman" | "general";
    message: string;
  } {
    const translated = code
      ? (() => {
          const k = `errors.${code}`;
          const out = t(k);
          return out !== k ? out : null;
        })()
      : null;
    if (code && STATE_CONFLICT_CODES.has(code)) {
      return { field: "general", message: translated ?? t("scheduleTicket.saveFailed") };
    }
    // Task #881: every membership-class code re-routes to the crew
    // section, even when surfaced from a non-crew control. Mirrors the
    // mobile `inlineErrorForTicketAction()` re-routing to `crew_picker`.
    if (code && CREW_PICKER_CODES.has(code)) {
      // FOREMAN_NOT_IN_CREW lives semantically on the foreman dropdown
      // (the operator's actual control for picking the foreman), so we
      // pin it there rather than under the crew checkbox list. Every
      // other membership code routes to the crew section.
      const field = code === FOREMAN_NOT_IN_CREW ? "foreman" : "crew";
      return { field, message: translated ?? t("scheduleTicket.saveFailed") };
    }
    switch (code) {
      case "scheduled_start_at_required":
        return { field: "start", message: translated ?? t("scheduleTicket.startRequired") };
      case "invalid_scheduled_duration_minutes":
        return { field: "duration", message: translated ?? t("scheduleTicket.saveFailed") };
      case CREW_INVALID_FOR_VENDOR:
        return { field: "crew", message: translated ?? t("scheduleTicket.saveFailed") };
      case FOREMAN_NOT_IN_CREW:
        return { field: "foreman", message: translated ?? t("scheduleTicket.saveFailed") };
      default:
        return { field: "general", message: translated ?? t("scheduleTicket.saveFailed") };
    }
  }

  // Apply the post-success / post-error tail of a postSchedule call.
  // Extracted so both the initial Save click and the "schedule anyway"
  // confirmation path (Task #647) can share the same toast + cache
  // invalidation logic without duplication.
  function applyResult(result: Awaited<ReturnType<typeof postSchedule>>): boolean {
    if (!result.ok) {
      const inline = inlineErrorFor(result.errorCode);
      setFieldError(inline);
      // Task #881: the inline banner under the offending control is the
      // entire UX for these failures — the destructive toast that used
      // to also fire was redundant noise and (worse) duplicated the
      // message in two places. Mirrors the mobile mirror's "no
      // Alert.alert from these paths" contract.
      return false;
    }
    const certMsg = result.certWarnings && result.certWarnings.length > 0
      ? result.certWarnings.map(cw => `${cw.employeeName}: ${cw.missing.join(", ")}`).join("\n")
      : null;
    // Task #650: also append the amber expiring-soon list so leads see
    // who's about to lapse even though the schedule saved fine. Includes
    // the soonest cert per crew member so the toast stays glance-able.
    // Each line is "Name: H2S (in 5 days)". Lives in `applyResult` so
    // both the initial save and the Task #647 force-override path show
    // the same warnings.
    const expiringMsg = result.certExpiringSoon && result.certExpiringSoon.length > 0
      ? result.certExpiringSoon.map(cw => {
          const parts = cw.expiring.map(e =>
            t("scheduleTicket.expiringCertEntry", { cert: e.name, days: e.daysUntilExpiration }),
          ).join(", ");
          return `${cw.employeeName}: ${parts}`;
        }).join("\n")
      : null;
    const sections: string[] = [t("scheduleTicket.savedBody")];
    if (certMsg) sections.push(`${t("scheduleTicket.certWarningHeader")}\n${certMsg}`);
    if (expiringMsg) sections.push(`${t("scheduleTicket.certExpiringSoonHeader")}\n${expiringMsg}`);
    toast({
      title: t("scheduleTicket.savedTitle"),
      description: sections.join("\n"),
    });
    qc.invalidateQueries({ queryKey: getGetTicketQueryKey(ticketId) });
    onOpenChange(false);
    return true;
  }

  // Task #651: Wrapper used by both the normal Save button and the
  // admin-only "Override and schedule" button rendered when the server
  // returns a blocking-cert error. Centralizes conflict handling so
  // the override path stays identical to the normal path apart from
  // the `overrideBlockingCerts` flag.
  async function attemptSave(overrideBlockingCerts: boolean) {
    if (!startInput) {
      setFieldError({ field: "start", message: t("scheduleTicket.startRequired") });
      toast({ title: t("scheduleTicket.startRequired"), variant: "destructive" });
      return;
    }
    setFieldError(null);
    setCertBlock(null);
    setSubmitting(true);
    try {
      const result = await postSchedule({ force: false, overrideBlockingCerts });
      // Task #647: when the API reports double-bookings, hand off to the
      // rich confirmation dialog (rendered below) instead of the old
      // window.confirm. The dialog will call confirmOverride() if the
      // dispatcher decides to proceed.
      if (!result.ok && result.conflicts && result.conflicts.length > 0) {
        setPendingConflicts(result.conflicts);
        setSubmitting(false);
        return;
      }
      // Task #651: blocking-cert error → render the per-employee list
      // inline (with the admin-only override button if allowed) rather
      // than collapsing into the generic toast.
      if (!result.ok && result.certBlock) {
        setCertBlock(result.certBlock);
        return;
      }
      // Task #881: state-conflict codes mean the underlying ticket has
      // moved on between when this dialog opened and when Save was
      // tapped — pinning a stale message under a control that may have
      // just disappeared is worse than no message at all. Mirrors the
      // mobile mirror's silent-refresh path: clear any prior pin,
      // invalidate the ticket query so the parent screen re-renders
      // against fresh state, and bail without firing a toast.
      if (
        !result.ok &&
        result.errorCode &&
        STATE_CONFLICT_CODES.has(result.errorCode)
      ) {
        setFieldError(null);
        qc.invalidateQueries({ queryKey: getGetTicketQueryKey(ticketId) });
        return;
      }
      applyResult(result);
    } catch (e: unknown) {
      toast({ title: t("scheduleTicket.saveFailed"), description: translateApiError(e, t), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  // Task #647: invoked when the dispatcher accepts the override in the
  // rich conflict dialog. Re-posts with force=true and reuses the shared
  // applyResult tail. Note: this is the double-booking override; the
  // cert-block override is a separate path via attemptSave(true).
  async function confirmOverride() {
    setPendingConflicts(null);
    setSubmitting(true);
    try {
      const result = await postSchedule({ force: true, overrideBlockingCerts: false });
      applyResult(result);
    } catch (e: unknown) {
      toast({ title: t("scheduleTicket.saveFailed"), description: translateApiError(e, t), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  // Format a duration in minutes into a short human-readable string used
  // inside the conflict dialog ("45 min", "1h", "2h 30m"). Returns a
  // localized fallback when the conflicting ticket doesn't have a
  // duration set.
  function formatDuration(min: number | null): string {
    if (min == null || !Number.isFinite(min) || min <= 0) {
      return t("scheduleTicket.conflictDurationUnknown");
    }
    if (min < 60) return t("scheduleTicket.conflictDurationMin", { min });
    const h = Math.floor(min / 60);
    const rem = min % 60;
    if (rem === 0) return t("scheduleTicket.conflictDurationHr", { h });
    return t("scheduleTicket.conflictDurationHrMin", { h, min: rem });
  }

  // Task #651: default Save button → no override flag. The override
  // path is surfaced separately as a second button under the blocking-
  // cert banner, gated on `certBlock.canOverride` (server-side: role
  // admin).
  function handleSave() {
    void attemptSave(false);
  }
  function handleOverrideAndSave() {
    void attemptSave(true);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-amber-500" />
            {t("scheduleTicket.title")}
          </DialogTitle>
        </DialogHeader>

        {!loaded ? (
          <div className="py-8 text-center text-sm text-muted-foreground">{t("scheduleTicket.loading")}</div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground">{t("scheduleTicket.whenLabel")}</label>
              <Input
                type="datetime-local"
                value={startInput}
                onChange={(e) => { setStartInput(e.target.value); if (fieldError?.field === "start") setFieldError(null); }}
                data-testid="input-schedule-start"
                aria-invalid={fieldError?.field === "start" || undefined}
              />
              {fieldError?.field === "start" && (
                <div className="text-[11px] text-red-600 mt-1" data-testid="error-schedule-start">
                  {fieldError.message}
                </div>
              )}
            </div>

            <div>
              <label className="text-xs text-muted-foreground">{t("scheduleTicket.durationLabel")}</label>
              <Input
                type="number"
                min="0"
                step="15"
                value={durationMinutes}
                onChange={(e) => { setDurationMinutes(e.target.value); if (fieldError?.field === "duration") setFieldError(null); }}
                placeholder={t("scheduleTicket.durationPlaceholder")}
                data-testid="input-schedule-duration"
                aria-invalid={fieldError?.field === "duration" || undefined}
              />
              {fieldError?.field === "duration" && (
                <div className="text-[11px] text-red-600 mt-1" data-testid="error-schedule-duration">
                  {fieldError.message}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <Users className="w-4 h-4 text-amber-500" />
                <label className="text-xs text-muted-foreground">{t("scheduleTicket.crewLabel")}</label>
              </div>
              <div className="border rounded-md max-h-44 overflow-y-auto p-2 space-y-1">
                {employees.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-2 text-center">{t("scheduleTicket.noEmployees")}</div>
                ) : employees.map((e) => {
                  const missing = inlineCertWarnings[e.id];
                  // Task #650: amber heads-up — certs that are still
                  // valid today but lapse inside the configurable window
                  // after the picked start time. Rendered alongside (and
                  // visually distinct from) the red missing/expired
                  // banner above.
                  const expiringSoon = inlineCertExpiringSoon[e.id];
                  return (
                    <div key={e.id}>
                      <label className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted px-1 py-0.5 rounded">
                        <input
                          type="checkbox"
                          checked={crewIds.includes(e.id)}
                          onChange={() => toggleEmployee(e.id)}
                          data-testid={`checkbox-crew-${e.id}`}
                        />
                        <span>{e.firstName} {e.lastName}</span>
                        {e.userId == null && (
                          <span className="text-[10px] text-amber-600 ml-auto">{t("scheduleTicket.noLogin")}</span>
                        )}
                      </label>
                      {missing && missing.length > 0 && crewIds.includes(e.id) && (
                        <div
                          className="ml-6 mt-0.5 mb-1 flex items-start gap-1 text-[11px] text-red-600"
                          data-testid={`cert-warning-${e.id}`}
                        >
                          <ShieldAlert className="w-3 h-3 mt-px shrink-0" />
                          <span>{t("scheduleTicket.missingCerts", { certs: missing.join(", ") })}</span>
                        </div>
                      )}
                      {expiringSoon && expiringSoon.length > 0 && crewIds.includes(e.id) && (
                        <div
                          className="ml-6 mt-0.5 mb-1 flex items-start gap-1 text-[11px] text-amber-600"
                          data-testid={`cert-expiring-soon-${e.id}`}
                        >
                          <Clock className="w-3 h-3 mt-px shrink-0" />
                          <span>
                            {t("scheduleTicket.expiringCerts", {
                              certs: expiringSoon
                                .map((c) =>
                                  t("scheduleTicket.expiringCertEntry", {
                                    cert: c.name,
                                    days: c.daysUntilExpiration,
                                  }),
                                )
                                .join(", "),
                            })}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {fieldError?.field === "crew" && (
                <div className="text-[11px] text-red-600 mt-1" data-testid="error-schedule-crew">
                  {fieldError.message}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <UserCog className="w-4 h-4 text-amber-500" />
                <label className="text-xs text-muted-foreground">{t("scheduleTicket.foremanLabel")}</label>
              </div>
              <Select
                value={foremanUserId || "none"}
                onValueChange={(v) => {
                  setForemanUserId(v === "none" ? "" : v);
                  if (fieldError?.field === "foreman") setFieldError(null);
                }}
              >
                <SelectTrigger data-testid="select-foreman" aria-invalid={fieldError?.field === "foreman" || undefined}><SelectValue placeholder={t("scheduleTicket.foremanPlaceholder")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("scheduleTicket.noForeman")}</SelectItem>
                  {crewWithUsers.map((e) => (
                    <SelectItem key={e.userId!} value={String(e.userId)}>{e.firstName} {e.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {crewWithUsers.length === 0 && crewIds.length > 0 && (
                <div className="text-[11px] text-amber-600 mt-1">{t("scheduleTicket.foremanNeedsLogin")}</div>
              )}
              {fieldError?.field === "foreman" && (
                <div className="text-[11px] text-red-600 mt-1" data-testid="error-schedule-foreman">
                  {fieldError.message}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <Bell className="w-4 h-4 text-amber-500" />
                <label className="text-xs text-muted-foreground">{t("scheduleTicket.warningsLabel")}</label>
              </div>
              <div className="grid grid-cols-2 gap-1">
                {KIND_OPTIONS.map(opt => (
                  <label key={opt.kind} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted px-1 py-0.5 rounded">
                    <input
                      type="checkbox"
                      checked={warningKinds.includes(opt.kind)}
                      onChange={() => toggleKind(opt.kind)}
                      data-testid={`checkbox-warning-${opt.kind}`}
                    />
                    <span>{t(opt.labelKey)}</span>
                  </label>
                ))}
              </div>
            </div>

            {weather && weather.time && (
              <div
                className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 flex items-start gap-2"
                data-testid="weather-card"
              >
                <Cloud className="w-4 h-4 text-sky-600 mt-0.5" />
                <div className="text-xs text-sky-900 leading-snug">
                  <div className="font-medium">{t("scheduleTicket.weatherTitle", { site: weather.siteName })}</div>
                  <div>
                    {weather.temperatureF != null && (<span>{Math.round(weather.temperatureF)}°F · </span>)}
                    {weather.windMph != null && (<span>{Math.round(weather.windMph)} mph wind · </span>)}
                    {weather.precipitationProbability != null && (<span>{weather.precipitationProbability}% precip</span>)}
                  </div>
                </div>
              </div>
            )}

            {certBlock && certBlock.blockingMissing.length > 0 && (
              <div
                className="rounded-md border border-red-300 bg-red-50 px-3 py-2 space-y-1"
                data-testid="cert-block-banner"
                role="alert"
              >
                <div className="flex items-center gap-2 text-sm font-medium text-red-800">
                  <AlertTriangle className="w-4 h-4" />
                  <span>{t("scheduleTicket.blockingCertHeader")}</span>
                </div>
                <ul className="text-xs text-red-800 list-disc pl-5">
                  {certBlock.blockingMissing.map((b) => (
                    <li key={b.employeeId} data-testid={`cert-block-row-${b.employeeId}`}>
                      <span className="font-medium">{b.employeeName}</span>: {b.missing.join(", ")}
                    </li>
                  ))}
                </ul>
                <div className="text-xs text-red-700 pt-1">
                  {certBlock.canOverride
                    ? t("scheduleTicket.blockingCertCanOverride")
                    : t("scheduleTicket.blockingCertNoOverride")}
                </div>
              </div>
            )}

            {fieldError?.field === "general" && (
              <div
                className="text-[11px] text-red-600 mt-1"
                data-testid="error-schedule-general"
                role="alert"
              >
                {fieldError.message}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <TogglePillButton onClick={() => onOpenChange(false)} disabled={submitting} data-testid="button-cancel-schedule">
                {t("scheduleTicket.cancel")}
              </TogglePillButton>
              {certBlock && certBlock.canOverride && certBlock.blockingMissing.length > 0 && (
                <TogglePillButton
                  onClick={handleOverrideAndSave}
                  disabled={submitting}
                  data-testid="button-override-schedule"
                >
                  {submitting ? t("scheduleTicket.saving") : t("scheduleTicket.overrideAndSave")}
                </TogglePillButton>
              )}
              <GreenButton onClick={handleSave} disabled={submitting} data-testid="button-save-schedule">
                {submitting ? t("scheduleTicket.saving") : t("scheduleTicket.save")}
              </GreenButton>
            </div>
          </div>
        )}
      </DialogContent>

      {/* Task #647: rich double-booking confirmation. Renders one card per
          conflicting crew member with the other ticket's tracking number,
          work type, site, and human-readable start time + duration. Each
          card links to the conflicting ticket in a new tab so the
          dispatcher can sanity-check before deciding to override. */}
      <AlertDialog
        open={pendingConflicts != null}
        onOpenChange={(o) => { if (!o) setPendingConflicts(null); }}
      >
        <AlertDialogContent className="max-w-lg" data-testid="dialog-schedule-conflict">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              {t("scheduleTicket.conflictTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("scheduleTicket.conflictPrompt")}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="max-h-72 overflow-y-auto space-y-2">
            {(pendingConflicts ?? []).map((c, idx) => {
              const when = new Date(c.otherStartAt).toLocaleString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              });
              const duration = formatDuration(c.otherDurationMinutes);
              const tracking = formatTicketTrackingNumber(c.otherTicketId);
              const href = `${import.meta.env.BASE_URL}tickets/${c.otherTicketId}`;
              return (
                <div
                  key={`${c.employeeId}-${c.otherTicketId}-${idx}`}
                  className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                  data-testid={`conflict-row-${c.employeeId}-${c.otherTicketId}`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="font-semibold text-sm" data-testid={`conflict-employee-${c.employeeId}`}>
                      {c.employeeName}
                    </div>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-amber-700 hover:text-amber-900 underline font-mono text-[11px]"
                      data-testid={`conflict-link-${c.otherTicketId}`}
                    >
                      {tracking}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <div className="space-y-0.5 leading-snug">
                    <div className="flex items-center gap-1.5">
                      <Briefcase className="w-3 h-3 shrink-0 text-amber-700" />
                      <span data-testid={`conflict-worktype-${c.otherTicketId}`}>
                        {c.otherWorkType ?? t("scheduleTicket.conflictWorkTypeUnknown")}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3 h-3 shrink-0 text-amber-700" />
                      <span data-testid={`conflict-site-${c.otherTicketId}`}>
                        {c.otherSiteName ?? t("scheduleTicket.conflictSiteUnknown")}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 shrink-0 text-amber-700" />
                      <span data-testid={`conflict-when-${c.otherTicketId}`}>
                        {t("scheduleTicket.conflictWhen", { when, duration })}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <AlertDialogFooter>
            <TogglePillButton
              onClick={() => setPendingConflicts(null)}
              data-testid="button-conflict-cancel"
            >
              {t("scheduleTicket.conflictCancel")}
            </TogglePillButton>
            <PillButton
              color="red"
              onClick={() => { void confirmOverride(); }}
              data-testid="button-conflict-override"
            >
              {t("scheduleTicket.conflictOverride")}
            </PillButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
