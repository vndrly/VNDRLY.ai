import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
import { FleetComplianceRecordSchema } from "@workspace/api-zod";
import { FleetEvidenceReview } from "./fleet-evidence-review";
const api = vi.hoisted(() => ({
  privateComplianceRecord: vi.fn(),
  reviewCompliance: vi.fn(),
}));
vi.mock("@/lib/fleet-client", () => ({ fleetClient: api }));
vi.mock("./png-pill-rollover", () => ({
  PngPillButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("keeps private evidence out of query caches and retries the same review when its independent saved revision readback is lost", async () => {
  const record = FleetComplianceRecordSchema.parse({
    evidence: {
      id: crypto.randomUUID(),
      revision: 1,
      subject: { kind: "driver", id: 7 },
      requirementId: "OK-license",
      requirementVersion: 1,
      status: "document_received",
      validFrom: null,
      validUntil: null,
      verifiedAt: null,
      verifiedByUserId: null,
      source: "Driver report",
      privateDocumentRef: null,
      restrictions: {},
    },
    attributes: {
      kind: "driver_license",
      issuingState: "OK",
      licenseNumber: "PRIVATE-1234",
      licenseClass: "A",
      endorsements: ["N"],
      restrictions: [],
      licenseStatus: "active",
      sourceRecordId: null,
    },
    retentionClass: "qualification",
    retainUntil: null,
    legalHold: false,
  });
  let body: any;
  const saved = vi.fn();
  api.privateComplianceRecord
    .mockResolvedValueOnce(record)
    .mockRejectedValueOnce(new Error("Lost readback"))
    .mockImplementation(async () => ({
      ...record,
      evidence: {
        ...record.evidence,
        revision: 2,
        status: body.decision,
        verifiedAt: "2026-10-16T18:00:00Z",
        verifiedByUserId: 2,
      },
      review: {
        source: body.source,
        reviewedAt: "2026-10-16T18:00:00Z",
        reportedReviewedAt: body.reviewedAt,
        reviewerUserId: 2,
        filingSource: null,
      },
    }));
  api.reviewCompliance.mockImplementation(async (input) => {
    body = input;
    return {
      id: record.evidence.id,
      revision: 2,
      subject: record.evidence.subject,
      status: input.decision,
      updatedAt: "2026-10-16T18:00:00Z",
    };
  });
  render(
    <FleetEvidenceReview
      identity="company7"
      evidenceId={record.evidence.id}
      revision={1}
      onSaved={saved}
      onClose={vi.fn()}
    />,
  );
  expect(await screen.findByText("PRIVATE-1234")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Review decision"), {
    target: { value: "verified" },
  });
  fireEvent.change(screen.getByLabelText("Verification source"), {
    target: { value: "government_registry" },
  });
  fireEvent.change(screen.getByLabelText("Source reference"), {
    target: { value: "Registry check #17" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "I checked this source now" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Prepare evidence review" }),
  );
  expect(api.reviewCompliance).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save evidence review" }));
  await screen.findByText(/Review outcome needs verification/);
  expect(saved).not.toHaveBeenCalled();
  const first = structuredClone(body);
  fireEvent.click(
    screen.getByRole("button", { name: "Retry the same evidence review" }),
  );
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(api.reviewCompliance.mock.calls[1][0]).toEqual(first);
  expect(api.privateComplianceRecord).toHaveBeenLastCalledWith(
    record.evidence.id,
    2,
  );
  expect(body).not.toHaveProperty("attributes");
});
