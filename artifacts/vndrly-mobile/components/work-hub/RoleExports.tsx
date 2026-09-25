import React, { useEffect, useState } from "react";
import { Text } from "react-native";
import { ImplementationAExports } from "@/components/implementation-a/Exports";
import { apiFetch } from "@/lib/api";
import { useColors } from "@/hooks/useColors";
import { useTranslation } from "react-i18next";

type ExportDataset = "payroll" | "quickbooks-time" | "assets" | "staffing" | "safety";
const datasetNames: Record<ExportDataset, string> = {
  payroll: "payroll-hours",
  "quickbooks-time": "quickbooks-time",
  assets: "inventory-custody",
  staffing: "staffing",
  safety: "safety-response",
};

export function RoleExports({ owner, membershipId }: { owner: { type: "vendor" | "partner"; id: number }; membershipId?: number | null }) {
  const { t } = useTranslation();
  const colors = useColors();
  const scopeKey = `${membershipId ?? ""}:${owner.type}:${owner.id}`;
  const [access, setAccess] = useState<{ scopeKey: string; datasets: ExportDataset[] } | null>(null);
  useEffect(() => {
    let active = true;
    void apiFetch<{ capabilities?: { canViewExports?: boolean; allowedExportDatasets?: string[] } }>("/api/work-hub/home")
      .then((home) => {
        if (!active) return;
        const granted = home.capabilities?.canViewExports ? home.capabilities.allowedExportDatasets ?? [] : [];
        const datasets = (Object.keys(datasetNames) as ExportDataset[]).filter((dataset) => granted.includes(datasetNames[dataset]));
        setAccess({ scopeKey, datasets });
      })
      .catch(() => { if (active) setAccess({ scopeKey, datasets: [] }); });
    return () => { active = false; };
  }, [scopeKey]);
  if (!access || access.scopeKey !== scopeKey) return null;
  if (access.datasets.length === 0) return <Text style={{ color: colors.mutedForeground }}>{t("workHubExports.noAccess")}</Text>;
  return <ImplementationAExports owner={owner} allowedDatasets={access.datasets} />;
}
