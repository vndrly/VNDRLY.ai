import { describe, expect, it } from "vitest";

import { TicketStatus } from "@workspace/api-client-react";
import {
  TICKET_LIFECYCLE_ORDER,
  TICKET_LIFECYCLE_SPECTRUM,
  TICKET_LIFECYCLE_CHART_EXCLUDED,
} from "@workspace/ticket-status-meta";

import en from "./locales/en.json";
import { ticketLifecyclePillForStatus } from "./ticket-status-palette";
import { ticketStatusMeta } from "./ticket-status-meta";

// ---------------------------------------------------------------------------
// Task #641: drift guard for the consolidated ticket-status meta module.
//
// `ticket-status-meta.ts` is the single source of truth that both the
// list-view `TicketStatusBadge` and the action-card `TicketStatusActionPill`
// consult when rendering a ticket status. Three drift modes have bitten us
// before (Tasks #576, #595, #599, #604, #620):
//
//   1. The backend grows a new status, but no meta entry is added — the
//      badge falls back to rendering the raw `snake_case` status string
//      and the action pill silently disappears.
//   2. A meta entry references a `labelKey` that doesn't exist in the
//      English i18n catalog — `t()` returns the key itself, so users see
//      `tickets.fundsDispersed` instead of "Funds Dispersed".
//   3. A meta entry's `testIdStem` violates the `status-<kebab>` convention
//      the QA suite (`PILL_CASES` in
//      `ticket-detail.status-pills.test.tsx` and the e2e specs in
//      `lib/e2e/tests`) targets.
//
// This file walks `ticketStatusMeta` once and asserts those three
// invariants so the next "I added a status, why does the badge look
// weird?" question is caught at `pnpm --filter @workspace/vndrly test`
// instead of in production.
// ---------------------------------------------------------------------------

// Backend ticket statuses that intentionally do NOT have a meta entry,
// because the ticket-detail page renders bespoke UI for them rather than
// the shared badge / action-pill (see `artifacts/vndrly/src/pages/
// ticket-detail.tsx`).
//
// If you remove a status from this set, you must add a meta entry for it
// in `ticket-status-meta.ts` (and vice versa). Add new entries here ONLY
// with a comment pointing at the bespoke renderer that handles them.
//
// Currently empty: `awaiting_acceptance` / `denied` were previously
// bespoke but now have shared meta entries — `awaiting_acceptance`
// reuses the amber treatment from `awaiting_payment` so list rows
// surface the pending invite at a glance, and `denied` keeps
// `badgeColor: null` so the list-view badge falls through to the
// muted-text fallback (preserving the "doesn't shout for attention"
// treatment for rejected invites). The dedicated Accept / Deny /
// Reinvite card in `ticket-detail.tsx` continues to render the
// bespoke action UI for both. This lets the
// `Record<TicketStatus, TicketStatusMeta>` map in
// `lib/ticket-status-meta` stay exhaustive at compile time.
// `initiated` went the same route earlier and now renders as a blue
// pill alongside `in_progress`.
const STATUSES_HANDLED_OUTSIDE_META = new Set<string>([]);

// Extra statuses that are NOT in the backend `TicketStatus` enum but are
// still routed through `<TicketStatusBadge />` (Task #604: the crew
// tracker's `ackStatus` column is `pending` / `confirmed` / `declined`).
// We assert these are present in the meta module so the crew-tracker
// table doesn't silently regress to raw strings.
const NON_TICKET_STATUSES_REQUIRING_META: readonly string[] = [
  "pending",
  "confirmed",
  "declined",
];

type LocaleNode = string | { [key: string]: LocaleNode };

function isPlainObject(value: unknown): value is Record<string, LocaleNode> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Resolve a dotted i18n path (e.g. `tickets.fundsDispersed`) against the
 * English locale tree. Returns the leaf string, or `undefined` if the
 * path doesn't reach a string leaf — which is the same outcome
 * `i18next.t()` would silently paper over at runtime.
 */
function resolveLeaf(root: LocaleNode, path: string): string | undefined {
  let cursor: LocaleNode = root;
  for (const segment of path.split(".")) {
    if (!isPlainObject(cursor)) return undefined;
    const next = cursor[segment];
    if (next === undefined) return undefined;
    cursor = next;
  }
  return typeof cursor === "string" ? cursor : undefined;
}

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const metaEntries = Object.entries(ticketStatusMeta);
const metaKeys = new Set(Object.keys(ticketStatusMeta));
const backendStatuses = Object.values(TicketStatus);

