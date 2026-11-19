import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { z } from "zod/v4";
import { AssignmentMetadataSchema } from "@workspace/api-zod";
import CertificationsSection from "./certifications-section";
import { ProfileRow } from "./gate-profile-chrome";
import { useLibrary } from "./work-hub/library/use-library";
import { formatTrainingTitle } from "@/lib/training-title";
import ImagePill from "./image-pill";
import { VndrlyUWordmark } from './work-hub/vndrly-u-wordmark';
import { certificationLogoStatuses } from '@/lib/certification-logo-status';

const progressSchema = z.object({ certifications: z.array(z.object({
  id: z.string(), title: z.string(), complete: z.boolean(), standalone: z.boolean().optional(), groupingOnly: z.boolean().optional(),
})) });

const trainingSchema = z.object({ items: z.array(z.object({
  instanceId: z.uuid(), title: z.string(), kind: z.string(),
  assignment: AssignmentMetadataSchema, href: z.string(), examPending: z.boolean().optional(),
  certifications: z.array(z.object({ id: z.uuid(), title: z.string() })).optional(),
  individuallyAssigned: z.boolean().optional(),
  completionPercent: z.number().min(0).max(100).optional(),
})) });
type TrainingItem = z.infer<typeof trainingSchema>["items"][number];

export default function ProfileCredentials({ employeeId }: { employeeId: number }) {
  const { i18n } = useTranslation();
  const c = (en: string, es: string) => i18n.language.startsWith("es") ? es : en;
  const [certificationsOpen, setCertificationsOpen] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  const [completedOpen, setCompletedOpen] = useState(false);
  const training = useLibrary("/api/work-hub/library/to-complete", value => trainingSchema.parse(value));
  const progress = useLibrary('/api/work-hub/repository/progress', value => progressSchema.parse(value));
  const programStatuses = certificationLogoStatuses(progress.data?.certifications ?? []);
  const items = training.data?.items.filter(item => item.kind === "training") ?? [];
  const assigned = items.filter(item => item.examPending || ["assigned", "in_progress"].includes(item.assignment.status));
  const completed = items.filter(item => item.assignment.status === "completed" && !item.examPending);
  const extra = assigned.filter(item => item.individuallyAssigned ?? !item.assignment.bundleId);
  const current = items.filter(item => !["cancelled", "exempted"].includes(item.assignment.status));
  const allExtra = current.filter(item => item.individuallyAssigned ?? !item.assignment.bundleId);
  const certifications = new Map<string, { title: string; courses: TrainingItem[] }>();
  for (const item of items.filter(item => !["cancelled", "exempted"].includes(item.assignment.status))) {
    const links = item.certifications ?? (item.assignment.bundleId
      ? [{ id: item.assignment.bundleId, title: c("Assigned certification", "Certificación asignada") }] : []);
    for (const link of links) {
      const group = certifications.get(link.id) ?? { title: link.title, courses: [] };
      if (!group.courses.some(course => course.instanceId === item.instanceId)) group.courses.push(item);
      certifications.set(link.id, group);
    }
  }
  const assignedCertifications = [...certifications.entries()].filter(([, group]) =>
    group.courses.some(course => assigned.some(item => item.instanceId === course.instanceId)));

  function percentage(item: TrainingItem) {
    return item.assignment.status === "completed" && !item.examPending ? 100 : Math.min(99, item.completionPercent ?? 0);
  }

  function completion(rows: TrainingItem[], label: string) {
    const unique = [...new Map(rows.map(item => [item.instanceId, item])).values()];
    const percent = unique.length ? Math.round(unique.reduce((sum, item) => sum + percentage(item), 0) / unique.length) : 0;
    const unfinished = unique.filter(item => percentage(item) < 100);
    const oldest = Math.max(0, ...unfinished.map(item => {
      const at = Date.parse(item.assignment.assignedAt);
      return Number.isFinite(at) ? Math.floor((Date.now() - at) / 86_400_000) : 0;
    }));
    const color = oldest > 90 ? "red" : oldest >= 60 ? "amber" : "green";
    return <ImagePill color={color} aria-label={label}>{percent}%</ImagePill>;
  }

  function list(rows: TrainingItem[], empty: string, showPercent = false) {
    if (training.error) return <p role="alert">{training.error}</p>;
    if (training.loading) return <p role="status">{c("Loading training…", "Cargando formación…")}</p>;
    if (!rows.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
    return <ul className="divide-y divide-white/10">{rows.map(item => <li key={item.instanceId} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2 text-sm">
      <Link href={item.href} className="min-w-0 break-words text-[var(--brand-primary)] underline underline-offset-4">{formatTrainingTitle(item.title)}</Link>
      {showPercent ? completion([item], `${formatTrainingTitle(item.title)} ${c("completion", "completado")}`) : <span className="text-xs text-muted-foreground">{item.examPending ? c("Final exam pending", "Examen final pendiente")
        : item.assignment.status === "in_progress" ? c("In progress", "En curso")
        : item.assignment.status === "completed" ? c("Completed", "Completado") : c("Assigned", "Asignado")}</span>}
    </li>)}</ul>;
  }

  return <CertificationsSection employeeId={employeeId} variant="inline" testIdPrefix="profile-self-certifications" programStatuses={programStatuses} profileTraining={{
    assigned: <section aria-label={c("My assigned training", "Mi formación asignada")}>
      <div className="flex min-h-11 items-center justify-between gap-3">
        <h3 className="text-sm font-semibold" aria-label={c("My assigned training", "Mi formación asignada")}><VndrlyUWordmark /></h3>
      </div>
      <div>
        <ProfileRow label={c("Assigned certifications", "Certificaciones asignadas")} open={certificationsOpen} onClick={() => setCertificationsOpen(value => !value)} trailing={completion([...certifications.values()].flatMap(group => group.courses), c("Assigned certifications completion", "Porcentaje de certificaciones asignadas"))} unframed>
          {training.error ? <p role="alert">{training.error}</p> : training.loading ? <p role="status">{c("Loading training…", "Cargando formación…")}</p>
            : assignedCertifications.length ? assignedCertifications.map(([id, group]) => <section key={id} aria-label={group.title}>
              <h4 className="py-2 text-sm font-semibold">{group.title}</h4>
              {list(group.courses, "")}
            </section>) : <p className="text-sm text-muted-foreground">{c("No assigned certifications.", "No hay certificaciones asignadas.")}</p>}
        </ProfileRow>
        <ProfileRow label={c("Extra training", "Formación adicional")} open={extraOpen} onClick={() => setExtraOpen(value => !value)} trailing={completion(allExtra, c("Extra training completion", "Porcentaje de formación adicional"))} unframed>
          {list(extra, c("No extra training.", "No hay formación adicional."), true)}
        </ProfileRow>
      </div>
    </section>,
    completed: <ProfileRow label={c("VNDRLY/U certifications", "Certificaciones de VNDRLY/U")} open={completedOpen} onClick={() => setCompletedOpen(value => !value)} unframed>
      {list(completed, c("No VNDRLY certifications yet.", "Aún no hay certificaciones de VNDRLY."))}
    </ProfileRow>,
    completedCount: completed.length,
  }} />;
}
