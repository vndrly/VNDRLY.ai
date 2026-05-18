import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { FieldEmployee } from "@workspace/api-client-react";

// Shared mutable test state. `vi.hoisted` ensures the object exists before
// the `vi.mock` factories below run (they are hoisted above import lines).
type ListArgs = { vendorId: number } | undefined;

const mockState = vi.hoisted(() => ({
  user: null as
    | null
    | {
        userId: number;
        role: "admin" | "vendor" | "partner" | "field_employee";
        vendorId: number | null;
        partnerId: number | null;
      },
  data: undefined as unknown,
  lastListArgs: undefined as ListArgs,
  listCallCount: 0,
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: mockState.user,
    isLoading: false,
    login: async () => {},
    logout: async () => {},
    setPreferredLanguage: () => {},
    switchContext: async () => {},
    clearMustChangePassword: () => {},
  }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListFieldEmployees: (args: ListArgs) => {
    mockState.lastListArgs = args;
    mockState.listCallCount += 1;
    return { data: mockState.data };
  },
}));

import {
  useEligibleVendorFieldEmployees,
  useEligibleVendorFieldEmployeesByVendorId,
  useClearStaleFieldEmployeeSelection,
} from "./use-eligible-vendor-field-employees";

function makeFieldEmployee(overrides: Partial<FieldEmployee>): FieldEmployee {
  return {
    id: 1,
    vendorId: 100,
    vendorRole: "foreman",
    jobTitle: null,
    firstName: "Test",
    lastName: "User",
    email: "test@example.com",
    phone: null,
    userId: null,
    vendorName: "Test Vendor",
    vendorLogoUrl: null,
    isActive: true,
    pecCertification: false,
    pecExpirationDate: null,
    photoUrl: null,
    profilePhotoPath: null,
    createdAt: "2025-01-01T00:00:00Z",
    deletedAt: null,
    ...overrides,
  } as FieldEmployee;
}

beforeEach(() => {
  mockState.user = null;
  mockState.data = undefined;
  mockState.lastListArgs = undefined;
  mockState.listCallCount = 0;
});

describe("useEligibleVendorFieldEmployees", () => {
  it("returns only own-vendor rows for a vendor session, defending against a stale-cache leak from a prior membership", () => {
    mockState.user = {
      userId: 7,
      role: "vendor",
      vendorId: 100,
      partnerId: null,
    };
    // Simulate the post-membership-switch stale-cache window: the cached
    // page still contains a foreman from a vendor the operator no longer
    // belongs to. The server's Task #507 guard would 400 on that id, so
    // the client must filter it out even though it called list with the
    // *new* vendorId.
    mockState.data = [
      makeFieldEmployee({ id: 1, vendorId: 100, firstName: "Alice" }),
      makeFieldEmployee({ id: 2, vendorId: 100, firstName: "Bob" }),
      makeFieldEmployee({ id: 3, vendorId: 999, firstName: "Stale" }),
    ];

    const { result } = renderHook(() => useEligibleVendorFieldEmployees());

    // The list call itself was scoped to the active vendorId.
    expect(mockState.lastListArgs).toEqual({ vendorId: 100 });
    // ...and the client-side re-assertion drops the leaked row.
    expect(result.current.eligibleForemen.map((fe) => fe.id)).toEqual([1, 2]);
    // Raw response is still surfaced for callers that need it.
    expect(result.current.fieldEmployees).toHaveLength(3);
  });

  it("returns an empty eligible list and skips the list call for a non-vendor session", () => {
    mockState.user = {
      userId: 1,
      role: "admin",
      vendorId: null,
      partnerId: null,
    };
    mockState.data = [
      makeFieldEmployee({ id: 1, vendorId: 100 }),
      makeFieldEmployee({ id: 2, vendorId: 200 }),
    ];

    const { result } = renderHook(() => useEligibleVendorFieldEmployees());

    // Non-vendor sessions must not request a vendor-scoped list, and must
    // never surface foremen as "eligible" in any picker.
    expect(mockState.lastListArgs).toBeUndefined();
    expect(result.current.eligibleForemen).toEqual([]);
  });

  it("narrows the eligible list when the operator switches vendor membership", () => {
    mockState.user = {
      userId: 7,
      role: "vendor",
      vendorId: 100,
      partnerId: null,
    };
    mockState.data = [
      makeFieldEmployee({ id: 1, vendorId: 100 }),
      makeFieldEmployee({ id: 2, vendorId: 100 }),
      makeFieldEmployee({ id: 3, vendorId: 200 }),
    ];

    const { result, rerender } = renderHook(() =>
      useEligibleVendorFieldEmployees(),
    );

    expect(result.current.eligibleForemen.map((fe) => fe.id)).toEqual([1, 2]);
    expect(mockState.lastListArgs).toEqual({ vendorId: 100 });

    // Operator switches to vendor 200; list refetches but until the cache
    // refreshes we may still hold rows from both vendors. The hook must
    // immediately narrow to vendor 200.
    mockState.user = {
      userId: 7,
      role: "vendor",
      vendorId: 200,
      partnerId: null,
    };
    rerender();

    expect(mockState.lastListArgs).toEqual({ vendorId: 200 });
    expect(result.current.eligibleForemen.map((fe) => fe.id)).toEqual([3]);
  });
});

