import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import { FleetComplianceIntake } from "./fleet-compliance-intake";
import {draftFleetRequirement} from "@workspace/api-zod";
const api = vi.hoisted(() => ({
  complianceSubjects: vi.fn(),
  complianceRequirements: vi.fn(),
  uploadComplianceDocument: vi.fn(),
  receiveComplianceSource: vi.fn(),
  complianceReceipt: vi.fn(),
}));
vi.mock("@/lib/fleet-client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fleetClient: api,
}));
vi.mock("./png-pill-rollover", () => ({
  PngPillButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("pins the selected adopted requirement into the received source without copying its review into the upload",async()=>{
 const reference=draftFleetRequirement("driver-license",{version:3,effectiveFrom:"2026-10-16T12:00:00Z"});
 api.complianceSubjects.mockResolvedValue({entries:[{subject:{kind:"driver",id:7},label:"Synthetic driver",canSubmit:true}],nextCursor:null});api.complianceRequirements.mockResolvedValue({requirements:[{...reference,source:{...reference.source,reviewedAt:"2026-10-16T12:00:00Z",reviewedByUserId:11}}],canAdopt:false,mode:"warn_only"});
 api.receiveComplianceSource.mockImplementation(async input=>({id:input.record.evidence.id,revision:1,subject:input.record.evidence.subject,status:"document_received",updatedAt:"2026-10-16T22:00:00Z"}));api.complianceReceipt.mockImplementation(async(id,revision)=>({id,revision,subject:{kind:"driver",id:7},status:"document_received",updatedAt:"2026-10-16T22:00:00Z"}));
 const saved=vi.fn();render(<FleetComplianceIntake identity="company11" onSaved={saved} onClose={vi.fn()}/>);await screen.findByRole("option",{name:"Synthetic driver"});fireEvent.change(screen.getByLabelText("For"),{target:{value:"driver:7"}});fireEvent.change(screen.getByLabelText("Source type"),{target:{value:"driver_license"}});await screen.findByRole("option",{name:"Driver license, class and endorsements · 3"});fireEvent.change(screen.getByLabelText("Adopted requirement"),{target:{value:"driver-license"}});fireEvent.change(screen.getByLabelText("Source reference or description"),{target:{value:"Worker source"}});fireEvent.click(screen.getByRole("checkbox",{name:"Save this as received, unverified evidence"}));fireEvent.click(screen.getByRole("button",{name:"Prepare source"}));fireEvent.click(screen.getByRole("button",{name:"Save received evidence"}));await waitFor(()=>expect(saved).toHaveBeenCalledOnce());expect(api.receiveComplianceSource.mock.calls[0][0].record.evidence).toMatchObject({requirementId:"driver-license",requirementVersion:3,verifiedAt:null,status:"document_received"});
});
it("does not continue a prior company's upload into a new cookie context after the form changes identity", async () => {
  let finish!: (value: unknown) => void;
  api.complianceSubjects.mockResolvedValue({
    entries: [
      {
        subject: { kind: "driver", id: 7 },
        label: "Synthetic driver",
        canSubmit: true,
      },
    ],
    nextCursor: null,
  });
  api.complianceRequirements.mockResolvedValue({
    requirements: [],
    canAdopt: false,
    mode: "warn_only",
  });
  api.uploadComplianceDocument.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  api.receiveComplianceSource.mockResolvedValue({});
  const view = render(
    <FleetComplianceIntake
      identity="company11"
      onSaved={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  await screen.findByRole("option", { name: "Synthetic driver" });
  fireEvent.change(screen.getByLabelText("For"), {
    target: { value: "driver:7" },
  });
  fireEvent.change(screen.getByLabelText("Source type"), {
    target: { value: "driver_license" },
  });
  fireEvent.change(screen.getByLabelText("Source document"), {
    target: { files: [new File(["%PDF-synthetic"], "source.pdf")] },
  });
  await screen.findByText(/Source document ready/);
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Save this as received, unverified evidence",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Prepare source" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Save received evidence" }),
  );
  await waitFor(() =>
    expect(api.uploadComplianceDocument).toHaveBeenCalledOnce(),
  );
  const id = api.uploadComplianceDocument.mock.calls[0][0].recordId;
  view.rerender(
    <FleetComplianceIntake
      identity="company12"
      onSaved={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  await act(async () => {
    finish({
      objectPath: `/objects/fleet-compliance-private/11/${id}/documents/${"a".repeat(64)}`,
    });
  });
  expect(api.receiveComplianceSource).not.toHaveBeenCalled();
  expect(api.complianceReceipt).not.toHaveBeenCalled();
});
it("receives a private source with exact identifiers and retries upload/save/readback independently without claiming verification", async () => {
  const saved = vi.fn(),
    uploads: any[] = [],
    commands: any[] = [];
  let uploadReads = 0,
    receiptReads = 0;
  api.complianceSubjects.mockResolvedValue({
    entries: [
      {
        subject: { kind: "driver", id: 7 },
        label: "Synthetic driver",
        canSubmit: true,
      },
    ],
    nextCursor: null,
  });
  api.complianceRequirements.mockResolvedValue({
    requirements: [],
    canAdopt: false,
    mode: "warn_only",
  });
  api.uploadComplianceDocument.mockImplementation(async (input) => {
    uploads.push(input);
    if (++uploadReads === 1) throw new Error("Upload response lost");
    return {
      objectPath: `/objects/fleet-compliance-private/11/${input.recordId}/documents/${"a".repeat(64)}`,
    };
  });
  api.receiveComplianceSource.mockImplementation(async (input) => {
    commands.push(input);
    return {
      id: input.record.evidence.id,
      revision: 1,
      subject: input.record.evidence.subject,
      status: "document_received",
      updatedAt: "2026-10-16T22:00:00Z",
    };
  });
  api.complianceReceipt.mockImplementation(async (id, revision) => {
    if (++receiptReads === 1) throw new Error("Receipt lost");
    return {
      id,
      revision,
      subject: { kind: "driver", id: 7 },
      status: "document_received",
      updatedAt: "2026-10-16T22:00:00Z",
    };
  });
  render(
    <FleetComplianceIntake
      identity="company11"
      onSaved={saved}
      onClose={vi.fn()}
    />,
  );
  await screen.findByRole("option", { name: "Synthetic driver" });
  fireEvent.change(screen.getByLabelText("For"), {
    target: { value: "driver:7" },
  });
  fireEvent.change(screen.getByLabelText("Source type"), {
    target: { value: "driver_license" },
  });
  fireEvent.change(screen.getByLabelText("Source reference or description"), {
    target: { value: "Driver reported license source" },
  });
  fireEvent.change(screen.getByLabelText("License number"), {
    target: { value: "0000123" },
  });
  fireEvent.change(screen.getByLabelText("Source document"), {
    target: {
      files: [
        new File(["%PDF-synthetic"], "source.pdf", { type: "application/pdf" }),
      ],
    },
  });
  await screen.findByText(/Source document ready/);
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Save this as received, unverified evidence",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Prepare source" }));
  expect(api.receiveComplianceSource).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Save received evidence" }),
  );
  await screen.findByText(/Source save needs verification/);
  expect(saved).not.toHaveBeenCalled();
  expect(commands).toHaveLength(0);
  fireEvent.click(
    screen.getByRole("button", { name: "Retry the same received evidence" }),
  );
  await waitFor(() => expect(commands).toHaveLength(1));
  await screen.findByText(/Source save needs verification/);
  expect(saved).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Retry the same received evidence" }),
  );
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(uploads[1]).toEqual(uploads[0]);
  expect(commands[1]).toEqual(commands[0]);
  expect(commands[0].record.attributes).toMatchObject({
    licenseNumber: "0000123",
    issuingState: null,
    licenseClass: null,
    licenseStatus: "unverified",
  });
  expect(commands[0].record.evidence.status).toBe("document_received");
  expect(commands[0].record.evidence.privateDocumentRef).toContain(
    "/documents/",
  );
});
