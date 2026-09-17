import { ListChecks } from "lucide-react";

import PngPill, { PngPillButton } from "@/components/png-pill-rollover";

export default function HotlistCatalogFilterBar({
  includeAll,
  filteredCount,
  onShowAll,
  onFilter,
}: {
  includeAll: boolean;
  filteredCount: number;
  onShowAll: () => void;
  onFilter: () => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs" data-testid="hotlist-catalog-filter-bar">
      {includeAll ? (
        <>
          <PngPill rest data-testid="pill-catalog-all">
            <ListChecks className="h-3 w-3" />
            Showing all jobs
          </PngPill>
          <PngPillButton color="brand" onClick={onFilter} data-testid="button-filter-by-catalog">
            Filter to my services
          </PngPillButton>
        </>
      ) : (
        <>
          <PngPill
            color="brand"
            data-color="brand"
            data-testid="pill-catalog-filtered"
            aria-label="Only jobs matching your service catalog are shown"
          >
            <ListChecks className="h-3 w-3" />
            Filtered by your services
          </PngPill>
          {filteredCount > 0 ? (
            <span className="text-muted-foreground" data-testid="text-catalog-filtered-count">
              {filteredCount} hidden
            </span>
          ) : null}
          <PngPillButton color="brand" className="ml-auto" onClick={onShowAll} data-testid="button-show-all-jobs">
            Show all
          </PngPillButton>
        </>
      )}
    </div>
  );
}
