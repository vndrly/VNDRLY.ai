import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FleetRunSchema } from "@workspace/api-zod";
const api = vi.hoisted(() => ({ editDraft: vi.fn() }));
vi.mock("@/lib/fleet-client", () => ({ fleetClient: api }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("@/components/png-pill-rollover", () => ({
  PngPillButton: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
import { FleetDraftEditor } from "./fleet-draft-editor";
import {
  fleetScheduleDraft,
  parseFleetSchedule,
} from "./fleet-schedule-fields";
const run = FleetRunSchema.parse({
  id: "11111111-1111-4111-8111-111111111111",
  fleetId: "22222222-2222-4222-8222-222222222222",
  companyId: 7,
  title: "Saved draft",
  driverUserId: 8,
  vehicleAssetId: "33333333-3333-4333-8333-333333333333",
  trailerAssetId: null,
  siteIds: [9],
  status: "draft",
  phase: null,
  version: 4,
  stops: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      siteId: 9,
      kind: "pickup",
      sequence: 0,
    },
  ],
  loads: [],
  inspections: [],
  currentStopId: null,
  visitedStopIds: [],
  events: [],
  linkedTicketId: null,
  allowedActions: [],
  canEditDraft: true,
});
it("reviews exact draft revision and preserves the operation after an uncertain save", async () => {
  api.editDraft
    .mockRejectedValueOnce(new Error("response lost"))
    .mockImplementationOnce(async (_id, input) => ({
      ...run,
      version: 5,
      events: [{ operationId: input.operationId }],
    }));
  const saved = vi.fn(async () => {});
  render(<FleetDraftEditor run={run} sites={[9]} onSaved={saved} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit saved draft" }));
  fireEvent.change(screen.getByLabelText("Run title"), {
    target: { value: "Reviewed draft" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Review exact draft changes" }),
  );
  expect(api.editDraft).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Save reviewed draft changes" }),
  );
  await waitFor(() => expect(api.editDraft).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Save reviewed draft changes" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Save reviewed draft changes" }),
  );
  await waitFor(() => expect(api.editDraft).toHaveBeenCalledTimes(2));
  expect(api.editDraft.mock.calls[1]).toEqual(api.editDraft.mock.calls[0]);
  expect(api.editDraft.mock.calls[0][1]).toMatchObject({
    expectedVersion: 4,
    title: "Reviewed draft",
    schedule: null,
    stops: run.stops,
  });
  expect(api.editDraft.mock.calls[0][1]).not.toHaveProperty("actorUserId");
});
it("rejects partial/reversed schedule and preserves explicit no-schedule", () => {
  const empty = fleetScheduleDraft(null);
  expect(parseFleetSchedule(empty)).toEqual({ valid: true, schedule: null });
  expect(
    parseFleetSchedule({ ...empty, start: "2026-10-07T10:00" }).valid,
  ).toBe(false);
  expect(
    parseFleetSchedule({
      ...empty,
      start: "2026-10-07T10:00",
      end: "2026-10-07T09:00",
    }).valid,
  ).toBe(false);
  const value = parseFleetSchedule({
    ...empty,
    start: "2026-10-07T10:00",
    end: "2026-10-07T11:00",
  });
  expect(value.valid).toBe(true);
  if (value.valid)
    expect(value.schedule?.plannedStartAt).toBe(
      new Date("2026-10-07T10:00").toISOString(),
    );
});

it("requires explicit reload rather than rebasing unsaved fields on a newer revision", () => {
  const saved = vi.fn(async () => {});
  const view = render(
    <FleetDraftEditor run={run} sites={[9]} onSaved={saved} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit saved draft" }));
  fireEvent.change(screen.getByLabelText("Run title"), {
    target: { value: "Old local edits" },
  });
  view.rerender(
    <FleetDraftEditor
      run={{ ...run, version: 5, title: "New saved title" }}
      sites={[9]}
      onSaved={saved}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Review exact draft changes" }),
  ).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "Reload saved draft" }));
  expect(screen.getByLabelText("Run title")).toHaveProperty(
    "value",
    "New saved title",
  );
  expect(
    screen.getByRole("button", { name: "Review exact draft changes" }),
  ).toHaveProperty("disabled", false);
});
