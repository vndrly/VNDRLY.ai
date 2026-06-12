import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Activity, AlertTriangle } from "lucide-react";
import ContentPaneBackLink from "@/components/content-pane-back-link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CARD_TITLE_ICON_CLASS,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBrand } from "@/hooks/use-brand";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type CatalogHealthResponse = {
  totals: {
    platformWorkTypes: number;
    vendorSelections: number;
    siteAssignments: number;
    approvals: number;
    vendorsWithCatalog: number;
  };
  issues: {
    platformWorkTypesWithoutVendors: { id: number; name: string }[];
    vendorSelectionsMissingPrice: {
      vendorId: number;
      vendorName: string;
      workTypeId: number;
    }[];
    siteAssignmentsWithoutCatalogRow: {
      siteLocationId: number;
      vendorId: number;
      workTypeId: number;
    }[];
  };
  issueCounts: {
    platformWorkTypesWithoutVendors: number;
    vendorSelectionsMissingPrice: number;
    siteAssignmentsWithoutCatalogRow: number;
  };
};

export default function CatalogHealthPage() {
  const { t } = useTranslation();
  const brand = useBrand();
  const iconStyle = { color: brand.isOrgBranded ? brand.primary : "#f59e0b" };

  const { data, isLoading, isError } = useQuery({
    queryKey: ["catalog-health"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/admin/catalog-health`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      return res.json() as Promise<CatalogHealthResponse>;
    },
  });

  return (
    <div className="p-6 space-y-6" data-testid="page-catalog-health">
      <div className="flex items-center gap-3">
        <ContentPaneBackLink href="/catalog" />
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className={CARD_TITLE_ICON_CLASS} style={iconStyle} />
            {t("catalogHealth.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("catalogHealth.subtitle")}
          </p>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : isError ? (
        <p className="text-destructive">{t("catalogHealth.loadError")}</p>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {(
              [
                ["platformWorkTypes", data.totals.platformWorkTypes],
                ["vendorSelections", data.totals.vendorSelections],
                ["siteAssignments", data.totals.siteAssignments],
                ["approvals", data.totals.approvals],
                ["vendorsWithCatalog", data.totals.vendorsWithCatalog],
              ] as const
            ).map(([key, value]) => (
              <Card key={key}>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">
                    {t(`catalogHealth.totals.${key}`)}
                  </div>
                  <div className="text-2xl font-bold tabular-nums">{value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className={CARD_TITLE_ICON_CLASS} style={iconStyle} />
                {t("catalogHealth.issuesTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <IssueBlock
                title={t("catalogHealth.noVendors")}
                count={data.issueCounts.platformWorkTypesWithoutVendors}
                items={data.issues.platformWorkTypesWithoutVendors.map(
                  (r) => r.name,
                )}
              />
              <IssueBlock
                title={t("catalogHealth.missingPrice")}
                count={data.issueCounts.vendorSelectionsMissingPrice}
                items={data.issues.vendorSelectionsMissingPrice.map(
                  (r) => `${r.vendorName} · work type #${r.workTypeId}`,
                )}
              />
              <IssueBlock
                title={t("catalogHealth.swaWithoutCatalog")}
                count={data.issueCounts.siteAssignmentsWithoutCatalogRow}
                items={data.issues.siteAssignmentsWithoutCatalogRow.map(
                  (r) =>
                    t("catalogHealth.swaRow", {
                      siteId: r.siteLocationId,
                      vendorId: r.vendorId,
                      workTypeId: r.workTypeId,
                    }),
                )}
              />
            </CardContent>
          </Card>

          <Link
            href="/catalog"
            className="text-sm text-[var(--brand-primary)] hover:underline"
          >
            {t("catalogHealth.backToCatalog")}
          </Link>
        </>
      ) : null}
    </div>
  );
}

function IssueBlock({
  title,
  count,
  items,
}: {
  title: string;
  count: number;
  items: string[];
}) {
  return (
    <div>
      <div className="font-medium">
        {title}{" "}
        <span className="text-muted-foreground font-normal">({count})</span>
      </div>
      {count === 0 ? (
        <p className="text-muted-foreground text-xs mt-1">—</p>
      ) : (
        <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground space-y-0.5">
          {items.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