describe("useEligibleVendorFieldEmployeesByVendorId", () => {
  // Task #523: thin variant for surfaces that pin to a vendorId other
  // than the operator's active membership (admin/partner scheduling a
  // ticket against another vendor, the QR portal sign-in, and the
  // vendor detail employees card). The defense is the same shape as
  // the auth-derived variant — re-assert vendorId on the client and
  // drop deactivated rows — but it must work regardless of the auth
  // user, so we explicitly assert that an admin session still gets the
  // full eligible roster for the requested vendor.
  it("filters by the explicit vendorId and drops inactive rows for any session", () => {
    mockState.user = {
      userId: 1,
      role: "admin",
      vendorId: null,
      partnerId: null,
    };
    mockState.data = [
      makeFieldEmployee({ id: 1, vendorId: 100, firstName: "Alice" }),
      makeFieldEmployee({ id: 2, vendorId: 100, firstName: "Bob", isActive: false }),
      makeFieldEmployee({ id: 3, vendorId: 100, firstName: "Carla" }),
      makeFieldEmployee({ id: 4, vendorId: 999, firstName: "OtherVendor" }),
    ];

    const { result } = renderHook(() =>
      useEligibleVendorFieldEmployeesByVendorId(100),
    );

    // The list call was scoped to the explicit vendorId, regardless of
    // the admin's missing vendorId on the auth user.
    expect(mockState.lastListArgs).toEqual({ vendorId: 100 });
    // Inactive Bob and other-vendor row are dropped.
    expect(result.current.eligibleForemen.map((fe) => fe.id)).toEqual([1, 3]);
  });

  it("skips the list call and returns empty when no vendorId is supplied", () => {
    mockState.user = {
      userId: 1,
      role: "admin",
      vendorId: null,
      partnerId: null,
    };
    mockState.data = [makeFieldEmployee({ id: 1, vendorId: 100 })];

    const { result, rerender } = renderHook(
      (props: { vendorId: number | undefined }) =>
        useEligibleVendorFieldEmployeesByVendorId(props.vendorId),
      { initialProps: { vendorId: undefined } },
    );

    // Missing vendorId mirrors the portal pre-selection state — must
    // not request a list, must surface an empty eligible set.
    expect(mockState.lastListArgs).toBeUndefined();
    expect(result.current.eligibleForemen).toEqual([]);

    // Once the QR portal user picks their company, the list call must
    // fire and the eligible set must populate.
    rerender({ vendorId: 100 });
    expect(mockState.lastListArgs).toEqual({ vendorId: 100 });
    expect(result.current.eligibleForemen.map((fe) => fe.id)).toEqual([1]);
  });
});

