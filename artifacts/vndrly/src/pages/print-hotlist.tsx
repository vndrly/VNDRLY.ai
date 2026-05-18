import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useGetPartner,
  getGetPartnerQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { hotlistApi, isVendorListResponse, type HotlistJobRow } from "@/lib/hotlist-api";
import { getBrandColors, hexToRgb } from "@/lib/brand-colors";

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  pending: "Pending",
  awarded: "Awarded",
  declined: "Declined",
  closed: "Closed",
};

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "open", label: "Open" },
  { value: "pending", label: "Pending" },
  { value: "awarded", label: "Awarded" },
  { value: "declined", label: "Declined" },
  { value: "closed", label: "Closed" },
];

type DeadlineWindow = "all" | "overdue" | "this-week" | "next-30" | "no-deadline";

const DEADLINE_OPTIONS: Array<{ value: DeadlineWindow; label: string }> = [
  { value: "all", label: "Any deadline" },
  { value: "overdue", label: "Overdue" },
  { value: "this-week", label: "Due this week (next 7 days)" },
  { value: "next-30", label: "Due in next 30 days" },
  { value: "no-deadline", label: "No deadline" },
];

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDeadline(s: string | null): Date | null {
  if (!s) return null;
  // Hotlist deadlines are ISO date strings (YYYY-MM-DD) — parse as local midnight.
  const [y, m, d] = s.split("-").map((p) => parseInt(p, 10));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function jobMatchesDeadlineWindow(job: HotlistJobRow, window: DeadlineWindow): boolean {
  if (window === "all") return true;
  const today = startOfToday();
  const dl = parseDeadline(job.deadline);
  if (window === "no-deadline") return dl == null;
  if (dl == null) return false;
  if (window === "overdue") return dl.getTime() < today.getTime();
  const diffDays = Math.floor((dl.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (window === "this-week") return diffDays >= 0 && diffDays <= 7;
  if (window === "next-30") return diffDays >= 0 && diffDays <= 30;
  return true;
}

function deadlineWindowLabel(window: DeadlineWindow): string {
  return DEADLINE_OPTIONS.find((o) => o.value === window)?.label ?? "Any deadline";
}

function statusFilterLabel(selected: Set<string>): string {
  if (selected.size === 0) return "No statuses";
  if (selected.size === STATUS_OPTIONS.length) return "All statuses";
  return STATUS_OPTIONS.filter((o) => selected.has(o.value))
    .map((o) => o.label)
    .join(", ");
}

export default function PrintHotlistPage() {
  const { user } = useAuth();
  const partnerId = user?.role === "partner" ? user.partnerId ?? null : null;

  const { data: partner, isLoading: partnerLoading } = useGetPartner(partnerId ?? 0, {
    query: { enabled: !!partnerId, queryKey: getGetPartnerQueryKey(partnerId ?? 0) },
  });

  const { data: list, isLoading: jobsLoading, isError } = useQuery({
    queryKey: ["hotlist", "list", "print", user?.role, partnerId],
    queryFn: () => hotlistApi.list(),
    enabled: !!user,
  });

  const jobs: HotlistJobRow[] = useMemo(() => {
    if (!list) return [];
    if (Array.isArray(list)) return list;
    if (isVendorListResponse(list)) return list.jobs;
    return [];
  }, [list]);

  const partnerName = partner?.name ?? null;
  const { primary: primaryColor, accent: accentColor } = getBrandColors(partner);

  const [statusFilter, setStatusFilter] = useState<Set<string>>(
    () => new Set(STATUS_OPTIONS.map((o) => o.value)),
  );
  const [deadlineWindow, setDeadlineWindow] = useState<DeadlineWindow>("all");

  const filteredJobs = useMemo(() => {
    return jobs.filter(
      (j) =>
        statusFilter.has(j.status) && jobMatchesDeadlineWindow(j, deadlineWindow),
    );
  }, [jobs, statusFilter, deadlineWindow]);

  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    parts.push(`Status: ${statusFilterLabel(statusFilter)}`);
    if (deadlineWindow !== "all") {
      parts.push(`Deadline: ${deadlineWindowLabel(deadlineWindow)}`);
    }
    return parts.join("  •  ");
  }, [statusFilter, deadlineWindow]);

  const ready = !jobsLoading && (!partnerId || !partnerLoading);

  const toggleStatus = (value: string) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const [downloading, setDownloading] = useState(false);

  const handleDownloadPdf = async () => {
    setDownloading(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "in", format: "letter", orientation: "portrait" });
      const pageW = 8.5;
      const pageH = 11;
      const margin = 0.5;
      const contentW = pageW - margin * 2;
      const left = margin;
      const right = pageW - margin;

      const [pr, pg, pb] = hexToRgb(primaryColor);
      const [ar, ag, ab] = hexToRgb(accentColor);

      const drawFrame = () => {
        doc.setLineWidth(0.05);
        doc.setDrawColor(pr, pg, pb);
        doc.roundedRect(left, margin, contentW, pageH - margin * 2, 0.08, 0.08, "S");
      };

      drawFrame();
      let y = margin + 0.4;

      doc.setFont("helvetica", "bold");
      doc.setTextColor(pr, pg, pb);
      doc.setFontSize(22);
      const heading = partnerName ? `${partnerName} — Hotlist` : "Hotlist";
      doc.text(heading, pageW / 2, y, { align: "center", maxWidth: contentW - 0.4 });
      y += 0.3;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(80);
      doc.text(
        `${filteredJobs.length} job${filteredJobs.length === 1 ? "" : "s"}  •  Generated ${new Date().toLocaleDateString()}`,
        pageW / 2,
        y,
        { align: "center" },
      );
      y += 0.22;

      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.setTextColor(110);
      const summaryLines = doc.splitTextToSize(
        `Filters — ${filterSummary}`,
        contentW - 0.6,
      ) as string[];
      doc.text(summaryLines, pageW / 2, y, { align: "center" });
      y += 0.16 * summaryLines.length + 0.08;

      doc.setDrawColor(ar, ag, ab);
      doc.setLineWidth(0.03);
      doc.line(left + 0.3, y, right - 0.3, y);
      y += 0.25;

      const ensureSpace = (needed: number) => {
        if (y + needed > pageH - margin - 0.6) {
          doc.addPage();
          drawFrame();
          y = margin + 0.4;
        }
      };

      if (filteredJobs.length === 0) {
        doc.setFont("helvetica", "italic");
        doc.setTextColor(120);
        doc.setFontSize(12);
        doc.text("No hotlist jobs match the selected filters.", pageW / 2, y + 0.4, { align: "center" });
      } else {
        for (const job of filteredJobs) {
          ensureSpace(1.2);

          doc.setFont("helvetica", "bold");
          doc.setTextColor(pr, pg, pb);
          doc.setFontSize(13);
          const titleLines = doc.splitTextToSize(job.title, contentW - 1.6) as string[];
          doc.text(titleLines, left + 0.3, y);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(10);
          doc.setTextColor(ar, ag, ab);
          doc.text(STATUS_LABELS[job.status] ?? job.status, right - 0.3, y, { align: "right" });
          y += 0.18 * titleLines.length + 0.04;

          doc.setFont("helvetica", "normal");
          doc.setTextColor(60);
          doc.setFontSize(10);
          const meta: string[] = [];
          meta.push(job.locationAddress);
          if (job.deadline) meta.push(`Deadline: ${job.deadline}`);
          if (job.estimatedDurationDays != null) meta.push(`${job.estimatedDurationDays}d`);
          if (job.bidCount != null) meta.push(`${job.bidCount} bid${job.bidCount === 1 ? "" : "s"}`);
          const metaLines = doc.splitTextToSize(meta.join("  •  "), contentW - 0.6) as string[];
          doc.text(metaLines, left + 0.3, y);
          y += 0.16 * metaLines.length + 0.04;

          if (job.description) {
            doc.setTextColor(40);
            const descLines = doc.splitTextToSize(job.description, contentW - 0.6) as string[];
            const trimmed = descLines.slice(0, 4);
            doc.text(trimmed, left + 0.3, y);
            y += 0.16 * trimmed.length + 0.06;
          }

          doc.setDrawColor(220);
          doc.setLineWidth(0.01);
          doc.line(left + 0.3, y, right - 0.3, y);
          y += 0.2;
        }
      }

      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        const footerY = pageH - margin - 0.3;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(120);
        const footer = partnerName
          ? `${partnerName}  •  Page ${i} of ${totalPages}`
          : `Page ${i} of ${totalPages}`;
        doc.text(footer, pageW / 2, footerY, { align: "center" });
      }

      const safe = (partnerName ?? "hotlist").replace(/[^a-zA-Z0-9_-]+/g, "_");
      doc.save(`${safe}-hotlist.pdf`);
    } finally {
      setDownloading(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>
    );
  }
  if (isError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-8 text-center" data-testid="print-hotlist-error">
        <p className="text-lg font-semibold">Unable to load hotlist</p>
        <button onClick={() => window.location.reload()} className="px-4 py-2 rounded bg-amber-500 text-white font-semibold hover:bg-amber-600">Retry</button>
      </div>
    );
  }
  if (!ready) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-white text-black flex flex-col items-center p-8 print:p-0" data-testid="print-hotlist-page">
      <style>{`
        @media print {
          @page { size: Letter portrait; margin: 0.5in; }
          body { background: white !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print w-full max-w-2xl mb-4 space-y-3" data-testid="print-hotlist-filters">
        <div className="rounded-md border border-gray-200 bg-gray-50 p-4 space-y-3">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-gray-800">Filters</h2>
            <p className="text-xs text-gray-500" data-testid="text-filtered-count">
              Showing {filteredJobs.length} of {jobs.length} job{jobs.length === 1 ? "" : "s"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-700 mb-1">Status</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {STATUS_OPTIONS.map((opt) => (
                <label key={opt.value} className="inline-flex items-center gap-1.5 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={statusFilter.has(opt.value)}
                    onChange={() => toggleStatus(opt.value)}
                    data-testid={`checkbox-status-${opt.value}`}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1" htmlFor="deadline-window">
              Deadline
            </label>
            <select
              id="deadline-window"
              value={deadlineWindow}
              onChange={(e) => setDeadlineWindow(e.target.value as DeadlineWindow)}
              className="w-full sm:w-auto rounded border border-gray-300 bg-white px-2 py-1 text-sm"
              data-testid="select-deadline-window"
            >
              {DEADLINE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={() => window.print()} className="px-4 py-2 rounded bg-amber-500 text-white font-semibold hover:bg-amber-600" data-testid="button-trigger-print">Print</button>
          <button onClick={handleDownloadPdf} disabled={downloading} className="px-4 py-2 rounded bg-black text-white font-semibold hover:bg-gray-800 disabled:opacity-60 disabled:cursor-not-allowed" data-testid="button-download-pdf">
            {downloading ? "Preparing..." : "Download PDF"}
          </button>
          <button onClick={() => window.close()} className="px-4 py-2 rounded border border-gray-300 hover:bg-gray-100" data-testid="button-close">Close</button>
        </div>
      </div>

      <div
        className="w-full max-w-2xl border-4 rounded-lg p-8 bg-white"
        style={{ borderColor: primaryColor }}
        data-testid="hotlist-printable"
      >
        <h1 className="text-2xl font-extrabold tracking-tight text-center" style={{ color: primaryColor }}>
          {partnerName ? `${partnerName} — Hotlist` : "Hotlist"}
        </h1>
        <p className="text-sm text-gray-600 text-center mt-1">
          {filteredJobs.length} job{filteredJobs.length === 1 ? "" : "s"} • Generated {new Date().toLocaleDateString()}
        </p>
        <p
          className="text-xs text-gray-500 text-center italic mt-1"
          data-testid="text-filter-summary"
        >
          Filters — {filterSummary}
        </p>

        <hr className="my-4" style={{ borderColor: accentColor }} />

        {filteredJobs.length === 0 ? (
          <p className="text-center text-gray-500 italic py-8" data-testid="text-no-jobs">
            {jobs.length === 0
              ? "No hotlist jobs to display."
              : "No hotlist jobs match the selected filters."}
          </p>
        ) : (
          <ul className="space-y-4">
            {filteredJobs.map((job) => (
              <li key={job.id} className="pb-4 border-b border-gray-200" data-testid={`hotlist-row-${job.id}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-base font-bold" style={{ color: primaryColor }}>{job.title}</h2>
                  <span className="text-xs font-semibold uppercase" style={{ color: accentColor }}>
                    {STATUS_LABELS[job.status] ?? job.status}
                  </span>
                </div>
                <p className="text-xs text-gray-700 mt-1">
                  {job.locationAddress}
                  {job.deadline ? ` • Deadline: ${job.deadline}` : ""}
                  {job.estimatedDurationDays != null ? ` • ${job.estimatedDurationDays}d` : ""}
                  {job.bidCount != null ? ` • ${job.bidCount} bid${job.bidCount === 1 ? "" : "s"}` : ""}
                </p>
                {job.description && (
                  <p className="text-sm mt-1 whitespace-pre-wrap">{job.description}</p>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 pt-4 border-t border-gray-300 text-xs text-gray-500 text-center">
          {partnerName ? <>{partnerName} • </> : null}
          Generated {new Date().toLocaleDateString()}
        </div>
      </div>
    </div>
  );
}
