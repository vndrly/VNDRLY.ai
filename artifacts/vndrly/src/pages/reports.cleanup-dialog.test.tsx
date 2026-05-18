import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The shared Dialog primitive renders a `PortalLogoOverlay` that talks
// to useAuth + the generated API client. None of that is relevant to
// the cleanup dialog under test, and wiring real providers would
// require a query client + an /api/auth/me fetch we don't need.
// Stubbing both keeps the tests focused on the preview / freed-bytes
// flow, mirroring the pattern in reports.bulk-undo.test.tsx and
// reports.csv-import.test.tsx.
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: {
      userId: 1,
      role: "admin",
      displayName: "Admin",
      partnerId: null,
      vendorId: null,
      preferredLanguage: "en",
      activeMembershipId: null,
      availableMemberships: [],
      requiresContextChoice: false,
    },
    isLoading: false,
    login: async () => {},
    logout: async () => {},
    setPreferredLanguage: () => {},
    switchContext: async () => {},
  }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetPartner: () => ({ data: undefined }),
  useGetVendor: () => ({ data: undefined }),
  getGetPartnerQueryKey: () => ["partner"],
  getGetVendorQueryKey: () => ["vendor"],
}));

import { useState, type ReactElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  BulkActionsCleanupDialog,
  type BulkActionsCleanupDialogProps,
} from "./reports";
import { formatSnapshotBytes } from "../lib/format-bytes";

// ── Test helpers ─────────────────────────────────────────────────

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

interface CleanupResponseShape {
  deleted: number;
  bytesFreed: number;
  protectedRecent: number;
  retentionDays: number;
  minRetained: number;
  cutoff: string;
}

function cleanupResponse(
  overrides: Partial<CleanupResponseShape> = {},
): CleanupResponseShape {
  return {
    deleted: 4,
    bytesFreed: 2048,
    protectedRecent: 10,
    retentionDays: 90,
    minRetained: 10,
    cutoff: new Date(
      Date.now() - 90 * 24 * 60 * 60 * 1000,
    ).toISOString(),
    ...overrides,
  };
}

/** Render the dialog as a controlled child of a tiny harness so the
 *  test can drive `open` toggling exactly the way the real parent
 *  (QbAccountMappingCard) does — opening for the first time triggers
 *  the dry-run preview fetch via the dialog's open-effect. */
type CleanedUpMock = ReturnType<
  typeof vi.fn<(deleted: number, bytesFreed: number) => void>
>;

function renderDialog(
  overrides: Partial<BulkActionsCleanupDialogProps> = {},
): { onCleanedUp: CleanedUpMock } {
  const onCleanedUp =
    (overrides.onCleanedUp as CleanedUpMock | undefined) ??
    vi.fn<(deleted: number, bytesFreed: number) => void>();

  function Harness(): ReactElement {
    const [open, setOpen] = useState(true);
    return (
      <BulkActionsCleanupDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          overrides.onOpenChange?.(next);
        }}
        onCleanedUp={onCleanedUp}
      />
    );
  }

  render(<Harness />);
  return { onCleanedUp };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── BulkActionsCleanupDialog component tests ─────────────────────

