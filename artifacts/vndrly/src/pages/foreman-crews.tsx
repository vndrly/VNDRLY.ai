import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, Check, Plus, Trash2, Users, Save } from "lucide-react";
import { PngPillButton } from "@/components/png-pill-rollover";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import ContentPaneBackLink from "@/components/content-pane-back-link";
import { FIELD_OPS_PAGE_CLASS } from "@/lib/field-ops-content-pane";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface CoWorker {
  id: number;
  userId: number | null;
  firstName: string;
  lastName: string;
  vendorRole: string | null;
  jobTitle: string | null;
}

interface CrewPreset {
  id: number;
  name: string;
  memberEmployeeIds: number[];
}

function memberLabel(c: CoWorker): string {
  return `${c.firstName} ${c.lastName}`.trim();
}

export default function ForemanCrews() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [coWorkers, setCoWorkers] = useState<CoWorker[]>([]);
  const [presets, setPresets] = useState<CrewPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftName, setDraftName] = useState("");
  const [draftMemberIds, setDraftMemberIds] = useState<number[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [daysAhead, setDaysAhead] = useState<1 | 2 | 3>(1);
  const [batchBusy, setBatchBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [memberPickerOpen, setMemberPickerOpen] = useState(true);

  const coWorkerById = useMemo(() => {
    const m = new Map<number, CoWorker>();
    coWorkers.forEach((c) => m.set(c.id, c));
    return m;
  }, [coWorkers]);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [peopleRes, presetsRes] = await Promise.all([
        fetch(`${BASE}/api/field/co-workers`, { credentials: "include" }),
        fetch(`${BASE}/api/field/crew-presets`, { credentials: "include" }),
      ]);
      if (!peopleRes.ok || !presetsRes.ok) {
        const status = !peopleRes.ok ? peopleRes.status : presetsRes.status;
        setLoadError(String(status));
        setCoWorkers([]);
        setPresets([]);
        return;
      }
      setCoWorkers(await peopleRes.json());
      setPresets(await presetsRes.json());
    } catch {
      setLoadError("network");
      setCoWorkers([]);
      setPresets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resetDraft = () => {
    setDraftName("");
    setDraftMemberIds([]);
    setEditingId(null);
  };

  const startEdit = (preset: CrewPreset) => {
    setEditingId(preset.id);
    setDraftName(preset.name);
    setDraftMemberIds(preset.memberEmployeeIds);
  };

  const toggleMember = (id: number) => {
    setDraftMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const savePreset = async () => {
    const name = draftName.trim();
    if (!name) {
      toast({ title: t("foremanCrews.nameRequired"), variant: "destructive" });
      return;
    }
    setSaveBusy(true);
    try {
      const url = editingId
        ? `${BASE}/api/field/crew-presets/${editingId}`
        : `${BASE}/api/field/crew-presets`;
      const r = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, memberEmployeeIds: draftMemberIds }),
      });
      if (!r.ok) {
        const errBody = await r.json().catch(() => null);
        throw new Error(errBody?.message ?? String(r.status));
      }
      toast({ title: editingId ? t("foremanCrews.saved") : t("foremanCrews.created") });
      resetDraft();
      await load();
    } catch (err) {
      toast({
        title: t("common.error"),
        description: err instanceof Error ? err.message : t("common.tryAgain"),
        variant: "destructive",
      });
    } finally {
      setSaveBusy(false);
    }
  };

  const deletePreset = async (id: number) => {
    if (!window.confirm(t("foremanCrews.deleteConfirm"))) return;
    try {
      const r = await fetch(`${BASE}/api/field/crew-presets/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok && r.status !== 204) throw new Error(String(r.status));
      if (editingId === id) resetDraft();
      await load();
    } catch {
      toast({ title: t("common.error"), variant: "destructive" });
    }
  };

  const sendBatchReminders = async () => {
    setBatchBusy(true);
    try {
      const r = await fetch(`${BASE}/api/field/batch-schedule-reminders`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ daysAhead }),
      });
      const json = r.ok ? await r.json() : null;
      if (!r.ok || !json) throw new Error(String(r.status));
      toast({
        title: t("foremanCrews.batchSent"),
        description: t("foremanCrews.batchSentDetail", {
          tickets: json.ticketsProcessed ?? 0,
          people: json.notifiedUsers ?? 0,
        }),
      });
    } catch {
      toast({ title: t("common.error"), description: t("common.tryAgain"), variant: "destructive" });
    } finally {
      setBatchBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[color:var(--brand-primary)]" />
      </div>
    );
  }

  return (
    <div className={FIELD_OPS_PAGE_CLASS} data-testid="foreman-crews">
      <div className="flex items-center gap-3">
        <ContentPaneBackLink href="/foreman" />
        <div>
        <h1 className="text-2xl font-bold">{t("foremanCrews.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("foremanCrews.subtitle")}</p>
        {loadError ? (
          <p className="text-sm text-destructive mt-2">{t("foremanCrews.loadFailed")}</p>
        ) : null}
        </div>
      </div>

      <section className="rounded-xl border border-border bg-card p-4 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <Users className="w-4 h-4" />
          {t("foremanCrews.savedCrews")}
        </h2>

        {presets.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("foremanCrews.noPresets")}</p>
        ) : (
          <ul className="space-y-2">
            {presets.map((preset) => (
              <li
                key={preset.id}
                className={cn(
                  "rounded-lg border p-3 flex items-start gap-3",
                  editingId === preset.id ? "border-[color:var(--brand-primary)]" : "border-border",
                )}
              >
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">{preset.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {preset.memberEmployeeIds.length === 0
                      ? t("foremanCrews.noMembers")
                      : preset.memberEmployeeIds
                          .map((id) => coWorkerById.get(id))
                          .filter(Boolean)
                          .map((c) => memberLabel(c!))
                          .join(", ")}
                  </p>
                </div>
                <button
                  type="button"
                  className="text-xs font-medium text-[color:var(--brand-primary)]"
                  onClick={() => startEdit(preset)}
                >
                  {t("common.edit")}
                </button>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => void deletePreset(preset.id)}
                  aria-label={t("common.remove")}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-3 pt-2 border-t border-border">
          <Input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder={t("foremanCrews.presetNamePlaceholder")}
            data-testid="input-crew-preset-name"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              {t("foremanCrews.membersHeading", { count: draftMemberIds.length })}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="text-xs font-medium text-[color:var(--brand-primary)]"
                onClick={() => setMemberPickerOpen((open) => !open)}
                data-testid="button-toggle-crew-member-picker"
              >
                <span className="inline-flex items-center gap-1">
                  <Plus className="w-3.5 h-3.5" />
                  {memberPickerOpen ? t("foremanCrews.hideMembers") : t("foremanCrews.addMembers")}
                </span>
              </button>
              {coWorkers.length > 0 ? (
                <>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setDraftMemberIds(coWorkers.map((c) => c.id))}
                  >
                    {t("foremanCrews.selectAll")}
                  </button>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setDraftMemberIds([])}
                  >
                    {t("foremanCrews.clearMembers")}
                  </button>
                </>
              ) : null}
            </div>
          </div>
          {memberPickerOpen ? (
            coWorkers.length === 0 ? (
              <p className="text-sm text-muted-foreground rounded-lg border border-dashed border-border p-4">
                {t("foremanCrews.noCoWorkers")}
              </p>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {coWorkers.map((c) => {
                  const selected = draftMemberIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleMember(c.id)}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-3",
                        selected ? "bg-sidebar-accent" : "hover:bg-muted/50",
                      )}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span
                          className={cn(
                            "w-4 h-4 rounded border flex items-center justify-center shrink-0",
                            selected
                              ? "border-[color:var(--brand-primary)] bg-[color:var(--brand-primary)] text-white"
                              : "border-border bg-background",
                          )}
                        >
                          {selected ? <Check className="w-3 h-3" /> : null}
                        </span>
                        <span className="truncate">{memberLabel(c)}</span>
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {c.vendorRole ?? c.jobTitle ?? ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            )
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <PngPillButton
              color="blue"
              onClick={() => void savePreset()}
              disabled={saveBusy}
              data-testid="button-save-crew-preset"
            >
              <Save className="w-4 h-4 mr-1.5" />
              {editingId ? t("foremanCrews.updatePreset") : t("foremanCrews.createPreset")}
            </PngPillButton>
            {editingId ? (
              <button
                type="button"
                className="h-10 px-4 rounded-lg border border-border text-sm font-medium hover:bg-muted/50"
                onClick={resetDraft}
              >
                {t("common.cancel")}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <Bell className="w-4 h-4" />
          {t("foremanCrews.batchNotify")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("foremanCrews.batchNotifyHelp")}</p>
        <div className="flex gap-2">
          {([1, 2, 3] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDaysAhead(d)}
              className={cn(
                "flex-1 rounded-lg border py-2 text-sm font-medium",
                daysAhead === d
                  ? "border-[color:var(--brand-primary)] bg-sidebar-accent text-[color:var(--brand-primary)] drop-shadow-[0_1px_2px_rgba(0,0,0,0.125)]"
                  : "border-border text-muted-foreground",
              )}
            >
              {t(`foremanCrews.daysAhead${d}`)}
            </button>
          ))}
        </div>
        <PngPillButton
          color="blue"
          onClick={() => void sendBatchReminders()}
          disabled={batchBusy}
          data-testid="button-batch-schedule-remind"
        >
          <Bell className="w-4 h-4 mr-1.5" />
          {t("foremanCrews.sendBatch")}
        </PngPillButton>
      </section>
    </div>
  );
}
