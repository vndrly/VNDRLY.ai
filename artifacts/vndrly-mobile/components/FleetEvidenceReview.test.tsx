import React from "react";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { createFleetComplianceSourceDraft, FleetComplianceRecordSchema } from "@workspace/api-zod";
import { it, expect, vi, afterEach } from "vitest";
import FleetEvidenceReview from "./FleetEvidenceReview";
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.api }));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({}),
  isAuthScopeCurrent: () => true,
}));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    text: "white",
    card: "gray",
    primary: "gold",
    destructive: "red",
  }),
}));
vi.mock("./FleetCheckbox",()=>({default:({label,checked,disabled,onChange}:any)=><button role="checkbox" aria-label={label} aria-checked={checked} disabled={disabled} onClick={()=>onChange(!checked)}>{label}</button>}));
vi.mock("./TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("./FleetChoiceField", () => ({
  default: ({ label, value, onChange, options, disabled }: any) => (
    <select
      disabled={disabled}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Choose</option>
      {options.map((option: any) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
afterEach(() => {
  cleanup();
  mocks.api.mockReset();
});
it("suppresses private fields and review actions when current appointed-reviewer access is refused", async () => {
  mocks.api.mockRejectedValue(new Error("403"));
  render(
    <FleetEvidenceReview
      evidenceId="11111111-1111-4111-8111-111111111111"
      revision={1}
      onSaved={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText("Prepare evidence review")).toBeNull();
  expect(mocks.api.mock.calls).toHaveLength(1);
  expect(mocks.api.mock.calls[0][0]).toContain("/private?revision=1");
});
it("retains the exact native review through lost readback and confirms the canonical next evidence revision", async () => {
  const record = FleetComplianceRecordSchema.parse({
    evidence: {
      id: crypto.randomUUID(),
      revision: 1,
      subject: { kind: "driver", id: 7 },
      requirementId: "license",
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
      endorsements: [],
      restrictions: [],
      licenseStatus: "active",
      sourceRecordId: null,
    },
    retentionClass: "qualification",
    retainUntil: null,
    legalHold: false,
  });
  let body: any,
    reads = 0;
  const sent: any[] = [],
    saved = vi.fn();
  mocks.api.mockImplementation(async (path: string, options: any) => {
    if (path.endsWith("revision=1")) return record;
    if (path.endsWith("/review")) {
      body = JSON.parse(options.body);
      sent.push(body);
      return {
        id: record.evidence.id,
        revision: 2,
        subject: record.evidence.subject,
        status: body.decision,
        updatedAt: "2026-10-16T18:00:00Z",
      };
    }
    if (++reads === 1) throw new Error("Lost readback");
    return {
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
        reportedReviewedAt: body.reviewedAt,
        reviewedAt: "2026-10-16T18:00:00Z",
        reviewerUserId: 2,
        filingSource: null,
      },
    };
  });
  render(
    <FleetEvidenceReview
      evidenceId={record.evidence.id}
      revision={1}
      onSaved={saved}
      onClose={vi.fn()}
    />,
  );
  await screen.findByText("PRIVATE-1234");
  fireEvent.change(screen.getByLabelText("Review decision"), {
    target: { value: "verified" },
  });
  fireEvent.change(screen.getByLabelText("Verification source"), {
    target: { value: "government_registry" },
  });
  fireEvent.change(screen.getByLabelText("Source reference"), {
    target: { value: "Registry #9" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "I checked this source now" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Prepare evidence review" }),
  );
  expect(sent).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Save evidence review" }));
  await screen.findByText(/Review outcome needs verification/);
  expect(saved).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Retry the same evidence review" }),
  );
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual(sent[0]);
});

it("requires explicit insurance scope and filing review and verifies the saved coverage decision",async()=>{
 const record=createFleetComplianceSourceDraft({id:"11111111-1111-4111-8111-111111111111",subject:{kind:"carrier",id:7},kind:"insurance",coverageType:"excess",source:"Synthetic policy",at:"2026-10-16T18:00:00Z"}),saved=vi.fn();let body:any;let reads=0;let readResult:()=>Promise<any>;
 readResult=async()=>{if(!reads++)return record;return {...record,evidence:{...record.evidence,revision:2,status:body.decision,verifiedAt:"2026-10-16T19:00:00Z",verifiedByUserId:2},attributes:{kind:"insurance",coverage:{...(record.attributes as any).coverage,revision:2,state:body.decision,reviewedAt:"2026-10-16T19:00:00Z",reviewedByUserId:2,scopesReviewed:reads>2,followFormReviewed:true,filingStatus:"accepted",filingVerifiedAt:"2026-10-16T19:00:00Z"}},review:{source:body.source,reviewedAt:"2026-10-16T19:00:00Z",reportedReviewedAt:body.reviewedAt,reviewerUserId:2,filingSource:body.coverageReview.filingSource}};};
 mocks.api.mockImplementation(async(path:string,options:any)=>{if(options?.method==="POST"){body=JSON.parse(options.body);return {id:record.evidence.id,revision:2,subject:record.evidence.subject,status:body.decision,updatedAt:"2026-10-16T19:00:00Z"};}return readResult();});
 render(<FleetEvidenceReview evidenceId={record.evidence.id} revision={1} onSaved={saved} onClose={vi.fn()}/>);
 fireEvent.click(await screen.findByRole("checkbox",{name:"I reviewed the listed coverage scope"}));fireEvent.click(screen.getByRole("checkbox",{name:"I reviewed the excess follow-form terms"}));
 fireEvent.change(screen.getByLabelText("Review decision"),{target:{value:"verified"}});fireEvent.change(screen.getByLabelText("Verification source"),{target:{value:"insurer_confirmation"}});fireEvent.change(screen.getByLabelText("Source reference"),{target:{value:"Insurer source"}});
 fireEvent.change(screen.getByLabelText("Filing decision"),{target:{value:"accepted"}});fireEvent.change(screen.getByLabelText("Filing verification source"),{target:{value:"government_registry"}});fireEvent.change(screen.getByLabelText("Filing source reference"),{target:{value:"Accepted filing #SYNTHETIC"}});
 fireEvent.click(screen.getByRole("button",{name:"I checked this source now"}));fireEvent.click(screen.getByRole("button",{name:"Prepare evidence review"}));fireEvent.click(screen.getByRole("button",{name:"Save evidence review"}));await screen.findByText(/Review outcome needs verification/);expect(saved).not.toHaveBeenCalled();expect(body.coverageReview).toEqual({scopesReviewed:true,followFormReviewed:true,filingStatus:"accepted",filingSource:{kind:"government_registry",reference:"Accepted filing #SYNTHETIC",url:null}});fireEvent.click(screen.getByRole("button",{name:"Retry the same evidence review"}));await waitFor(()=>expect(saved).toHaveBeenCalledOnce());const writes=mocks.api.mock.calls.filter(call=>call[1]?.method==="POST");expect(writes[1][1].body).toEqual(writes[0][1].body);
});
