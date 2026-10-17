import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import FleetComplianceIntake from "./FleetComplianceIntake";
import {draftFleetRequirement} from "@workspace/api-zod";
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  pick: vi.fn(),
  read: vi.fn(),
  current: true,
}));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.api }));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({ generation: 1 }),
  isAuthScopeCurrent: () => mocks.current,
}));
vi.mock("@/lib/native-work-capture", () => ({
  pickWorkDocumentDraft: mocks.pick,
  readWorkDocumentDraft: mocks.read,
}));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    text: "white",
    card: "gray",
    primary: "gold",
    destructive: "red",
  }),
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("./TogglePillButton", () => ({
  default: ({ children, disabled, onPress }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("./FleetChoiceField", () => ({
  default: ({ label, value, options, onChange, disabled }: any) => (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Choose</option>
      {options.map((row: any) => (
        <option key={row.id} value={row.id}>
          {row.label}
        </option>
      ))}
    </select>
  ),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  mocks.current = true;
});
it("uses only the selected adopted requirement reference when receiving a native source",async()=>{
 const reference=draftFleetRequirement("driver-license",{version:3,effectiveFrom:"2026-10-16T12:00:00Z"}),saved=vi.fn(),writes:any[]=[];
 mocks.api.mockImplementation(async(path:string,options:any)=>{if(path.includes("/subjects?"))return {entries:[{subject:{kind:"driver",id:7},label:"Synthetic driver",canSubmit:true}],nextCursor:null};if(path.endsWith("/requirements"))return {requirements:[{...reference,source:{...reference.source,reviewedAt:"2026-10-16T12:00:00Z",reviewedByUserId:11}}],canAdopt:false,mode:"warn_only"};if(options?.method==="POST"){const body=JSON.parse(options.body);writes.push(body);return {id:body.record.evidence.id,revision:1,subject:body.record.evidence.subject,status:"document_received",updatedAt:"2026-10-16T22:00:00Z"};}return {id:writes[0].record.evidence.id,revision:1,subject:{kind:"driver",id:7},status:"document_received",updatedAt:"2026-10-16T22:00:00Z"};});
 render(<FleetComplianceIntake onSaved={saved} onClose={vi.fn()}/>);await screen.findByRole("option",{name:"Synthetic driver"});fireEvent.change(screen.getByLabelText("For"),{target:{value:"driver:7"}});fireEvent.change(screen.getByLabelText("Source type"),{target:{value:"driver_license"}});await screen.findByRole("option",{name:"Driver license, class and endorsements · 3"});fireEvent.change(screen.getByLabelText("Adopted requirement"),{target:{value:"driver-license"}});fireEvent.change(screen.getByLabelText("Source reference or description"),{target:{value:"Worker source"}});fireEvent.click(screen.getByRole("checkbox",{name:"Save this as received, unverified evidence"}));fireEvent.click(screen.getByRole("button",{name:"Prepare source"}));fireEvent.click(screen.getByRole("button",{name:"Save received evidence"}));await waitFor(()=>expect(saved).toHaveBeenCalledOnce());expect(writes[0].record.evidence).toMatchObject({requirementId:"driver-license",requirementVersion:3,status:"document_received",verifiedAt:null});
});
it("stops the native intake chain when its original authentication context is lost during upload", async () => {
  let finish!: (value: unknown) => void, upload: any;
  const writes: any[] = [];
  mocks.pick.mockResolvedValue({
    fileId: "70000000-0000-4000-8000-000000000001",
    byteSize: 14,
    sha256: "a".repeat(64),
    uri: "file:///private/source",
    source: "system_document_picker",
    contentType: "application/pdf",
    reviewRequired: true,
    canonicalSaved: false,
  });
  mocks.read.mockResolvedValue({
    fileId: "70000000-0000-4000-8000-000000000001",
    byteSize: 14,
    sha256: "a".repeat(64),
    contentType: "application/pdf",
    bodyBase64: "JVBERi1zeW50aGV0aWM=",
  });
  mocks.api.mockImplementation(async (path: string, options: any) => {
    if (path.includes("/subjects?"))
      return {
        entries: [
          {
            subject: { kind: "driver", id: 7 },
            label: "Synthetic driver",
            canSubmit: true,
          },
        ],
        nextCursor: null,
      };
    if (path.endsWith("/requirements"))
      return { requirements: [], canAdopt: false, mode: "warn_only" };
    if (path.endsWith("/documents")) {
      upload = JSON.parse(options.body);
      return new Promise((resolve) => {
        finish = resolve;
      });
    }
    if (options?.method === "POST") writes.push(JSON.parse(options.body));
    return {};
  });
  const view = render(
    <FleetComplianceIntake onSaved={vi.fn()} onClose={vi.fn()} />,
  );
  await screen.findByRole("option", { name: "Synthetic driver" });
  fireEvent.change(screen.getByLabelText("For"), {
    target: { value: "driver:7" },
  });
  fireEvent.change(screen.getByLabelText("Source type"), {
    target: { value: "driver_license" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Choose source document" }),
  );
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
  await waitFor(() => expect(upload).toBeTruthy());
  mocks.current = false;
  view.rerender(<FleetComplianceIntake onSaved={vi.fn()} onClose={vi.fn()} />);
  await act(async () => {
    finish({
      objectPath: `/objects/fleet-compliance-private/11/${upload.recordId}/documents/${"a".repeat(64)}`,
    });
  });
  expect(writes).toHaveLength(0);
});
it("binds a selected private native source to its received revision and original request through lost responses", async () => {
  const saved = vi.fn(),
    uploads: any[] = [],
    commands: any[] = [];
  let uploadReads = 0,
    receiptReads = 0;
  mocks.pick.mockResolvedValue({
    fileId: "70000000-0000-4000-8000-000000000001",
    byteSize: 14,
    sha256: "a".repeat(64),
    uri: "file:///private/source",
    source: "system_document_picker",
    contentType: "application/pdf",
    reviewRequired: true,
    canonicalSaved: false,
  });
  mocks.read.mockResolvedValue({
    fileId: "70000000-0000-4000-8000-000000000001",
    byteSize: 14,
    sha256: "a".repeat(64),
    contentType: "application/pdf",
    bodyBase64: "JVBERi1zeW50aGV0aWM=",
  });
  mocks.api.mockImplementation(async (path: string, options: any) => {
    if (path.includes("/subjects?"))
      return {
        entries: [
          {
            subject: { kind: "driver", id: 7 },
            label: "Synthetic driver",
            canSubmit: true,
          },
        ],
        nextCursor: null,
      };
    if (path.endsWith("/requirements"))
      return { requirements: [], canAdopt: false, mode: "warn_only" };
    const body = options?.body ? JSON.parse(options.body) : null;
    if (path.endsWith("/documents")) {
      uploads.push(body);
      if (++uploadReads === 1) throw new Error("Lost upload response");
      return {
        objectPath: `/objects/fleet-compliance-private/11/${body.recordId}/documents/${"a".repeat(64)}`,
      };
    }
    if (options?.method === "POST") {
      commands.push(body);
      return {
        id: body.record.evidence.id,
        revision: 1,
        subject: body.record.evidence.subject,
        status: "document_received",
        updatedAt: "2026-10-16T22:00:00Z",
      };
    }
    if (++receiptReads === 1) throw new Error("Lost receipt");
    const current = commands[0];
    return {
      id: current.record.evidence.id,
      revision: 1,
      subject: current.record.evidence.subject,
      status: "document_received",
      updatedAt: "2026-10-16T22:00:00Z",
    };
  });
  render(<FleetComplianceIntake onSaved={saved} onClose={vi.fn()} />);
  await screen.findByRole("option", { name: "Synthetic driver" });
  fireEvent.change(screen.getByLabelText("For"), {
    target: { value: "driver:7" },
  });
  fireEvent.change(screen.getByLabelText("Source type"), {
    target: { value: "driver_license" },
  });
  fireEvent.change(screen.getByLabelText("License number"), {
    target: { value: "0000123" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Choose source document" }),
  );
  await screen.findByText(/Source document ready/);
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Save this as received, unverified evidence",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Prepare source" }));
  expect(commands).toHaveLength(0);
  fireEvent.click(
    screen.getByRole("button", { name: "Save received evidence" }),
  );
  await screen.findByText(/Source save needs verification/);
  expect(saved).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Retry the same received evidence" }),
  );
  await waitFor(() => expect(commands).toHaveLength(1));
  await screen.findByText(/Source save needs verification/);
  fireEvent.click(
    screen.getByRole("button", { name: "Retry the same received evidence" }),
  );
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(uploads[1]).toEqual(uploads[0]);
  expect(commands[1]).toEqual(commands[0]);
  expect(commands[0].record.attributes.licenseNumber).toBe("0000123");
  expect(commands[0].record.evidence.status).toBe("document_received");
  expect(mocks.api.mock.calls.every((call) => call[2]?.generation === 1)).toBe(
    true,
  );
});
