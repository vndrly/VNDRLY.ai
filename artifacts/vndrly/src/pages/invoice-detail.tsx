import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/api-error";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import { Badge } from "@/components/ui/badge";
import PngPill, { PngPillButton, type PngPillColor } from "@/components/png-pill-rollover";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import SphereBackButton from "@/components/sphere-back-button";
import {
  RefreshCw,
  Save,
  Send,
  DollarSign,
  Receipt,
  Bell,
  FileDown,
  Trash2,
  AlertTriangle,
  CloudCheck,
  CloudOff,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useAuth } from "@/hooks/use-auth";
import {
  FORMS_1099,
  type Form1099,
  type IncomeCategory,
  plannedFormFor,
  routeLine,
  sumByForm,
  suspectMatch,
  type FormAllocation,
} from "@/lib/form1099";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const INCOME_CATEGORIES = [
  "nec",
  "misc_rents",
  "misc_royalties",
  "misc_other_income",
  "misc_prizes_awards",
  "misc_medical_health",
  "misc_attorney",
  "k_third_party_network",
  "none",
] as const;

type InvoiceLine = {
  id: number;
  invoiceId: number;
  ticketId: number | null;
  afe: string | null;
  lineType: string;
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  taxRate: string;
  taxAmount: string;
  incomeCategory: IncomeCategory;
  isManualOverride: boolean;
};

type InvoicePayment = {
  id: number;
  invoiceId: number;
  method: string;
  referenceNumber: string | null;
  amount: string;
  paidAt: string;
  notes: string | null;
  createdAt: string;
};

type InvoiceCreditMemo = {
  id: number;
  invoiceId: number;
  amount: string;
  reason: string;
  createdAt: string;
};

type InvoiceSendLog = {
  id: number;
  invoiceId: number;
  sentAt: string;
  sentToEmail: string | null;
  sendgridMessageId: string | null;
  failureMessage: string | null;
};

type InvoiceReminderLog = {
  id: number;
  invoiceId: number;
  kind: "aging" | "manual";
  threshold: string | null;
  sentAt: string;
  sentToEmail: string | null;
  failureMessage: string | null;
  notes: string | null;
};

type InvoicePushedStatus = {
  pushedAt: string;
  externalInvoiceId: string | null;
  externalDocNumber: string | null;
};

type InvoicePushedTo = {
  qbo: InvoicePushedStatus | null;
  oa: InvoicePushedStatus | null;
};

type InvoiceResyncHistoryEntry = {
  id: number;
  provider: "qbo" | "oa";
  at: string;
  outcome: "updated" | "missing" | "unknown";
  byUserId: number | null;
  byUserDisplayName: string | null;
  byUserUsername: string | null;
  externalDocNumber: string | null;
  warningCount: number;
  errorMessage: string | null;
};

// Mirrors `LateFeeRule` in lib/db/src/schema/invoices.ts so the detail page
// doesn't pull a runtime dependency on the schema package just for a type.
// Keep in lockstep with the schema and the `LateFeeRuleSchema` zod union in
// lib/api-zod/src/custom.ts.
type LateFeeRuleClient =
  | { kind: "flat"; amount: string; afterDays: number }
  | {
      kind: "percent";
      rate: string;
      afterDays: number;
      compounding?: "none" | "monthly";
    }
  | { kind: "none" };

type InvoiceDetail = {
  id: number;
  invoiceNumber: string;
  vendorId: number;
  partnerId: number;
  cadence: "per_ticket" | "weekly" | "monthly";
  status: "draft" | "open" | "sent" | "paid" | "overdue" | "cancelled";
  periodStart: string;
  periodEnd: string;
  dueDate: string | null;
  subtotal: string;
  taxTotal: string;
  total: string;
  paidAmount: string;
  creditedAmount: string;
  balanceDue: string;
  billingContactEmail: string | null;
  remitToAddress: string | null;
  remitToName: string | null;
  notes: string | null;
  // Per-invoice late-fee override snapshot (NULL → fall back to billing
  // settings). `effectiveLateFeeRule` is what the aging worker will
  // actually apply, computed server-side.
  lateFeeRule: LateFeeRuleClient | null;
  effectiveLateFeeRule: LateFeeRuleClient | null;
  lines: InvoiceLine[];
  ticketLinks: { ticketId: number }[];
  payments: InvoicePayment[];
  creditMemos: InvoiceCreditMemo[];
  sendLog: InvoiceSendLog[];
  reminderLog: InvoiceReminderLog[];
  pushedTo: InvoicePushedTo;
  resyncHistory: InvoiceResyncHistoryEntry[];
};

function formatMoney(s: string | null | undefined): string {
  if (s == null) return "—";
  const n = Number(s);
  if (Number.isNaN(n)) return String(s);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString();
}

function formatDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleString();
}

function statusVariant(
  status: InvoiceDetail["status"],
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "paid":
      return "default";
    case "sent":
    case "open":
      return "secondary";
    case "overdue":
    case "cancelled":
      return "destructive";
    default:
      return "outline";
  }
}

function statusPillColor(status: InvoiceDetail["status"]): PngPillColor {
  switch (status) {
    case "paid":
      return "green";
    case "sent":
    case "open":
      return "blue";
    case "overdue":
    case "cancelled":
      return "red";
    default:
      return "brand";
  }
}

interface LineEditState {
  description: string;
  quantity: string;
  unitPrice: string;
  incomeCategory: IncomeCategory;
}

