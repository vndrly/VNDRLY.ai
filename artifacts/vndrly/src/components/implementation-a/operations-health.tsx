import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { EmptyState, ImplementationSurface } from "./surface";

type Health = {
  status: "healthy" | "attention_required";
  checkedAt: string;
  signals: {
    offlineBacklog: number;
    terminalConflicts: number;
    permissionDenials: number;
    staleLocations: number;
    failedAlerts: number;
    unhealthyDisplays: number;
    missingSafetyChain: boolean;
    transcriptionAvailable: boolean;
  };
};

export function OperationsHealth({ admin = false }: { admin?: boolean }) {
  const { t } = useTranslation();
  const health = useQuery<Health>({
    queryKey: ["implementation-a", "operations-health"],
    queryFn: async () => {
      const response = await fetch("/api/implementation-a/operations-health", { credentials: "include" });
      if (!response.ok) throw new Error("Health unavailable");
      return response.json();
    },
    enabled: admin,
    refetchInterval: 30000,
  });
  const value = health.data;
  const status = value?.status === "healthy"
    ? t("implementationAOperations.healthy", { defaultValue: "Healthy" })
    : value?.status === "attention_required"
      ? t("implementationAOperations.attention", { defaultValue: "Attention required" })
      : t("implementationAOperations.checking", { defaultValue: "Checking" });
  return <ImplementationSurface
    module="operationsHealth"
    title={t("implementationAOperations.title", { defaultValue: "Operations Health" })}
    description={t("implementationAOperations.description", { defaultValue: "Delivery, synchronization, retention, and safety workflow status." })}
    preview={!admin}
  >
    {!admin ? <EmptyState>{t("implementationAOperations.adminOnly", { defaultValue: "Operations health is limited to company administrators." })}</EmptyState> : health.isError ? <p role="alert" className="rounded-lg border border-destructive p-4 text-sm">{t("implementationAOperations.unavailable", { defaultValue: "Operations health is unavailable. Try again shortly." })}</p> : <div className="space-y-4" aria-busy={health.isLoading}>
      <p role="status" className="font-semibold">{status}</p>
      {value ? <ul aria-label={t("implementationAOperations.signalList", { defaultValue: "Operations health signals" })} className="grid gap-3 sm:grid-cols-2">
        <Signal text={t("implementationAOperations.offlineBacklog", { defaultValue: "Offline changes waiting: {{count}}", count: value.signals.offlineBacklog })} attention={value.signals.offlineBacklog > 0} />
        <Signal text={t("implementationAOperations.terminalConflicts", { defaultValue: "Terminal conflicts: {{count}}", count: value.signals.terminalConflicts })} attention={value.signals.terminalConflicts > 0} />
        <Signal text={t("implementationAOperations.permissionDenials", { defaultValue: "Recent permission denials: {{count}}", count: value.signals.permissionDenials })} attention={value.signals.permissionDenials > 0} />
        <Signal text={t("implementationAOperations.staleLocations", { defaultValue: "Stale live locations: {{count}}", count: value.signals.staleLocations })} attention={value.signals.staleLocations > 0} />
        <Signal text={t("implementationAOperations.failedAlerts", { defaultValue: "Failed alerts: {{count}}", count: value.signals.failedAlerts })} attention={value.signals.failedAlerts > 0} />
        <Signal text={t("implementationAOperations.unhealthyDisplays", { defaultValue: "Displays needing attention: {{count}}", count: value.signals.unhealthyDisplays })} attention={value.signals.unhealthyDisplays > 0} />
        <Signal text={t("implementationAOperations.transcription", { defaultValue: "Meeting transcription: {{state}}", state: value.signals.transcriptionAvailable ? t("implementationAOperations.available") : t("implementationAOperations.unavailableState") })} attention={!value.signals.transcriptionAvailable} />
        <Signal text={t("implementationAOperations.safetyChain", { defaultValue: "Safety escalation chain: {{state}}", state: value.signals.missingSafetyChain ? t("implementationAOperations.missing") : t("implementationAOperations.configured") })} attention={value.signals.missingSafetyChain} />
      </ul> : null}
    </div>}
  </ImplementationSurface>;
}

function Signal({ text, attention }: { text: string; attention: boolean }) {
  return <li className="rounded-lg border p-3 text-sm"><span className="sr-only">{attention ? "Attention: " : "OK: "}</span><span>{text}</span></li>;
}