describe("BulkActionsCleanupDialog", () => {
  it("shows both the row count and the formatted freed estimate when bytesFreed is non-zero", async () => {
    // 3 MiB of snapshot data — large enough to exercise the MB branch
    // of the formatter so we know the dialog is piping the byte count
    // through the shared helper rather than rendering the raw integer.
    const bytesFreed = 3 * 1024 * 1024;
    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse(cleanupResponse({ deleted: 4, bytesFreed })),
    );

    renderDialog();

    // Row-count copy is the primary preview line; appears once the
    // dry-run fetch resolves.
    const count = await waitFor(() =>
      screen.getByTestId("text-cleanup-preview-count"),
    );
    expect(count.textContent).toContain("4");

    // The confirm button label is interpolated with the previewed
    // delete count via the `confirm_one`/`confirm_other` plural keys,
    // so a regression that forgot to thread `preview.deleted` into
    // the i18n call would surface here as a missing "4". The button
    // must also be enabled in this branch — non-zero preview ⇒
    // admin can proceed.
    const confirmBtn = screen.getByTestId(
      "button-cleanup-confirm",
    ) as HTMLButtonElement;
    expect(confirmBtn.textContent).toContain("4");
    expect(confirmBtn.disabled).toBe(false);

    // Freed-estimate copy is a second muted-color line; it must show
    // the formatted size (3.0 MB), not the raw byte integer. This is
    // the regression the task explicitly calls out — dropping this
    // line or swapping in `bytesFreed.toString()` would silently
    // confuse admins comparing the value to `du -sh` output.
    const freed = screen.getByTestId("text-cleanup-preview-freed");
    expect(freed.textContent).toContain(formatSnapshotBytes(bytesFreed));
    expect(freed.textContent).toContain("3.0 MB");
    // And just to lock the regression: the literal byte count must
    // NOT appear in the freed line.
    expect(freed.textContent).not.toContain(String(bytesFreed));
  });

  it("hides the freed line when bytesFreed is 0 (nothing-to-do branch)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse(cleanupResponse({ deleted: 0, bytesFreed: 0 })),
    );

    renderDialog();

    // The "nothing to clean up" copy renders once preview resolves;
    // waiting on it ensures we're past the loading state before we
    // assert on what *isn't* there.
    await waitFor(() => screen.getByTestId("text-cleanup-nothing"));

    // The freed line is gated on `!nothingToDo`, so deleted=0 must
    // suppress it entirely. If a regression always rendered the line
    // we'd see "0 B" here and admins would get a confusing "Frees
    // about 0 B" line under the "Nothing to clean up" copy.
    expect(screen.queryByTestId("text-cleanup-preview-freed")).toBeNull();

    // The Apply button should also be disabled — no point letting
    // the admin POST a cleanup that will do nothing.
    const confirm = screen.getByTestId(
      "button-cleanup-confirm",
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it("shows the preview-error copy when the dry-run fetch is non-OK", async () => {
    // Server-side cleanup is admin-only; a 403 from the dry-run is
    // the realistic failure mode (e.g. role lost mid-session). The
    // dialog should surface the error message, hide the preview
    // body, and keep Apply disabled.
    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse(
        { error: "forbidden" },
        { status: 403 },
      ),
    );

    renderDialog();

    const err = await waitFor(() =>
      screen.getByTestId("text-cleanup-preview-error"),
    );
    // The translated copy wraps the server-provided message via the
    // {{msg}} placeholder, so substring-checking for the raw error
    // proves both the fetch path and the i18n interpolation worked.
    expect(err.textContent).toContain("forbidden");

    // No preview body should render alongside the error.
    expect(screen.queryByTestId("text-cleanup-preview-count")).toBeNull();
    expect(screen.queryByTestId("text-cleanup-preview-freed")).toBeNull();

    const confirm = screen.getByTestId(
      "button-cleanup-confirm",
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it("invokes onCleanedUp with the freed bytes from the apply response so the parent banner can format them", async () => {
    // The dry-run preview returns one bytesFreed value; the apply POST
    // returns a slightly different one (admins may have raced another
    // cleanup). The dialog's contract is to forward the *apply*
    // response — that's what the freed-space banner in the parent
    // ultimately renders.
    const previewBytes = 5 * 1024;
    const appliedBytes = 4 * 1024;
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("dryRun=true")) {
          return Promise.resolve(
            jsonResponse(
              cleanupResponse({ deleted: 2, bytesFreed: previewBytes }),
            ),
          );
        }
        return Promise.resolve(
          jsonResponse(
            cleanupResponse({ deleted: 2, bytesFreed: appliedBytes }),
          ),
        );
      });

    const onCleanedUp = vi.fn();
    renderDialog({ onCleanedUp });

    const confirm = await waitFor(() => {
      const btn = screen.getByTestId(
        "button-cleanup-confirm",
      ) as HTMLButtonElement;
      // Wait for preview to resolve so the button is enabled.
      expect(btn.disabled).toBe(false);
      return btn;
    });

    fireEvent.click(confirm);

    await waitFor(() => {
      expect(onCleanedUp).toHaveBeenCalledTimes(1);
    });

    // Critical contract: parent receives (deleted, bytesFreed) from
    // the *apply* response, not the dry-run, so its banner copy is
    // accurate even if the two values diverged due to a concurrent
    // cleanup.
    expect(onCleanedUp).toHaveBeenCalledWith(2, appliedBytes);

    // Both POSTs went out — once with dryRun=true, once without.
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(
      urls.filter((u) => u.includes("dryRun=true")).length,
    ).toBe(1);
    expect(
      urls.filter(
        (u) =>
          u.includes(
            "/api/reports/qb-account-mapping/bulk-actions/cleanup",
          ) && !u.includes("dryRun=true"),
      ).length,
    ).toBe(1);
  });
});

// ── Parent freed-space banner integration ────────────────────────

