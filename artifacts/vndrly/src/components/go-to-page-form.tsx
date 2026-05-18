import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { PillButton } from "@/components/pill";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface GoToPageFormProps {
  /** Total number of pages, 1-indexed. The form is hidden when this is <= 1. */
  totalPages: number;
  /** Disables the input and submit button (e.g. while a fetch is in flight). */
  disabled?: boolean;
  /**
   * Called with the user-entered page number after it has been clamped to
   * `[1, totalPages]` and truncated to an integer. The caller is responsible
   * for translating this 1-indexed value to whatever index its pagination
   * state uses (some tables use 0-indexed pages).
   */
  onGo: (page: number) => void;
  /**
   * Prefix used to derive stable `data-testid` and `id` attributes so each
   * form on the page is independently targetable from tests. e.g. `"audit"`
   * yields `form-audit-goto-page`, `input-audit-goto-page`, etc.
   */
  testIdPrefix: string;
  /** Optional override for the form's wrapper className. */
  className?: string;
}

/**
 * Inline "Go to page" jumper meant to live next to a table's prev/next
 * controls. Centralizes the parse-clamp-submit pattern shared across the
 * audit log, QuickBooks bulk-actions history, and per-action detail tables
 * so every paginated admin table behaves the same way:
 *
 * - Clamps to `1..totalPages` on submit.
 * - Silently ignores blank or non-numeric input (no error toast).
 * - Clears the draft after a successful submit.
 *
 * The component owns its own draft state so callers don't have to manage
 * it. Hidden when there's only one page since the jumper would be a no-op.
 */
export function GoToPageForm({
  totalPages,
  disabled = false,
  onGo,
  testIdPrefix,
  className,
}: GoToPageFormProps): ReactElement | null {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");

  if (totalPages <= 1) return null;

  const inputId = `${testIdPrefix}-goto-page`;

  return (
    <form
      // noValidate lets us silently accept-and-clamp out-of-range input
      // (e.g. an admin types "999" on a 5-page table) instead of letting
      // the browser block the submit and surface a native validation
      // bubble. The min/max attrs still drive the spinner UI on the
      // input itself.
      noValidate
      className={className ?? "flex items-center gap-2"}
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number(draft);
        if (!draft.trim() || !Number.isFinite(n)) {
          setDraft("");
          return;
        }
        const target = Math.min(totalPages, Math.max(1, Math.trunc(n)));
        onGo(target);
        setDraft("");
      }}
      data-testid={`form-${testIdPrefix}-goto-page`}
    >
      <Label htmlFor={inputId} className="text-xs text-muted-foreground">
        {t("common.pagination.goToPageLabel")}
      </Label>
      <Input
        id={inputId}
        type="number"
        inputMode="numeric"
        min={1}
        max={totalPages}
        placeholder={t("common.pagination.goToPagePlaceholder")}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="h-8 w-20"
        disabled={disabled}
        data-testid={`input-${testIdPrefix}-goto-page`}
      />
      <PillButton
        type="submit"
        color="image"
        disabled={disabled || !draft.trim()}
        data-testid={`button-${testIdPrefix}-goto-page`}
      >
        {t("common.pagination.goToPageGo")}
      </PillButton>
    </form>
  );
}