describe("useClearStaleFieldEmployeeSelection", () => {
  it("clears when the picked id leaves the eligible set", () => {
    mockState.user = {
      userId: 7,
      role: "vendor",
      vendorId: 100,
      partnerId: null,
    };
    const onClear = vi.fn();
    const eligible = [
      makeFieldEmployee({ id: 1, vendorId: 100 }),
      makeFieldEmployee({ id: 2, vendorId: 100 }),
    ];
    const { rerender } = renderHook(
      (props: {
        eligible: FieldEmployee[];
        list: FieldEmployee[] | undefined;
        selectedId: string;
      }) =>
        useClearStaleFieldEmployeeSelection({
          selectedId: props.selectedId,
          eligibleForemen: props.eligible,
          fieldEmployees: props.list,
          onClear,
        }),
      { initialProps: { eligible, list: eligible, selectedId: "2" } },
    );

    // Selection is currently eligible, so no clear yet.
    expect(onClear).not.toHaveBeenCalled();

    // Foreman #2 was soft-deleted / deactivated / belongs to a vendor the
    // operator no longer has access to. The next render must drop the pick.
    const narrowed = [eligible[0]];
    rerender({ eligible: narrowed, list: narrowed, selectedId: "2" });
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("does not clear while the field employees list is still loading", () => {
    const onClear = vi.fn();
    renderHook(() =>
      useClearStaleFieldEmployeeSelection({
        selectedId: "42",
        eligibleForemen: [],
        // `undefined` mirrors react-query's pre-data state. We must not
        // wipe the user's pick before we even know what's eligible.
        fieldEmployees: undefined,
        onClear,
      }),
    );
    expect(onClear).not.toHaveBeenCalled();
  });

  it("does not refire when only the onClear callback identity changes between renders", () => {
    // This guards the inline-arrow case in the picker components: parents
    // create a fresh `() => setSelected("")` on every render, and we must
    // not treat that as a reason to re-run the eligibility check.
    //
    // We start with an *ineligible* selection so the very first effect run
    // calls onClear exactly once. That makes a stray re-run impossible to
    // miss: it would bump the firstClear / secondClear counters.
    const eligible = [
      makeFieldEmployee({ id: 1, vendorId: 100 }),
      makeFieldEmployee({ id: 2, vendorId: 100 }),
    ];
    const firstClear = vi.fn();
    const secondClear = vi.fn();

    const { rerender } = renderHook(
      (props: { onClear: () => void }) =>
        useClearStaleFieldEmployeeSelection({
          selectedId: "999", // not in `eligible`
          eligibleForemen: eligible,
          fieldEmployees: eligible,
          onClear: props.onClear,
        }),
      { initialProps: { onClear: firstClear } },
    );

    // Initial run: id 999 is not eligible, so the *first* clear fires once.
    expect(firstClear).toHaveBeenCalledTimes(1);

    // Re-render with a brand-new function reference but identical inputs.
    // Because `onClear` is held in a ref and excluded from the effect's
    // deps, the effect must not run again — neither callback should be
    // invoked an additional time.
    rerender({ onClear: secondClear });
    expect(firstClear).toHaveBeenCalledTimes(1);
    expect(secondClear).not.toHaveBeenCalled();

    // Sanity check: when the eligibility set actually changes, the latest
    // onClear (held via the ref) is the one that fires.
    const { rerender: rerenderClear } = renderHook(
      (props: {
        eligible: FieldEmployee[];
        list: FieldEmployee[];
        onClear: () => void;
      }) =>
        useClearStaleFieldEmployeeSelection({
          selectedId: "2",
          eligibleForemen: props.eligible,
          fieldEmployees: props.list,
          onClear: props.onClear,
        }),
      {
        initialProps: { eligible, list: eligible, onClear: firstClear },
      },
    );
    const latestClear = vi.fn();
    const narrowed = [eligible[0]];
    rerenderClear({ eligible: narrowed, list: narrowed, onClear: latestClear });
    expect(latestClear).toHaveBeenCalledTimes(1);
    // firstClear stays at its prior count (1) — only latestClear fires here.
    expect(firstClear).toHaveBeenCalledTimes(1);
  });

  it("matches the selection through a custom getId — used by the schedule-ticket-dialog foreman picker, which is keyed by userId rather than employee.id", () => {
    // The schedule dialog's foreman dropdown stores the picked
    // `userId` (the server's foremanUserId column points at users, not
    // vendor_people). Without a custom getId the helper would compare
    // the stored userId to fe.id and clear every selection. Verify the
    // matcher path: the picked userId is preserved while it maps to an
    // eligible employee, and cleared the moment that employee leaves
    // the set.
    const onClear = vi.fn();
    const eligible = [
      makeFieldEmployee({ id: 10, vendorId: 100, userId: 501 }),
      makeFieldEmployee({ id: 11, vendorId: 100, userId: 502 }),
      makeFieldEmployee({ id: 12, vendorId: 100, userId: null }),
    ];
    const { rerender } = renderHook(
      (props: {
        eligible: FieldEmployee[];
        list: FieldEmployee[] | undefined;
        selectedId: string;
      }) =>
        useClearStaleFieldEmployeeSelection({
          selectedId: props.selectedId,
          eligibleForemen: props.eligible,
          fieldEmployees: props.list,
          onClear,
          getId: (fe) => (fe.userId != null ? String(fe.userId) : null),
        }),
      { initialProps: { eligible, list: eligible, selectedId: "502" } },
    );
    expect(onClear).not.toHaveBeenCalled();

    // The employee backing userId 502 is deactivated / removed from the
    // eligible set — the foreman pick must drop.
    const narrowed = [eligible[0], eligible[2]];
    rerender({ eligible: narrowed, list: narrowed, selectedId: "502" });
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
