import { ListChecks } from "lucide-react";
import "./hotlist-catalog-filter-bar.css";

export default function HotlistCatalogFilterBar({
  includeAll, filteredCount, onShowAll, onFilter,
}: {
  includeAll: boolean;
  filteredCount: number;
  onShowAll: () => void;
  onFilter: () => void;
}) {
  return (
    <div className="hotlist-catalog-controls mb-3 flex flex-wrap items-center gap-2 text-xs" data-testid="hotlist-catalog-filter-bar">
      <button type="button" className="vendor-mini-card-button" aria-pressed={!includeAll} onClick={onFilter} data-testid="button-filter-by-catalog">
        <ListChecks className="h-3 w-3" aria-hidden="true" />
        {includeAll ? "Filter to my services" : <span data-color="brand" data-testid="pill-catalog-filtered">Filtered by your services</span>}
      </button>
      {!includeAll && filteredCount > 0 ? (
        <span className="text-muted-foreground" data-testid="text-catalog-filtered-count">{filteredCount} hidden</span>
      ) : null}
      <button type="button" className="vendor-mini-card-button ml-auto" aria-pressed={includeAll} onClick={onShowAll} data-testid="button-show-all-jobs">
        {includeAll ? <span data-testid="pill-catalog-all">Showing all jobs</span> : "Show all"}
      </button>
    </div>
  );
}