export default function InvoiceDetailPage({ id }: { id: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [editing, setEditing] = useState<Record<number, LineEditState>>({});
  // Multi-select state for bulk 1099-category recategorization. Holds the
  // line IDs the admin/vendor has ticked. Cleared after every successful
  // bulk apply or when leaving the page.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkCategory, setBulkCategory] = useState<IncomeCategory>("nec");

  // Modal state
  const [openSend, setOpenSend] = useState(false);
  const [openPay, setOpenPay] = useState(false);
  const [openCredit, setOpenCredit] = useState(false);
  const [openRemind, setOpenRemind] = useState(false);
  // Which provider's "Forget push record" confirm dialog is open, or
  // null when the dialog is closed. Driven by the per-provider
  // "Forget" buttons inside the "Synced to accounting" card.
  const [forgetProvider, setForgetProvider] = useState<
    "qbo" | "oa" | null
  >(null);

  // Form state
  const [sendTo, setSendTo] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<string>("ach");
  const [payRef, setPayRef] = useState("");
  const [payDate, setPayDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [payNotes, setPayNotes] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [remindNote, setRemindNote] = useState("");

  // "Show older" pagination for the per-invoice re-sync history. The
  // detail endpoint caps the inline list at 10 events; admins page
  // through anything older via GET /invoices/:id/resync-history with a
  // `before=<auditId>` cursor. We keep the extra entries in local state
  // (rather than mutating the cached detail payload) so a refresh of
  // the invoice query doesn't surprise the operator by collapsing the
  // expanded history. `nextResyncCursor === null` means no more pages.
  const [olderResync, setOlderResync] = useState<InvoiceResyncHistoryEntry[]>(
    [],
  );
  const [nextResyncCursor, setNextResyncCursor] = useState<number | null>(
    null,
  );
  // Tracks whether the operator has clicked "Show older" yet. Before
  // the first click we optimistically show the button when the inline
  // list is full (length >= 10), since the server doesn't tell us
  // whether more rows exist on the detail payload. After a click,
  // visibility is driven entirely by `nextResyncCursor`.
  const [resyncPaged, setResyncPaged] = useState(false);
  const [loadingOlderResync, setLoadingOlderResync] = useState(false);

  // Reset re-sync pagination state when navigating to a different
  // invoice. The page component can be reused across /invoices/:id
  // navigations (wouter keeps the same component mounted when only
  // the route param changes), so without this the previous invoice's
  // older history would briefly bleed into the next view.
  useEffect(() => {
    setOlderResync([]);
    setNextResyncCursor(null);
    setResyncPaged(false);
    setLoadingOlderResync(false);
  }, [id]);

  const { data, isLoading } = useQuery<InvoiceDetail>({
    queryKey: ["invoices", "detail", id],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/invoices/${id}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load invoice");
      return res.json();
    },
  });

  const isAdmin = user?.role === "admin";
  const isVendor =
    user?.role === "vendor" && data?.vendorId === user?.vendorId;
  const isPartner =
    user?.role === "partner" && data?.partnerId === user?.partnerId;
  const canManageBilling = isAdmin || isVendor;
  const canRemind = canManageBilling || isPartner;

  const grouped = useMemo(() => {
    const map = new Map<string, InvoiceLine[]>();
    for (const line of data?.lines ?? []) {
      const key = `${line.ticketId ?? "unassigned"}|${line.afe ?? ""}`;
      const arr = map.get(key) ?? [];
      arr.push(line);
      map.set(key, arr);
    }
    return Array.from(map.entries()).map(([key, lines]) => {
      const [ticketPart, afe] = key.split("|");
      return {
        ticketId: ticketPart === "unassigned" ? null : Number(ticketPart),
        afe: afe || null,
        lines,
        subtotal: lines.reduce((s, l) => s + Number(l.amount), 0),
        tax: lines.reduce((s, l) => s + Number(l.taxAmount), 0),
      };
    });
  }, [data]);

  // Compute the per-line 1099 form routing once. Memoised on the
  // invoice payload because both inputs (lines, payments) come from the
  // same query response — we want the badges, flags and summary card
  // to reflect a single consistent snapshot.
  const formRouting = useMemo(() => {
    if (!data) return { perLine: new Map(), totals: sumByForm([]) };
    const invoiceTotal = Number(data.total);
    const payments = data.payments.map((p) => ({
      amount: p.amount,
      method: p.method,
    }));
    const perLine = new Map<number, ReturnType<typeof routeLine>>();
    const allAllocs: FormAllocation[] = [];
    for (const line of data.lines) {
      const r = routeLine({
        lineAmount: line.amount,
        category: line.incomeCategory,
        invoiceTotal,
        payments,
      });
      perLine.set(line.id, r);
      allAllocs.push(...r.effective);
    }
    return { perLine, totals: sumByForm(allAllocs) };
  }, [data]);

  // Per-line 1099 category-vs-line-type heuristic. The result feeds
  // both the top-of-page banner and the inline per-row indicator. We
  // memoise so the banner doesn't re-render every keystroke during
  // inline editing.
  const suspectLines = useMemo(() => {
    if (!data) return [] as { line: InvoiceLine; suggested: IncomeCategory[] }[];
    const out: { line: InvoiceLine; suggested: IncomeCategory[] }[] = [];
    for (const line of data.lines) {
      const m = suspectMatch(line.lineType, line.incomeCategory);
      if (m.suspect) out.push({ line, suggested: m.suggested });
    }
    return out;
  }, [data]);

  // Begin inline-editing a single line — used by the "Fix" buttons in
  // the suspect-category banner so the admin lands directly on the
  // category Select for that row without needing to scroll/locate it.
  const beginEditLine = (line: InvoiceLine) => {
    setEditing((cur) => ({
      ...cur,
      [line.id]: {
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        incomeCategory: line.incomeCategory,
      },
    }));
    // Defer scrollIntoView to the next paint so the row exists in
    // edit mode (the Select swaps in synchronously but the layout may
    // shift). We scroll the row near the top of the viewport so the
    // category dropdown is visible.
    if (typeof window !== "undefined") {
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-testid="row-line-${line.id}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  };

  const regenerate = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `${API_BASE}/api/invoices/${id}/regenerate`,
        { method: "POST", credentials: "include" },
      );
      if (!res.ok) throw new Error("Regeneration failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: t("invoices.toast.regenerated") });
    },
    onError: () =>
      toast({
        title: t("invoices.toast.regenerateFailed"),
        variant: "destructive",
      }),
  });

  // Snapshot of the per-line state captured by the most recent successful
  // bulk update. Used to power the Undo affordance — we hand the snapshot
  // straight back to the per-line PATCH shape.
  type CategorySnapshot = {
    lineId: number;
    incomeCategory: IncomeCategory;
    isManualOverride: boolean;
  };

  // Custom error subclass so the onError handler can recognise the
  // "invoice is no longer a draft" failure and surface the same partial-
  // undo affordance as the dashboard (count of lines we couldn't revert).
  class UndoFailedError extends Error {
    code: string;
    snapshotSize: number;
    constructor(code: string, snapshotSize: number, message?: string) {
      super(message ?? code);
      this.code = code;
      this.snapshotSize = snapshotSize;
    }
  }

  const undoBulkCategory = useMutation({
    mutationFn: async (snapshot: CategorySnapshot[]) => {
      const res = await fetch(`${API_BASE}/api/invoices/${id}/lines`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ updates: snapshot }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new UndoFailedError(
          (json.code as string) ?? "",
          snapshot.length,
          (json.error as string) ?? "undo_failed",
        );
      }
      return json as { ok: true; updated: number };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["invoices", "detail", id] });
      qc.invalidateQueries({ queryKey: ["invoices", "list"] });
      toast({
        title: t("invoices.toast.bulkCategoryUndone", { count: data.updated }),
      });
    },
    onError: (err: Error) => {
      // The per-invoice PATCH is all-or-nothing: if the invoice has left
      // draft between the bulk change and the Undo, the server rejects
      // the whole batch with `invoice.cannot_edit`. Mirror the dashboard's
      // partial-undo affordance — explain that none of the snapshot's
      // lines could be reverted and why — instead of a generic failure.
      if (
        err instanceof UndoFailedError &&
        err.code === "invoice.cannot_edit"
      ) {
        toast({
          title: t("invoices.toast.bulkCategoryUndoSkippedNotDraft", {
            count: err.snapshotSize,
          }),
          variant: "destructive",
        });
        return;
      }
      toast({
        title: translateApiError(err, t, t("invoices.toast.bulkCategoryUndoFailed")),
        variant: "destructive",
      });
    },
  });

  const bulkSetCategory = useMutation({
    mutationFn: async ({
      lineIds,
      incomeCategory,
    }: {
      lineIds: number[];
      incomeCategory: IncomeCategory;
    }) => {
      const res = await fetch(`${API_BASE}/api/invoices/${id}/lines`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineIds, incomeCategory }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "bulk_failed");
      return json as {
        ok: true;
        updated: number;
        previousCategories?: CategorySnapshot[];
      };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["invoices", "detail", id] });
      qc.invalidateQueries({ queryKey: ["invoices", "list"] });
      setSelected(new Set());
      // Surface an Undo action when the server sent back a snapshot. The
      // snapshot includes both the prior category AND the prior manual-
      // override flag so undo is a true revert (not just another category
      // change that re-flags the row).
      const snapshot = data.previousCategories ?? [];
      toast({
        title: t("invoices.toast.bulkCategorySet", { count: data.updated }),
        action:
          snapshot.length > 0 ? (
            <ToastAction
              altText={t("invoices.toast.undo")}
              onClick={() => undoBulkCategory.mutate(snapshot)}
              data-testid="button-undo-bulk-category"
            >
              {t("invoices.toast.undo")}
            </ToastAction>
          ) : undefined,
      });
    },
    onError: (err: Error) =>
      toast({
        title: translateApiError(err, t, t("invoices.toast.bulkCategoryFailed")),
        variant: "destructive",
      }),
  });

  const saveLine = useMutation({
    mutationFn: async ({
      lineId,
      payload,
    }: {
      lineId: number;
      payload: LineEditState;
    }) => {
      const res = await fetch(
        `${API_BASE}/api/invoices/${id}/lines/${lineId}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["invoices", "detail", id] });
      qc.invalidateQueries({ queryKey: ["invoices", "list"] });
      setEditing((cur) => {
        const next = { ...cur };
        delete next[vars.lineId];
        return next;
      });
      toast({ title: t("invoices.toast.lineSaved") });
    },
    onError: () =>
      toast({
        title: t("invoices.toast.lineSaveFailed"),
        variant: "destructive",
      }),
  });

  const sendInvoice = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/invoices/${id}/send`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toEmail: sendTo || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(json.error ?? "send_failed");
      // The /send endpoint returns 200 with `sent: false` when the
      // status transition + audit log succeed but the SendGrid call
      // failed (no recipient email, transient 5xx, etc). Treat that
      // as a user-facing failure: the invoice is logged but the
      // recipient never received it. We still invalidate queries so
      // the audit ledger refreshes, but throw to trigger the toast.
      if (json && json.sent === false) {
        throw new Error(json.failureMessage ?? "email_delivery_failed");
      }
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices", "detail", id] });
      qc.invalidateQueries({ queryKey: ["invoices", "list"] });
      setOpenSend(false);
      setSendTo("");
      toast({ title: t("invoices.toast.sent") });
    },
    onError: (err: Error) => {
      // Refresh audit/log views even on email failure so the user
      // sees the failed send entry without manual reload, and close
      // the Send modal — server-side the invoice has already been
      // marked sent and the recipient cached, so reopening the modal
      // would just confuse the user. The destructive toast carries
      // the SendGrid failure message so they know to retry.
      qc.invalidateQueries({ queryKey: ["invoices", "detail", id] });
      qc.invalidateQueries({ queryKey: ["invoices", "list"] });
      setOpenSend(false);
      setSendTo("");
      toast({
        title: translateApiError(err, t, t("invoices.toast.sendFailed")),
        variant: "destructive",
      });
    },
  });

  const recordPayment = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/invoices/${id}/payments`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          method: payMethod,
          amount: payAmount,
          paidAt: payDate,
          referenceNumber: payRef || undefined,
          notes: payNotes || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(json.error ?? "payment_failed");
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices", "detail", id] });
      qc.invalidateQueries({ queryKey: ["invoices", "list"] });
      qc.invalidateQueries({ queryKey: ["bills-to-pay"] });
      setOpenPay(false);
      setPayAmount("");
      setPayRef("");
      setPayNotes("");
      toast({ title: t("invoices.toast.paymentRecorded") });
    },
    onError: (err: Error) =>
      toast({
        title: translateApiError(err, t, t("invoices.toast.paymentFailed")),
        variant: "destructive",
      }),
  });

  const deletePayment = useMutation({
    mutationFn: async (pid: number) => {
      const res = await fetch(
        `${API_BASE}/api/invoices/${id}/payments/${pid}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok) throw new Error("delete_failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices", "detail", id] });
      qc.invalidateQueries({ queryKey: ["invoices", "list"] });
      toast({ title: t("invoices.toast.paymentDeleted") });
    },
    onError: () =>
      toast({
        title: t("invoices.toast.paymentDeleteFailed"),
        variant: "destructive",
      }),
  });

  const addCredit = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `${API_BASE}/api/invoices/${id}/credit-memos`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            amount: creditAmount,
            reason: creditReason,
          }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(json.error ?? "credit_failed");
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices", "detail", id] });
      qc.invalidateQueries({ queryKey: ["invoices", "list"] });
      setOpenCredit(false);
      setCreditAmount("");
      setCreditReason("");
      toast({ title: t("invoices.toast.creditAdded") });
    },
    onError: (err: Error) =>
      toast({
        title: translateApiError(err, t, t("invoices.toast.creditFailed")),
        variant: "destructive",
      }),
  });

  const sendReminder = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/invoices/${id}/remind`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: remindNote || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(json.error ?? "remind_failed");
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices", "detail", id] });
      setOpenRemind(false);
      setRemindNote("");
      toast({ title: t("invoices.toast.reminderSent") });
    },
    onError: (err: Error) =>
      toast({
        title: translateApiError(err, t, t("invoices.toast.reminderFailed")),
        variant: "destructive",
      }),
  });

  // Re-sync this invoice to QuickBooks / OpenAccountant in place. We
  // surface the upstream-deleted case (the user deleted the invoice in
  // the accounting product) with a dedicated toast so the operator
  // knows the per-invoice action can't help — only a fresh bulk push
  // will recreate it.
  const resyncQbo = useMutation({
    mutationFn: async () => {
      if (!data) throw new Error("invoice_not_loaded");
      const res = await fetch(
        `${API_BASE}/api/reports/vendor/${data.vendorId}/invoices/${id}/qbo-resync`,
        { method: "POST", credentials: "include" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(json.error ?? "resync_failed");
        (err as Error & { code?: string }).code = json.code;
        throw err;
      }
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices", "detail", id] });
      toast({ title: t("invoices.toast.qboResynced") });
    },
    onError: (err: Error & { code?: string }) =>
      toast({
        title: t("invoices.toast.qboResyncFailed"),
        description:
          err.code === "qbo.invoice_missing"
            ? t("invoices.toast.qboInvoiceMissing")
            : translateApiError(err, t, err.message),
        variant: "destructive",
      }),
  });

  // Loads the next page of older re-sync events for this invoice and
  // appends them to local state. Uses the smallest id from the
  // currently-displayed history (inline + already-loaded older) as the
  // `before` cursor so the server returns strictly older rows. Quietly
  // surfaces a toast on failure rather than throwing — the inline list
  // is unaffected.
  const loadOlderResync = async () => {
    if (!data) return;
    if (loadingOlderResync) return;
    const all = [...data.resyncHistory, ...olderResync];
    if (all.length === 0) return;
    const cursor =
      nextResyncCursor ?? all[all.length - 1]?.id ?? null;
    if (cursor == null) return;
    setLoadingOlderResync(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/invoices/${id}/resync-history?before=${cursor}&limit=20`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("resync_history_failed");
      const json = (await res.json()) as {
        items: InvoiceResyncHistoryEntry[];
        nextCursor: number | null;
      };
      setOlderResync((prev) => [...prev, ...json.items]);
      setNextResyncCursor(json.nextCursor);
      setResyncPaged(true);
    } catch (err) {
      toast({
        title: t("invoices.resyncHistory.loadOlderFailed"),
        description: translateApiError(err as Error, t, (err as Error).message),
        variant: "destructive",
      });
    } finally {
      setLoadingOlderResync(false);
    }
  };

  const resyncOa = useMutation({
    mutationFn: async () => {
      if (!data) throw new Error("invoice_not_loaded");
      const res = await fetch(
        `${API_BASE}/api/reports/vendor/${data.vendorId}/invoices/${id}/oa-resync`,
        { method: "POST", credentials: "include" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(json.error ?? "resync_failed");
        (err as Error & { code?: string }).code = json.code;
        throw err;
      }
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices", "detail", id] });
      toast({ title: t("invoices.toast.oaResynced") });
    },
    onError: (err: Error & { code?: string }) =>
      toast({
        title: t("invoices.toast.oaResyncFailed"),
        description:
          err.code === "oa.invoice_missing"
            ? t("invoices.toast.oaInvoiceMissing")
            : translateApiError(err, t, err.message),
        variant: "destructive",
      }),
  });

  // Admin-only "Forget push record" — clears the local mapping row in
  // accounting_pushed_invoices for this (vendor, provider, invoice
  // number). The next bulk push will then re-create the invoice in
  // QBO/OA. Used when the remote invoice was deleted in the
  // accounting product or the wrong vendor was synced; without this,
  // the bulk push would skip the invoice as already-pushed.
  const forgetPush = useMutation({
    mutationFn: async (provider: "qbo" | "oa") => {
      const res = await fetch(
        `${API_BASE}/api/invoices/${id}/pushed/${provider}`,
        { method: "DELETE", credentials: "include" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(json.error ?? "forget_failed");
        (err as Error & { code?: string }).code = json.code;
        throw err;
      }
      return { provider, ...json };
    },
    onSuccess: ({ provider }: { provider: "qbo" | "oa" }) => {
      qc.invalidateQueries({ queryKey: ["invoices", "detail", id] });
      setForgetProvider(null);
      toast({
        title: t(
          provider === "qbo"
            ? "invoices.toast.qboForgotten"
            : "invoices.toast.oaForgotten",
        ),
      });
    },
    onError: (err: Error & { code?: string }) =>
      toast({
        title: translateApiError(err, t, t("invoices.toast.forgetFailed")),
        variant: "destructive",
      }),
  });

  if (isLoading || !data) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const isDraft = data.status === "draft";
  const balanceNum = Number(data.balanceDue);
  const isPaid = data.status === "paid" || balanceNum <= 0.005;
  // Allow Send on draft/open (initial send) AND on `sent`/`overdue` so
  // the user can retry after a SendGrid failure or re-send a fresh PDF.
  // The action is hidden once the invoice is paid or cancelled.
  const sendable =
    canManageBilling &&
    (data.status === "draft" ||
      data.status === "open" ||
      data.status === "sent" ||
      data.status === "overdue");
  const isResend = data.status === "sent" || data.status === "overdue";
  const canPay = canManageBilling || isPartner;
  const showAgingBadge = data.status === "overdue";

  const pdfUrl = `${API_BASE}/api/invoices/${id}/pdf`;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/invoices"
            className="group inline-flex items-center"
            data-testid="link-back-invoices"
            aria-label="Back to invoices"
          >
            <SphereBackButton size={32} />
          </Link>
          <h1 className="text-2xl font-semibold">{data.invoiceNumber}</h1>
          <PngPill color={statusPillColor(data.status)} data-testid="badge-status">
            {t(`invoices.status.${data.status}`)}
          </PngPill>
          {showAgingBadge && data.dueDate && (
            <PngPill color="red" data-testid="badge-aging">
              {t("invoices.agingBadge", {
                // Calendar-day diff (UTC) so the badge label matches the
                // server-side aging worker's day count regardless of
                // time-of-day or DST shifts.
                days: (() => {
                  const due = new Date(data.dueDate);
                  const now = new Date();
                  const dueDay = Date.UTC(
                    due.getUTCFullYear(),
                    due.getUTCMonth(),
                    due.getUTCDate(),
                  );
                  const nowDay = Date.UTC(
                    now.getUTCFullYear(),
                    now.getUTCMonth(),
                    now.getUTCDate(),
                  );
                  return Math.max(
                    0,
                    Math.floor((nowDay - dueDay) / (24 * 60 * 60 * 1000)),
                  );
                })(),
              })}
            </PngPill>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isDraft && (
            <PngPillButton
              color="blue"

              onClick={() => regenerate.mutate()}
              disabled={regenerate.isPending}
              className="px-3 gap-2"
              data-testid="button-regenerate"
            >
              <RefreshCw className="w-4 h-4" />
              {t("invoices.regenerate")}
            </PngPillButton>
          )}
          <a href={pdfUrl} target="_blank" rel="noreferrer" className="inline-flex" data-testid="link-download-pdf">
            <PngPillButton color="red" className="px-3 gap-2" data-testid="button-download-pdf">
              <FileDown className="w-4 h-4" />
              {t("invoices.actions.downloadPdf")}
            </PngPillButton>
          </a>
          {sendable && (
            <PngPillButton
              color="green"

              onClick={() => {
                setSendTo(data.billingContactEmail ?? "");
                setOpenSend(true);
              }}
              className="px-3 gap-2"
              data-testid="button-send"
            >
              <Send className="w-4 h-4" />
              {isResend
                ? t("invoices.actions.resend")
                : t("invoices.actions.send")}
            </PngPillButton>
          )}
          {canPay && !isPaid && data.status !== "draft" && (
            <PngPillButton
              color="green"

              onClick={() => {
                setPayAmount(data.balanceDue);
                setOpenPay(true);
              }}
              className="px-3 gap-2"
              data-testid="button-record-payment"
            >
              <DollarSign className="w-4 h-4" />
              {t("invoices.actions.recordPayment")}
            </PngPillButton>
          )}
          {canManageBilling && !isPaid && data.status !== "draft" && (
            <PngPillButton
              color="brand"

              onClick={() => setOpenCredit(true)}
              className="px-3 gap-2"
              data-testid="button-credit-memo"
            >
              <Receipt className="w-4 h-4" />
              {t("invoices.actions.creditMemo")}
            </PngPillButton>
          )}
          {canRemind &&
            !isPaid &&
            (data.status === "sent" || data.status === "overdue") && (
              <PngPillButton
                color="blue"

                onClick={() => setOpenRemind(true)}
                className="px-3 gap-2"
                data-testid="button-remind"
              >
                <Bell className="w-4 h-4" />
                {t("invoices.actions.remind")}
              </PngPillButton>
            )}
        </div>
      </div>

      <Card data-testid="card-balance">
        <CardContent className="pt-6 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">
              {t("invoices.col.total")}
            </div>
            <div className="font-semibold text-lg tabular-nums">
              {formatMoney(data.total)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">
              {t("invoices.balance.paid")}
            </div>
            <div className="font-medium tabular-nums">
              {formatMoney(data.paidAmount)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">
              {t("invoices.balance.credited")}
            </div>
            <div className="font-medium tabular-nums">
              {formatMoney(data.creditedAmount)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">
              {t("invoices.balance.due")}
            </div>
            <div
              className="font-bold text-lg tabular-nums"
              style={{
                color: balanceNum > 0 ? "var(--brand-primary)" : "#059669",
              }}
              data-testid="text-balance-due"
            >
              {formatMoney(data.balanceDue)}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("invoices.summary")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">
              {t("invoices.col.cadence")}
            </div>
            <div className="font-medium">
              {t(`invoices.cadence.${data.cadence}`)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">
              {t("invoices.col.period")}
            </div>
            <div className="font-medium">
              {formatDate(data.periodStart)} – {formatDate(data.periodEnd)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">
              {t("invoices.col.due")}
            </div>
            <div className="font-medium">{formatDate(data.dueDate)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">
              {t("invoices.col.billingEmail")}
            </div>
            <div className="font-medium truncate">
              {data.billingContactEmail ?? "—"}
            </div>
          </div>
        </CardContent>
      </Card>

      {canManageBilling && (
        <LateFeeOverrideCard
          invoiceId={data.id}
          override={data.lateFeeRule}
          effective={data.effectiveLateFeeRule}
          status={data.status}
        />
      )}

      {isDraft && (
        <Card data-testid="card-bulk-actions">
          <CardContent className="flex flex-wrap items-center gap-3 pt-4">
            <Checkbox
              id="bulk-select-all"
              checked={
                (data.lines.length > 0 &&
                  selected.size === data.lines.length) ||
                (selected.size > 0 && selected.size < data.lines.length
                  ? "indeterminate"
                  : false)
              }
              onCheckedChange={(checked) => {
                setSelected(
                  checked === true
                    ? new Set(data.lines.map((l) => l.id))
                    : new Set(),
                );
              }}
              data-testid="checkbox-select-all-lines"
            />
            <Label
              htmlFor="bulk-select-all"
              className="text-sm font-medium"
              data-testid="text-bulk-selection-summary"
            >
              {t("invoices.bulk.selectionSummary", {
                count: selected.size,
                total: data.lines.length,
              })}
            </Label>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {t("invoices.bulk.setCategoryLabel")}
              </span>
              <Select
                value={bulkCategory}
                onValueChange={(v) =>
                  setBulkCategory(v as IncomeCategory)
                }
                disabled={selected.size === 0 || bulkSetCategory.isPending}
              >
                <SelectTrigger
                  className="w-[260px]"
                  data-testid="select-bulk-income-category"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INCOME_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(`invoices.incomeCategory.${c}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <PillButton
                color="blue"
                onClick={() =>
                  bulkSetCategory.mutate({
                    lineIds: Array.from(selected),
                    incomeCategory: bulkCategory,
                  })
                }
                disabled={
                  selected.size === 0 || bulkSetCategory.isPending
                }
                data-testid="button-apply-bulk-category"
              >
                {t("invoices.bulk.apply")}
              </PillButton>
              <PillButton
                color="image"
                onClick={() => setSelected(new Set())}
                disabled={selected.size === 0 || bulkSetCategory.isPending}
                data-testid="button-clear-bulk-selection"
              >
                {t("invoices.bulk.clear")}
              </PillButton>
            </div>
          </CardContent>
        </Card>
      )}

      {suspectLines.length > 0 && (
        <SuspectCategoryBanner
          suspectLines={suspectLines}
          isDraft={isDraft}
          onFix={beginEditLine}
        />
      )}

      {grouped.map((group) => {
        const groupIds = group.lines.map((l) => l.id);
        const groupSelectedCount = groupIds.filter((id) =>
          selected.has(id),
        ).length;
        const groupAllSelected =
          groupIds.length > 0 && groupSelectedCount === groupIds.length;
        const groupSomeSelected =
          groupSelectedCount > 0 && groupSelectedCount < groupIds.length;
        return (
        <Card
          key={`${group.ticketId ?? "x"}-${group.afe ?? "noafe"}`}
          data-testid={`group-ticket-${group.ticketId ?? "unassigned"}`}
        >
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              {group.ticketId ? (
                <Link
                  href={`/tickets/${group.ticketId}`}
                  className="hover:underline"
                  style={{ color: "var(--brand-primary)" }}
                >
                  {t("invoices.ticket")} #{group.ticketId}
                </Link>
              ) : (
                t("invoices.unassigned")
              )}
              {group.afe && (
                <span className="ml-2 text-sm text-muted-foreground">
                  · {t("invoices.afe")}: {group.afe}
                </span>
              )}
            </CardTitle>
            <div className="text-sm text-muted-foreground tabular-nums">
              {t("invoices.col.subtotal")}: {formatMoney(String(group.subtotal))} ·{" "}
              {t("invoices.col.tax")}: {formatMoney(String(group.tax))}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  {isDraft && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={
                          groupAllSelected
                            ? true
                            : groupSomeSelected
                              ? "indeterminate"
                              : false
                        }
                        onCheckedChange={(checked) => {
                          setSelected((cur) => {
                            const next = new Set(cur);
                            if (checked === true) {
                              for (const lid of groupIds) next.add(lid);
                            } else {
                              for (const lid of groupIds) next.delete(lid);
                            }
                            return next;
                          });
                        }}
                        data-testid={`checkbox-select-group-${group.ticketId ?? "unassigned"}`}
                      />
                    </TableHead>
                  )}
                  <TableHead>{t("invoices.col.lineType")}</TableHead>
                  <TableHead>{t("invoices.col.description")}</TableHead>
                  <TableHead>{t("invoices.col.incomeCategory")}</TableHead>
                  <TableHead className="text-right">
                    {t("invoices.col.qty")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("invoices.col.unitPrice")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("invoices.col.amount")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("invoices.col.tax")}
                  </TableHead>
                  {isDraft && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.lines.map((line) => {
                  const edit = editing[line.id];
                  const isSelected = selected.has(line.id);
                  return (
                    <TableRow
                      key={line.id}
                      data-testid={`row-line-${line.id}`}
                      data-state={isSelected ? "selected" : undefined}
                    >
                      {isDraft && (
                        <TableCell className="w-10">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(checked) => {
                              setSelected((cur) => {
                                const next = new Set(cur);
                                if (checked === true) next.add(line.id);
                                else next.delete(line.id);
                                return next;
                              });
                            }}
                            data-testid={`checkbox-line-${line.id}`}
                          />
                        </TableCell>
                      )}
                      <TableCell className="text-xs uppercase text-muted-foreground">
                        {line.lineType}
                        {line.isManualOverride && (
                          <Badge
                            variant="outline"
                            className="ml-2 text-[10px]"
                          >
                            {t("invoices.manual")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {edit ? (
                          <Input
                            value={edit.description}
                            onChange={(e) =>
                              setEditing((cur) => ({
                                ...cur,
                                [line.id]: {
                                  ...edit,
                                  description: e.target.value,
                                },
                              }))
                            }
                            data-testid={`input-description-${line.id}`}
                          />
                        ) : (
                          line.description
                        )}
                      </TableCell>
                      <TableCell>
                        {edit ? (
                          <Select
                            value={edit.incomeCategory}
                            onValueChange={(v) =>
                              setEditing((cur) => ({
                                ...cur,
                                [line.id]: {
                                  ...edit,
                                  incomeCategory: v as IncomeCategory,
                                },
                              }))
                            }
                          >
                            <SelectTrigger
                              className="w-[200px]"
                              data-testid={`select-income-category-${line.id}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {INCOME_CATEGORIES.map((c) => (
                                <SelectItem key={c} value={c}>
                                  {t(`invoices.incomeCategory.${c}`)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <div className="space-y-1">
                            <span
                              className="text-xs text-muted-foreground block"
                              data-testid={`text-income-category-${line.id}`}
                            >
                              {t(
                                `invoices.incomeCategory.${line.incomeCategory}`,
                              )}
                            </span>
                            <FormRoutingBadges
                              routing={formRouting.perLine.get(line.id)}
                              lineId={line.id}
                            />
                            <SuspectCategoryIndicator
                              lineType={line.lineType}
                              category={line.incomeCategory}
                              lineId={line.id}
                              isDraft={isDraft}
                              onFix={() => beginEditLine(line)}
                            />
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {edit ? (
                          <Input
                            value={edit.quantity}
                            onChange={(e) =>
                              setEditing((cur) => ({
                                ...cur,
                                [line.id]: {
                                  ...edit,
                                  quantity: e.target.value,
                                },
                              }))
                            }
                            className="w-24 ml-auto"
                            data-testid={`input-quantity-${line.id}`}
                          />
                        ) : (
                          line.quantity
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {edit ? (
                          <Input
                            value={edit.unitPrice}
                            onChange={(e) =>
                              setEditing((cur) => ({
                                ...cur,
                                [line.id]: {
                                  ...edit,
                                  unitPrice: e.target.value,
                                },
                              }))
                            }
                            className="w-28 ml-auto"
                            data-testid={`input-unitprice-${line.id}`}
                          />
                        ) : (
                          formatMoney(line.unitPrice)
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(line.amount)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(line.taxAmount)}
                      </TableCell>
                      {isDraft && (
                        <TableCell className="text-right">
                          {edit ? (
                            <PillButton
                              color="blue"
                              onClick={() =>
                                saveLine.mutate({
                                  lineId: line.id,
                                  payload: edit,
                                })
                              }
                              disabled={saveLine.isPending}
                              data-testid={`button-save-line-${line.id}`}
                            >
                              <Save className="w-3 h-3 mr-1" />
                              {t("invoices.save")}
                            </PillButton>
                          ) : (
                            <PillButton
                              color="image"
                              onClick={() =>
                                setEditing((cur) => ({
                                  ...cur,
                                  [line.id]: {
                                    description: line.description,
                                    quantity: line.quantity,
                                    unitPrice: line.unitPrice,
                                    incomeCategory: line.incomeCategory,
                                  },
                                }))
                              }
                              data-testid={`button-edit-line-${line.id}`}
                            >
                              {t("invoices.edit")}
                            </PillButton>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        );
      })}

      <Card>
        <CardContent className="flex justify-end pt-6">
          <div className="text-right space-y-1 tabular-nums">
            <div className="text-sm text-muted-foreground">
              {t("invoices.col.subtotal")}: {formatMoney(data.subtotal)}
            </div>
            <div className="text-sm text-muted-foreground">
              {t("invoices.col.tax")}: {formatMoney(data.taxTotal)}
            </div>
            <div className="text-xl font-semibold">
              {t("invoices.col.total")}: {formatMoney(data.total)}
            </div>
          </div>
        </CardContent>
      </Card>

      <FormRoutingSummary totals={formRouting.totals} />


      {(data.payments.length > 0 || data.creditMemos.length > 0) && (
        <Card data-testid="card-ledger">
          <CardHeader>
            <CardTitle className="text-base">
              {t("invoices.ledger.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("invoices.ledger.date")}</TableHead>
                  <TableHead>{t("invoices.ledger.kind")}</TableHead>
                  <TableHead>{t("invoices.ledger.detail")}</TableHead>
                  <TableHead className="text-right">
                    {t("invoices.ledger.amount")}
                  </TableHead>
                  {canManageBilling && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.payments.map((p) => (
                  <TableRow
                    key={`pay-${p.id}`}
                    data-testid={`row-payment-${p.id}`}
                  >
                    <TableCell>{formatDate(p.paidAt)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {t("invoices.ledger.payment")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {t(`invoices.method.${p.method}`, p.method)}
                      {p.referenceNumber ? ` · ${p.referenceNumber}` : ""}
                      {p.notes ? (
                        <div className="text-xs text-muted-foreground">
                          {p.notes}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(p.amount)}
                    </TableCell>
                    {canManageBilling && (
                      <TableCell className="text-right">
                        <PillButton
                          color="image"
                          className="min-w-[28px] px-0"
                          onClick={() => deletePayment.mutate(p.id)}
                          disabled={deletePayment.isPending}
                          data-testid={`button-delete-payment-${p.id}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </PillButton>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {data.creditMemos.map((c) => (
                  <TableRow
                    key={`credit-${c.id}`}
                    data-testid={`row-credit-${c.id}`}
                  >
                    <TableCell>{formatDate(c.createdAt)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {t("invoices.ledger.credit")}
                      </Badge>
                    </TableCell>
                    <TableCell>{c.reason}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      −{formatMoney(c.amount)}
                    </TableCell>
                    {canManageBilling && <TableCell />}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {(data.pushedTo.qbo ||
        data.pushedTo.oa ||
        data.resyncHistory.length > 0) && (
        <Card data-testid="card-pushed-to">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CloudCheck className="h-4 w-4 text-emerald-600" />
              {data.pushedTo.qbo || data.pushedTo.oa
                ? t("invoices.pushed.cardTitle")
                : t("invoices.resyncHistory.cardTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-3">
            {!data.pushedTo.qbo &&
              !data.pushedTo.oa &&
              data.resyncHistory.length > 0 && (
                <div
                  className="text-xs text-muted-foreground"
                  data-testid="resync-history-empty-mapping-note"
                >
                  {t("invoices.resyncHistory.emptyMappingNote")}
                </div>
              )}
            {(["qbo", "oa"] as const)
              .filter((p) => data.pushedTo[p] !== null)
              .map((provider) => {
                const status = data.pushedTo[provider]!;
                const label =
                  provider === "qbo" ? "QuickBooks" : "OpenAccountant";
                const isQbo = provider === "qbo";
                const mutation = isQbo ? resyncQbo : resyncOa;
                const actionKey = isQbo
                  ? "invoices.actions.resyncQbo"
                  : "invoices.actions.resyncOa";
                return (
                  <div
                    key={provider}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b pb-2 last:border-0"
                    data-testid={`row-pushed-${provider}`}
                  >
                    <div className="font-medium">
                      {t("invoices.pushed.title", { provider: label })}
                    </div>
                    <div className="text-muted-foreground">
                      {formatDateTime(status.pushedAt)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("invoices.pushed.docNumber")}:{" "}
                      <span className="font-mono">
                        {status.externalDocNumber ?? "—"}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("invoices.pushed.remoteId")}:{" "}
                      <span className="font-mono">
                        {status.externalInvoiceId ?? "—"}
                      </span>
                    </div>
                    {canManageBilling && (
                      <div className="ml-auto flex items-center gap-2">
                        <PillButton
                          color="image"
                          onClick={() => mutation.mutate()}
                          disabled={mutation.isPending}
                          data-testid={`button-resync-${provider}`}
                        >
                          <RefreshCw
                            className={`w-4 h-4 mr-1 ${
                              mutation.isPending ? "animate-spin" : ""
                            }`}
                          />
                          {t(actionKey)}
                        </PillButton>
                        {isAdmin && (
                          <PillButton
                            color="red"
                            onClick={() => setForgetProvider(provider)}
                            disabled={
                              forgetPush.isPending &&
                              forgetProvider === provider
                            }
                            data-testid={`button-forget-${provider}`}
                          >
                            <CloudOff className="w-4 h-4 mr-1" />
                            {t("invoices.actions.forgetPush")}
                          </PillButton>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            {(data.resyncHistory.length > 0 || olderResync.length > 0) && (
              <div
                className="pt-2 space-y-2"
                data-testid="resync-history"
              >
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("invoices.resyncHistory.title")}
                </div>
                {[...data.resyncHistory, ...olderResync].map((entry) => {
                  const providerLabel =
                    entry.provider === "qbo"
                      ? "QuickBooks"
                      : "OpenAccountant";
                  const who =
                    entry.byUserDisplayName ||
                    entry.byUserUsername ||
                    t("invoices.resyncHistory.unknownUser");
                  const isMissing = entry.outcome === "missing";
                  const outcomeLabel = isMissing
                    ? t("invoices.resyncHistory.outcomeMissing", {
                        provider: providerLabel,
                      })
                    : entry.outcome === "updated"
                      ? t("invoices.resyncHistory.outcomeUpdated")
                      : t("invoices.resyncHistory.outcomeUnknown");
                  return (
                    <div
                      key={entry.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs border-b pb-2 last:border-0"
                      data-testid={`row-resync-history-${entry.id}`}
                    >
                      <Badge
                        variant={isMissing ? "destructive" : "secondary"}
                        data-testid={`badge-resync-outcome-${entry.id}`}
                      >
                        {outcomeLabel}
                      </Badge>
                      <span className="text-muted-foreground">
                        {providerLabel}
                      </span>
                      <span className="text-muted-foreground">
                        {formatDateTime(entry.at)}
                      </span>
                      <span>
                        {t("invoices.resyncHistory.byUser", { user: who })}
                      </span>
                      {entry.warningCount > 0 && (
                        <span style={{ color: "var(--brand-primary)" }}>
                          {t("invoices.resyncHistory.warnings", {
                            count: entry.warningCount,
                          })}
                        </span>
                      )}
                      {isMissing && entry.errorMessage && (
                        <span className="text-destructive">
                          {entry.errorMessage}
                        </span>
                      )}
                    </div>
                  );
                })}
                {(() => {
                  // "Show older" affordance — visible while another page
                  // of older events is known (or, before the first
                  // click, when the inline list was full and might be
                  // truncated). canManageBilling already gates the
                  // whole card; we still hide for partner sessions
                  // because the server returns 403 for them.
                  if (isPartner) return null;
                  const couldHaveMore = resyncPaged
                    ? nextResyncCursor !== null
                    : data.resyncHistory.length >= 10;
                  if (!couldHaveMore) return null;
                  return (
                    <div className="pt-1">
                      <PillButton
                        type="button"
                        color="image"
                        onClick={() => loadOlderResync()}
                        disabled={loadingOlderResync}
                        data-testid="button-resync-history-show-older"
                      >
                        {loadingOlderResync
                          ? t("invoices.resyncHistory.loadingOlder")
                          : t("invoices.resyncHistory.showOlder")}
                      </PillButton>
                    </div>
                  );
                })()}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {(data.sendLog.length > 0 || data.reminderLog.length > 0) && (
        <Card data-testid="card-history">
          <CardHeader>
            <CardTitle className="text-base">
              {t("invoices.history.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            {data.sendLog.map((s) => (
              <div
                key={`send-${s.id}`}
                className="flex justify-between border-b pb-2 last:border-0"
                data-testid={`row-sendlog-${s.id}`}
              >
                <div>
                  <div className="font-medium">
                    {t("invoices.history.sent")}: {s.sentToEmail ?? "—"}
                  </div>
                  {s.failureMessage && (
                    <div className="text-xs text-destructive">
                      {s.failureMessage}
                    </div>
                  )}
                </div>
                <div className="text-muted-foreground">
                  {formatDateTime(s.sentAt)}
                </div>
              </div>
            ))}
            {data.reminderLog.map((r) => (
              <div
                key={`rem-${r.id}`}
                className="flex justify-between border-b pb-2 last:border-0"
                data-testid={`row-reminder-${r.id}`}
              >
                <div>
                  <div className="font-medium">
                    {t(`invoices.history.reminder.${r.kind}`)}
                    {r.threshold ? ` · ${r.threshold}` : ""}
                  </div>
                  {r.notes && (
                    <div className="text-xs text-muted-foreground">
                      {r.notes}
                    </div>
                  )}
                  {r.failureMessage && (
                    <div className="text-xs text-destructive">
                      {r.failureMessage}
                    </div>
                  )}
                </div>
                <div className="text-muted-foreground">
                  {formatDateTime(r.sentAt)}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Forget push record confirm */}
      <AlertDialog
        open={forgetProvider !== null}
        onOpenChange={(open) => {
          if (!open) setForgetProvider(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-forget-push">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("invoices.forget.title", {
                provider:
                  forgetProvider === "qbo" ? "QuickBooks" : "OpenAccountant",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("invoices.forget.body", {
                provider:
                  forgetProvider === "qbo" ? "QuickBooks" : "OpenAccountant",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-forget-cancel">
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (forgetProvider) forgetPush.mutate(forgetProvider);
              }}
              disabled={forgetPush.isPending}
              data-testid="button-forget-confirm"
            >
              {t("invoices.forget.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Send modal */}
      <Dialog open={openSend} onOpenChange={setOpenSend}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("invoices.send.title")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="send-to">{t("invoices.send.to")}</Label>
              <Input
                id="send-to"
                value={sendTo}
                onChange={(e) => setSendTo(e.target.value)}
                placeholder="billing@partner.com"
                data-testid="input-send-to"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t("invoices.send.helper")}
              </p>
            </div>
          </div>
          <DialogFooter>
            <PillButton color="red" onClick={() => setOpenSend(false)}>
              {t("common.cancel")}
            </PillButton>
            <PillButton
              color="blue"
              onClick={() => sendInvoice.mutate()}
              disabled={sendInvoice.isPending}
              data-testid="button-confirm-send"
            >
              {t("invoices.send.confirm")}
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment modal */}
      <Dialog open={openPay} onOpenChange={setOpenPay}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("invoices.payment.title")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("invoices.payment.method")}</Label>
              <Select value={payMethod} onValueChange={setPayMethod}>
                <SelectTrigger data-testid="select-payment-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ach">
                    {t("invoices.method.ach")}
                  </SelectItem>
                  <SelectItem value="check">
                    {t("invoices.method.check")}
                  </SelectItem>
                  <SelectItem value="wire">
                    {t("invoices.method.wire")}
                  </SelectItem>
                  {!isPartner && (
                    <SelectItem value="credit_card">
                      {t("invoices.method.credit_card")}
                    </SelectItem>
                  )}
                  {!isPartner && (
                    <SelectItem value="cash">
                      {t("invoices.method.cash")}
                    </SelectItem>
                  )}
                  <SelectItem value="other">
                    {t("invoices.method.other")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {isPartner && (
              <p className="text-xs text-muted-foreground">
                {t("invoices.payment.partnerHint")}
              </p>
            )}
            <div>
              <Label htmlFor="pay-amount">
                {t("invoices.payment.amount")}
              </Label>
              <Input
                id="pay-amount"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                inputMode="decimal"
                data-testid="input-payment-amount"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t("invoices.balance.due")}: {formatMoney(data.balanceDue)}
              </p>
            </div>
            <div>
              <Label htmlFor="pay-date">{t("invoices.payment.date")}</Label>
              <Input
                id="pay-date"
                type="date"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                data-testid="input-payment-date"
              />
            </div>
            <div>
              <Label htmlFor="pay-ref">
                {t("invoices.payment.reference")}
              </Label>
              <Input
                id="pay-ref"
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                data-testid="input-payment-ref"
              />
            </div>
            <div>
              <Label htmlFor="pay-notes">
                {t("invoices.payment.notes")}
              </Label>
              <Textarea
                id="pay-notes"
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                rows={2}
                data-testid="input-payment-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <PillButton color="red" onClick={() => setOpenPay(false)}>
              {t("common.cancel")}
            </PillButton>
            <PillButton
              color="blue"
              onClick={() => recordPayment.mutate()}
              disabled={recordPayment.isPending}
              data-testid="button-confirm-payment"
            >
              {t("invoices.payment.confirm")}
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Credit memo modal */}
      <Dialog open={openCredit} onOpenChange={setOpenCredit}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("invoices.credit.title")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="credit-amount">
                {t("invoices.credit.amount")}
              </Label>
              <Input
                id="credit-amount"
                value={creditAmount}
                onChange={(e) => setCreditAmount(e.target.value)}
                inputMode="decimal"
                data-testid="input-credit-amount"
              />
            </div>
            <div>
              <Label htmlFor="credit-reason">
                {t("invoices.credit.reason")}
              </Label>
              <Textarea
                id="credit-reason"
                value={creditReason}
                onChange={(e) => setCreditReason(e.target.value)}
                rows={3}
                data-testid="input-credit-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <PillButton color="red" onClick={() => setOpenCredit(false)}>
              {t("common.cancel")}
            </PillButton>
            <PillButton
              color="blue"
              onClick={() => addCredit.mutate()}
              disabled={addCredit.isPending}
              data-testid="button-confirm-credit"
            >
              {t("invoices.credit.confirm")}
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reminder modal */}
      <Dialog open={openRemind} onOpenChange={setOpenRemind}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("invoices.remind.title")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="remind-note">
                {t("invoices.remind.note")}
              </Label>
              <Textarea
                id="remind-note"
                value={remindNote}
                onChange={(e) => setRemindNote(e.target.value)}
                rows={3}
                data-testid="input-remind-note"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t("invoices.remind.helper")}
              </p>
            </div>
          </div>
          <DialogFooter>
            <PillButton color="red" onClick={() => setOpenRemind(false)}>
              {t("common.cancel")}
            </PillButton>
            <PillButton
              color="blue"
              onClick={() => sendReminder.mutate()}
              disabled={sendReminder.isPending}
              data-testid="button-confirm-remind"
            >
              {t("invoices.remind.confirm")}
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// 1099 form-routing presentation helpers
// ──────────────────────────────────────────────────────────────────

function formatMoneyNumber(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

// Top-of-page banner that lists every line whose 1099 income category
// looks implausible for its line type. Each row has a "Fix" link that
// opens the inline editor for that line and scrolls it into view, so
// the admin can correct the category without leaving the page.
//
// Read-only viewers (partner / non-draft state) still see the warning
// but the inline-edit Fix button is hidden because the line-level PATCH
// endpoint is gated on the draft state.
function SuspectCategoryBanner({
  suspectLines,
  isDraft,
  onFix,
}: {
  suspectLines: { line: InvoiceLine; suggested: IncomeCategory[] }[];
  isDraft: boolean;
  onFix: (line: InvoiceLine) => void;
}) {
  const { t } = useTranslation();
  return (
    <Card
      style={{
        borderColor: "color-mix(in srgb, var(--brand-primary) 40%, white)",
        backgroundColor: "color-mix(in srgb, var(--brand-primary) 8%, white)",
      }}
      data-testid="card-suspect-category-banner"
    >
      <CardHeader>
        <CardTitle
          className="text-base flex items-center gap-2"
          style={{ color: "var(--brand-primary)" }}
        >
          <AlertTriangle className="w-4 h-4" />
          {t("invoices.suspectCategory.title", { count: suspectLines.length })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p style={{ color: "color-mix(in srgb, var(--brand-primary) 85%, black)" }}>
          {t("invoices.suspectCategory.helper")}
        </p>
        <ul
          className="divide-y"
          style={{ borderColor: "color-mix(in srgb, var(--brand-primary) 25%, white)" }}
        >
          {suspectLines.map(({ line, suggested }) => (
            <li
              key={line.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
              data-testid={`row-suspect-line-${line.id}`}
            >
              <span
                className="text-xs uppercase font-mono"
                style={{ color: "var(--brand-primary)" }}
              >
                {line.lineType}
              </span>
              <span className="truncate max-w-[24rem]">
                {line.description}
              </span>
              <Badge variant="outline" className="text-[11px]">
                {t(`invoices.incomeCategory.${line.incomeCategory}`)}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {t("invoices.suspectCategory.suggest", {
                  list: suggested
                    .map((c) => t(`invoices.incomeCategory.${c}`))
                    .join(", "),
                })}
              </span>
              {isDraft && (
                <PillButton
                  color="image"
                  className="ml-auto"
                  onClick={() => onFix(line)}
                  data-testid={`button-fix-suspect-line-${line.id}`}
                >
                  {t("invoices.suspectCategory.fix")}
                </PillButton>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// Per-row warning chip rendered alongside the form-routing badges in
// the read-only view of an invoice line. Clicking the chip (when in
// draft) opens the inline editor for that line.
function SuspectCategoryIndicator({
  lineType,
  category,
  lineId,
  isDraft,
  onFix,
}: {
  lineType: string;
  category: IncomeCategory;
  lineId: number;
  isDraft: boolean;
  onFix: () => void;
}) {
  const { t } = useTranslation();
  const m = suspectMatch(lineType, category);
  if (!m.suspect) return null;
  const suggestedList = m.suggested
    .map((c) => t(`invoices.incomeCategory.${c}`))
    .join(", ");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {isDraft ? (
          <button
            type="button"
            onClick={onFix}
            className="inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"
            style={{ color: "var(--brand-primary)" }}
            data-testid={`badge-suspect-line-${lineId}`}
          >
            <AlertTriangle className="w-3 h-3" />
            {t("invoices.suspectCategory.indicator")}
          </button>
        ) : (
          <span
            className="inline-flex items-center gap-1 text-xs font-medium"
            style={{ color: "var(--brand-primary)" }}
            data-testid={`badge-suspect-line-${lineId}`}
          >
            <AlertTriangle className="w-3 h-3" />
            {t("invoices.suspectCategory.indicator")}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-1 max-w-xs">
          <div className="font-semibold">
            {t("invoices.suspectCategory.tooltipTitle")}
          </div>
          <div>
            {t("invoices.suspectCategory.tooltipBody", {
              lineType,
              suggested: suggestedList,
            })}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function FormBadge({
  form,
  flagged = false,
  testIdPrefix,
}: {
  form: Form1099;
  flagged?: boolean;
  testIdPrefix: string;
}) {
  const { t } = useTranslation();
  return (
    <Badge
      variant={flagged ? "destructive" : "outline"}
      className="gap-1"
      data-testid={`${testIdPrefix}-${form}`}
    >
      {flagged && <AlertTriangle className="w-3 h-3" />}
      {t(`invoices.form1099.${form}`)}
    </Badge>
  );
}

function FormRoutingBadges({
  routing,
  lineId,
}: {
  routing: ReturnType<typeof routeLine> | undefined;
  lineId: number;
}) {
  const { t } = useTranslation();
  if (!routing) return null;

  // No-amount lines (e.g. zero-quantity placeholders) — nothing to route.
  if (routing.effective.length === 0) return null;

  // Happy path: one effective form and it matches the planned form.
  // Render a single neutral badge.
  const single =
    routing.effective.length === 1 &&
    routing.effective[0].form === routing.plannedForm;
  if (single) {
    return (
      <FormBadge
        form={routing.plannedForm}
        testIdPrefix={`badge-form-line-${lineId}`}
      />
    );
  }

  // Divergence — line is split across forms or routes to a different
  // form than its category implies. Render every effective form with a
  // warning style and a tooltip explaining the routing.
  const tipBody = routing.effective
    .map(
      (a) =>
        `${t(`invoices.form1099.${a.form}`)}: ${formatMoneyNumber(a.amount)}`,
    )
    .join(" · ");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex flex-wrap gap-1 cursor-help"
          data-testid={`badge-form-flag-line-${lineId}`}
        >
          {routing.effective.map((a) => (
            <FormBadge
              key={a.form}
              form={a.form}
              flagged
              testIdPrefix={`badge-form-line-${lineId}`}
            />
          ))}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-1">
          <div className="font-semibold">
            {t("invoices.form1099.flagTitle")}
          </div>
          <div>
            {t("invoices.form1099.flagBody", {
              planned: t(`invoices.form1099.${routing.plannedForm}`),
            })}
          </div>
          <div className="text-[11px] opacity-90">{tipBody}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function FormRoutingSummary({
  totals,
}: {
  totals: Record<Form1099, number>;
}) {
  const { t } = useTranslation();
  const populated = FORMS_1099.filter((f) => totals[f] > 0);
  // Always render the card so users know which form(s) the invoice
  // contributes to even when only `none` (non-reportable) applies.
  const reportableTotal = FORMS_1099
    .filter((f) => f !== "none")
    .reduce((s, f) => s + totals[f], 0);

  return (
    <Card data-testid="card-form1099-summary">
      <CardHeader>
        <CardTitle className="text-base">
          {t("invoices.form1099.summaryTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {t("invoices.form1099.summaryHelper")}
        </p>
        {populated.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {t("invoices.form1099.summaryEmpty")}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {populated.map((f) => (
              <div
                key={f}
                className="flex items-center justify-between border rounded-md px-3 py-2"
                data-testid={`row-form1099-${f}`}
              >
                <FormBadge form={f} testIdPrefix="badge-form-summary" />
                <span className="font-medium tabular-nums">
                  {formatMoneyNumber(totals[f])}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-end text-xs text-muted-foreground tabular-nums pt-1">
          {t("invoices.form1099.reportableTotal")}:{" "}
          {formatMoneyNumber(reportableTotal)}
        </div>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────
// LateFeeOverrideCard
// ──────────────────────────────────────────────────────────────────
//
// Per-invoice late-fee override editor for admins / owning vendor.
// Three states the editor distinguishes:
//   - "default"  → wire = `null`. Clear the column and let the
//                  per-(vendor, partner) billing-settings rule decide.
//   - "none"     → wire = `{kind:"none"}`. Explicitly disable the fee
//                  for this invoice even if the vendor default would
//                  fire one.
//   - "flat" / "percent" → the active override.
//
// Effective rule shown beneath the editor reflects what the aging
// worker will actually apply (per-invoice override else billing-settings
// default). Computed server-side and surfaced as `effectiveLateFeeRule`
// on the invoice payload so a single source of truth drives both
// scanner behavior and the UI.
type LateFeeKind = "default" | "none" | "flat" | "percent";
type LateFeeEditorState = {
  kind: LateFeeKind;
  amount: string;
  rate: string;
  afterDays: string;
};

function ruleToEditor(rule: LateFeeRuleClient | null): LateFeeEditorState {
  if (rule === null) {
    return { kind: "default", amount: "", rate: "", afterDays: "0" };
  }
  if (rule.kind === "none") {
    return { kind: "none", amount: "", rate: "", afterDays: "0" };
  }
  if (rule.kind === "flat") {
    return {
      kind: "flat",
      amount: rule.amount,
      rate: "",
      afterDays: String(rule.afterDays),
    };
  }
  return {
    kind: "percent",
    amount: "",
    rate: rule.rate,
    afterDays: String(rule.afterDays),
  };
}

function editorToWire(
  s: LateFeeEditorState,
): LateFeeRuleClient | null | "invalid" {
  if (s.kind === "default") return null;
  if (s.kind === "none") return { kind: "none" };
  const days = Number(s.afterDays);
  if (!Number.isInteger(days) || days < 0 || days > 365) return "invalid";
  if (s.kind === "flat") {
    if (!/^\d+(\.\d{1,2})?$/.test(s.amount)) return "invalid";
    return { kind: "flat", amount: s.amount, afterDays: days };
  }
  if (!/^\d+(\.\d{1,4})?$/.test(s.rate)) return "invalid";
  return { kind: "percent", rate: s.rate, afterDays: days };
}

function LateFeeOverrideCard({
  invoiceId,
  override,
  effective,
  status,
}: {
  invoiceId: number;
  override: LateFeeRuleClient | null;
  effective: LateFeeRuleClient | null;
  status: InvoiceDetail["status"];
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [state, setState] = useState<LateFeeEditorState>(() =>
    ruleToEditor(override),
  );
  // Re-sync the dirty-check baseline when the server payload changes
  // (after a successful save invalidates the query). Without this, a
  // stale baseline would keep "Save" disabled or enabled incorrectly.
  const baselineJson = useMemo(
    () => JSON.stringify(ruleToEditor(override)),
    [override],
  );
  const dirty = JSON.stringify(state) !== baselineJson;

  const disabled = status === "cancelled";

  const save = useMutation({
    mutationFn: async () => {
      const wire = editorToWire(state);
      if (wire === "invalid") {
        throw new Error(t("invoices.lateFee.invalid"));
      }
      const res = await fetch(
        `${API_BASE}/api/invoices/${invoiceId}/late-fee-rule`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lateFeeRule: wire }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      }
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices", "detail", invoiceId] });
      toast({ title: t("invoices.lateFee.savedToast") });
    },
    onError: (err: Error) =>
      toast({
        title: translateApiError(
          err,
          t,
          t("invoices.lateFee.saveFailedToast"),
        ),
        variant: "destructive",
      }),
  });

  const effectiveCopy = (() => {
    if (!effective || effective.kind === "none") {
      return t("invoices.lateFee.effectiveNone");
    }
    if (effective.kind === "flat") {
      return t("invoices.lateFee.effectiveFlat", {
        amount: effective.amount,
        days: effective.afterDays,
      });
    }
    return t("invoices.lateFee.effectivePercent", {
      rate: effective.rate,
      days: effective.afterDays,
    });
  })();

  return (
    <Card data-testid="card-late-fee-override">
      <CardHeader>
        <CardTitle className="text-base">
          {t("invoices.lateFee.heading")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("invoices.lateFee.helper")}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 max-w-xs">
          <Label htmlFor={`late-fee-kind-${invoiceId}`}>
            {t("invoices.lateFee.kindLabel")}
          </Label>
          <Select
            value={state.kind}
            disabled={disabled}
            onValueChange={(v) =>
              setState((cur) => ({ ...cur, kind: v as LateFeeKind }))
            }
          >
            <SelectTrigger
              id={`late-fee-kind-${invoiceId}`}
              data-testid="select-invoice-late-fee-kind"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">
                {t("invoices.lateFee.useDefault")}
              </SelectItem>
              <SelectItem value="none">
                {t("invoices.lateFee.kind.none")}
              </SelectItem>
              <SelectItem value="flat">
                {t("invoices.lateFee.kind.flat")}
              </SelectItem>
              <SelectItem value="percent">
                {t("invoices.lateFee.kind.percent")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {state.kind === "flat" && (
          <div className="space-y-2 max-w-xs">
            <Label htmlFor={`late-fee-amount-${invoiceId}`}>
              {t("invoices.lateFee.amountLabel")}
            </Label>
            <Input
              id={`late-fee-amount-${invoiceId}`}
              inputMode="decimal"
              value={state.amount}
              disabled={disabled}
              placeholder="25.00"
              onChange={(e) =>
                setState((cur) => ({ ...cur, amount: e.target.value }))
              }
              data-testid="input-invoice-late-fee-amount"
            />
          </div>
        )}

        {state.kind === "percent" && (
          <div className="space-y-2 max-w-xs">
            <Label htmlFor={`late-fee-rate-${invoiceId}`}>
              {t("invoices.lateFee.rateLabel")}
            </Label>
            <Input
              id={`late-fee-rate-${invoiceId}`}
              inputMode="decimal"
              value={state.rate}
              disabled={disabled}
              placeholder="1.50"
              onChange={(e) =>
                setState((cur) => ({ ...cur, rate: e.target.value }))
              }
              data-testid="input-invoice-late-fee-rate"
            />
          </div>
        )}

        {(state.kind === "flat" || state.kind === "percent") && (
          <div className="space-y-2 max-w-xs">
            <Label htmlFor={`late-fee-after-days-${invoiceId}`}>
              {t("invoices.lateFee.afterDaysLabel")}
            </Label>
            <Input
              id={`late-fee-after-days-${invoiceId}`}
              inputMode="numeric"
              value={state.afterDays}
              disabled={disabled}
              placeholder="0"
              onChange={(e) =>
                setState((cur) => ({ ...cur, afterDays: e.target.value }))
              }
              data-testid="input-invoice-late-fee-after-days"
            />
          </div>
        )}

        <div
          className="text-sm text-muted-foreground"
          data-testid="text-effective-late-fee"
        >
          <span className="font-medium text-foreground">
            {t("invoices.lateFee.effective")}
          </span>{" "}
          {effectiveCopy}
        </div>

        <div className="flex justify-end">
          <PillButton
            color="blue"
            onClick={() => save.mutate()}
            disabled={disabled || !dirty || save.isPending}
            data-testid="button-save-invoice-late-fee"
          >
            {save.isPending
              ? t("invoices.lateFee.saving")
              : t("invoices.lateFee.save")}
          </PillButton>
        </div>
      </CardContent>
    </Card>
  );
}
