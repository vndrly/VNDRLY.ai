import { CheckSquare2, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import BrandPillButton from "@/components/brand-pill-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BrandedSelect, WorkHubCardTitle } from "./chrome";

type Row = Record<string, any>;
const displayDate = (value: unknown) => value ? new Date(String(value)).toLocaleString() : "No date";

export default function ProjectTimeline({ items, canManage, onCreate }: { items: Row[]; canManage: boolean; onCreate: () => void }) {
  const [days, setDays] = useState("90");
  const [preview, setPreview] = useState<Row | null>(null);
  const projects = useMemo(() => {
    const end = Date.now() + Number(days) * 86_400_000;
    return items.filter((item) => item.calendarType === "project" && new Date(item.startsAt).getTime() <= end);
  }, [days, items]);

  return <>
    <Card className="border-2 border-[color:var(--brand-primary)] bg-white">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle><WorkHubCardTitle icon={CheckSquare2}>Project timeline</WorkHubCardTitle></CardTitle>
          <div className="flex items-center gap-2">
            <BrandedSelect aria-label="Project timeline range" value={days} onChange={(event) => setDays(event.target.value)}><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option></BrandedSelect>
            {canManage && <BrandPillButton tone="brand" onClick={onCreate}><Plus className="h-4 w-4" />Create Project</BrandPillButton>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {projects.map((item) => <button type="button" key={`timeline-${item.id}`} onClick={() => setPreview(item)} className="rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]" title={`${item.projectName ?? "Project"}: ${item.title}`}>
          <div className="flex justify-between gap-3"><div><span className="text-xs uppercase text-muted-foreground">{item.projectName} · {String(item.milestoneStatus ?? "upcoming").replaceAll("_", " ")}</span><h3 className="font-semibold text-black">{item.title}</h3><p className="text-xs">{displayDate(item.startsAt)} – {displayDate(item.endsAt)}</p></div><strong>{item.percentComplete ?? 0}%</strong></div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-[var(--brand-primary)]" style={{ width: `${Math.max(0, Math.min(100, Number(item.percentComplete ?? 0)))}%` }} /></div>
        </button>)}
        {!projects.length && <p className="py-6 text-center text-sm text-muted-foreground">No shared project milestones in this range.</p>}
      </CardContent>
    </Card>
    <Dialog open={Boolean(preview)} onOpenChange={(open) => { if (!open) setPreview(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{preview?.title}</DialogTitle><DialogDescription>{preview?.projectName ?? "Project milestone"}</DialogDescription></DialogHeader>
        {preview && <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Dates</dt><dd>{displayDate(preview.startsAt)} – {displayDate(preview.endsAt)}</dd></div><div><dt className="text-muted-foreground">Status</dt><dd>{String(preview.milestoneStatus ?? "upcoming").replaceAll("_", " ")}</dd></div><div><dt className="text-muted-foreground">Completion</dt><dd>{preview.percentComplete ?? 0}%</dd></div>{preview.siteName && <div><dt className="text-muted-foreground">Location</dt><dd>{preview.siteName}</dd></div>}{preview.instructions && <div className="sm:col-span-2"><dt className="text-muted-foreground">Instructions</dt><dd>{preview.instructions}</dd></div>}{preview.dependencyTitle && <div className="sm:col-span-2"><dt className="text-muted-foreground">Related handoff</dt><dd>{preview.dependencyTitle}</dd></div>}</dl>}
      </DialogContent>
    </Dialog>
  </>;
}