describe("ticketStatusMeta — Task #641 drift guard", () => {
  it("includes at least one entry (sanity check)", () => {
    expect(metaEntries.length).toBeGreaterThan(0);
  });

  it("keeps badgeColor aligned with the ROYGBIV lifecycle spectrum", () => {
    for (const status of Object.values(TicketStatus)) {
      expect(
        ticketStatusMeta[status]?.badgeColor,
        `ticketStatusMeta["${status}"].badgeColor must match TICKET_LIFECYCLE_SPECTRUM`,
      ).toBe(TICKET_LIFECYCLE_SPECTRUM[status]);
    }
  });

  it("assigns a distinct lifecycle PNG to every visible chart step", () => {
    const chartSrcs = TICKET_LIFECYCLE_ORDER.filter(
      (status) => !TICKET_LIFECYCLE_CHART_EXCLUDED.has(status),
    ).map((status) => ticketLifecyclePillForStatus(status).src);
    expect(new Set(chartSrcs).size).toBe(chartSrcs.length);
  });

  it("covers every backend ticket status (or allow-lists it)", () => {
    const missing = backendStatuses.filter(
      (status) =>
        !metaKeys.has(status) && !STATUSES_HANDLED_OUTSIDE_META.has(status),
    );
    expect(
      missing,
      `These backend ticket statuses have no entry in ticketStatusMeta:\n` +
        missing.map((s) => `  - ${s}`).join("\n") +
        `\n\nAdd a meta entry to artifacts/vndrly/src/lib/ticket-status-meta.ts ` +
        `(badge color + labelKey + testIdStem, plus an actionPill if the ` +
        `Actions card should render a button), or — if the status is ` +
        `intentionally rendered by a bespoke component — add it to ` +
        `STATUSES_HANDLED_OUTSIDE_META in this test with a comment ` +
        `pointing at the renderer.`,
    ).toEqual([]);
  });

  it("does not allow-list any status that already has a meta entry", () => {
    // Tripwire: once a previously-bespoke status gets a meta entry, the
    // allow-list comment becomes stale and should be removed so this
    // test resumes guarding it.
    const stale = [...STATUSES_HANDLED_OUTSIDE_META].filter((status) =>
      metaKeys.has(status),
    );
    expect(
      stale,
      `Remove these statuses from STATUSES_HANDLED_OUTSIDE_META — they ` +
        `now have a meta entry, so the allow-list is masking real coverage:\n` +
        stale.map((s) => `  - ${s}`).join("\n"),
    ).toEqual([]);
  });

  it("covers every non-ticket status that flows through TicketStatusBadge", () => {
    // Crew-tracker `ackStatus` values (Task #604) are not in the
    // backend `TicketStatus` enum but are passed straight into
    // `<TicketStatusBadge status={row.ackStatus} />`, so they have to
    // live in the meta module too.
    const missing = NON_TICKET_STATUSES_REQUIRING_META.filter(
      (status) => !metaKeys.has(status),
    );
    expect(
      missing,
      `These non-ticket statuses are passed to <TicketStatusBadge /> ` +
        `(see Task #604 — crew tracker ackStatus) but have no meta entry:\n` +
        missing.map((s) => `  - ${s}`).join("\n"),
    ).toEqual([]);
  });

  describe.each(metaEntries)("entry %s", (status, meta) => {
    it("badgeLabelKey resolves to a non-empty string in en.json", () => {
      const value = resolveLeaf(en as LocaleNode, meta.badgeLabelKey);
      expect(
        value,
        `ticketStatusMeta["${status}"].badgeLabelKey "${meta.badgeLabelKey}" ` +
          `does not resolve to a string leaf in en.json — the badge will ` +
          `render the raw key instead of localised copy.`,
      ).toBeTypeOf("string");
      expect(
        (value ?? "").length,
        `ticketStatusMeta["${status}"].badgeLabelKey "${meta.badgeLabelKey}" ` +
          `resolves to an empty string in en.json.`,
      ).toBeGreaterThan(0);
    });

    if (meta.actionPill) {
      const labelKey = meta.actionPill.labelKey;
      it("actionPill.labelKey resolves to a non-empty string in en.json", () => {
        const value = resolveLeaf(en as LocaleNode, labelKey);
        expect(
          value,
          `ticketStatusMeta["${status}"].actionPill.labelKey "${labelKey}" ` +
            `does not resolve to a string leaf in en.json — the action ` +
            `pill will render the raw key instead of localised copy.`,
        ).toBeTypeOf("string");
        expect(
          (value ?? "").length,
          `ticketStatusMeta["${status}"].actionPill.labelKey "${labelKey}" ` +
            `resolves to an empty string in en.json.`,
        ).toBeGreaterThan(0);
      });
    }

    it("testIdStem is kebab-case so QA selectors stay stable", () => {
      // The Actions card builds `data-testid={`status-${meta.testIdStem}`}`
      // (see `ticket-status-action-pill.tsx`). Both the in-repo
      // ticket-detail status-pill suite (Task #632) and the
      // Playwright e2e specs target those ids, so a stem like
      // `Funds Dispersed` or `funds_dispersed` would silently break
      // every selector that grepped for `status-funds-dispersed`.
      expect(
        meta.testIdStem,
        `ticketStatusMeta["${status}"].testIdStem "${meta.testIdStem}" must ` +
          `be kebab-case (lowercase letters/digits separated by single ` +
          `hyphens) to match the existing status-* data-testid convention.`,
      ).toMatch(KEBAB_CASE);
    });
  });

  it("testIdStems are unique across the meta module", () => {
    // Two statuses sharing a stem would collide on the same
    // `data-testid="status-<stem>"`, making the e2e selectors
    // ambiguous. Catching the collision here is much cheaper than
    // debugging a flaky Playwright run.
    const seen = new Map<string, string[]>();
    for (const [status, meta] of metaEntries) {
      const owners = seen.get(meta.testIdStem) ?? [];
      owners.push(status);
      seen.set(meta.testIdStem, owners);
    }
    const collisions = [...seen.entries()].filter(([, owners]) => owners.length > 1);
    expect(
      collisions,
      `Duplicate testIdStem(s) detected — every meta entry needs a unique ` +
        `stem so QA selectors stay deterministic:\n` +
        collisions
          .map(([stem, owners]) => `  - "${stem}" used by: ${owners.join(", ")}`)
          .join("\n"),
    ).toEqual([]);
  });
});