describe("BulkActionsCleanupDialog → parent freed-space banner", () => {
  it("formats the bytesFreed reported by onCleanedUp with formatSnapshotBytes (raw bytes never leak into the banner)", async () => {
    // A miniature stand-in for QbAccountMappingCard that wires the
    // dialog up the same way the real parent does: it stores the
    // freed banner copy in state and feeds the apply response
    // through `formatSnapshotBytes`. Driving the real card requires
    // mocking ~half a dozen unrelated endpoints — this harness keeps
    // the test focused on the formatting contract while still
    // exercising the dialog → parent handoff end-to-end.
    const appliedBytes = 1572864; // 1.5 MiB
    vi.spyOn(global, "fetch").mockImplementation(
      (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("dryRun=true")) {
          return Promise.resolve(
            jsonResponse(
              cleanupResponse({ deleted: 7, bytesFreed: appliedBytes }),
            ),
          );
        }
        return Promise.resolve(
          jsonResponse(
            cleanupResponse({ deleted: 7, bytesFreed: appliedBytes }),
          ),
        );
      },
    );

    function ParentHarness(): ReactElement {
      const [open, setOpen] = useState(true);
      const [banner, setBanner] = useState<string | null>(null);
      return (
        <>
          <BulkActionsCleanupDialog
            open={open}
            onOpenChange={setOpen}
            onCleanedUp={(deleted, bytesFreed) => {
              // Mirror the real parent (reports.tsx ~line 5176): the
              // banner copy must use the formatted size, never the
              // raw byte integer.
              setBanner(
                `Cleanup complete — removed ${deleted} old snapshots, freed ~${formatSnapshotBytes(
                  bytesFreed,
                )}.`,
              );
            }}
          />
          {banner && <div data-testid="banner-cleanup-freed">{banner}</div>}
        </>
      );
    }

    render(<ParentHarness />);

    const confirm = await waitFor(() => {
      const btn = screen.getByTestId(
        "button-cleanup-confirm",
      ) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
      return btn;
    });

    fireEvent.click(confirm);

    const banner = await waitFor(() =>
      screen.getByTestId("banner-cleanup-freed"),
    );

    // Formatted size present.
    expect(banner.textContent).toContain(formatSnapshotBytes(appliedBytes));
    expect(banner.textContent).toContain("1.5 MB");
    expect(banner.textContent).toContain("7");
    // Raw byte integer absent — this is the regression the task
    // explicitly highlights ("formatted the banner with the raw byte
    // number").
    expect(banner.textContent).not.toContain(String(appliedBytes));
  });
});

// ── formatSnapshotBytes unit transitions ─────────────────────────

describe("formatSnapshotBytes", () => {
  // The formatter is the source of truth for both the dialog preview
  // and the parent banner copy, so it gets its own focused checks
  // (the task calls out "representative byte→KB→MB→GB transitions").
  it("returns 0 B for zero, negative, or non-finite input", () => {
    expect(formatSnapshotBytes(0)).toBe("0 B");
    expect(formatSnapshotBytes(-100)).toBe("0 B");
    expect(formatSnapshotBytes(Number.NaN)).toBe("0 B");
    expect(formatSnapshotBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
  });

  it("formats sub-KB values as raw bytes", () => {
    expect(formatSnapshotBytes(1)).toBe("1 B");
    expect(formatSnapshotBytes(512)).toBe("512 B");
    expect(formatSnapshotBytes(1023)).toBe("1023 B");
  });

  it("formats KB values with one decimal under 10 KB and zero decimals at/above 10 KB", () => {
    expect(formatSnapshotBytes(1024)).toBe("1.0 KB");
    expect(formatSnapshotBytes(1536)).toBe("1.5 KB"); // 1.5 KiB
    expect(formatSnapshotBytes(10 * 1024)).toBe("10 KB");
    expect(formatSnapshotBytes(512 * 1024)).toBe("512 KB");
  });

  it("formats MB values with the same one-decimal/zero-decimal split", () => {
    expect(formatSnapshotBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatSnapshotBytes(3 * 1024 * 1024)).toBe("3.0 MB");
    expect(formatSnapshotBytes(10 * 1024 * 1024)).toBe("10 MB");
    expect(formatSnapshotBytes(750 * 1024 * 1024)).toBe("750 MB");
  });

  it("formats GB values with two decimals under 10 GB and one decimal at/above 10 GB", () => {
    expect(formatSnapshotBytes(1024 * 1024 * 1024)).toBe("1.00 GB");
    // ~2.5 GiB
    expect(formatSnapshotBytes(Math.round(2.5 * 1024 * 1024 * 1024))).toBe(
      "2.50 GB",
    );
    expect(formatSnapshotBytes(10 * 1024 * 1024 * 1024)).toBe("10.0 GB");
    expect(formatSnapshotBytes(123 * 1024 * 1024 * 1024)).toBe("123.0 GB");
  });
});
