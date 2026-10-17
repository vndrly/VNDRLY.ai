import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
import FleetComplianceRegister from "./FleetComplianceRegister";
vi.mock("./FleetEvidenceReview",()=>({default:()=> <div>Private reviewer opened</div>}));
vi.mock("./FleetComplianceFacts",()=>({default:({subject}:any)=><div>Applicability opened {subject.kind}:{subject.id}</div>}));
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
vi.mock("./TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("./FleetChoiceField", () => ({
  default: ({ label, value, onChange, options }: any) => (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
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
it("starts carrier applicability from current company identity without requiring an evidence row",async()=>{
 mocks.api.mockResolvedValue({entries:[],nextCursor:null,mode:"warn_only"});render(<FleetComplianceRegister companyId={7}/>);fireEvent.click(screen.getByRole("button",{name:"Carrier applicability"}));expect(screen.getByText("Applicability opened carrier:7")).toBeTruthy();
});
it("requires an explicit reviewer selection and clears private review when switching registers",async()=>{
 mocks.api.mockResolvedValue({entries:[{id:"11111111-1111-4111-8111-111111111111",revision:1,subject:{kind:"carrier",id:7},requirementId:"authority",requirementVersion:1,kind:"credential",verification:"document_received",status:"red",reasons:["unverified"],validUntil:null,evaluatedAt:"2026-10-16T18:00:00Z",maskedIdentifier:null,mayReview:true}],mode:"warn_only",nextCursor:null});
 render(<FleetComplianceRegister/>);const button=await screen.findByRole("button",{name:"Review evidence"});expect(screen.queryByText("Private reviewer opened")).toBeNull();fireEvent.click(button);expect(screen.getByText("Private reviewer opened")).toBeTruthy();fireEvent.change(screen.getByLabelText("Register"),{target:{value:"vehicle"}});expect(screen.queryByText("Private reviewer opened")).toBeNull();
});
it("shows safe native evidence status and never fetches private records to draw a compliance card", async () => {
  mocks.api.mockResolvedValue({
    entries: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        revision: 1,
        subject: { kind: "driver", id: 7 },
        requirementId: "OK-license",
        requirementVersion: 1,
        kind: "driver_license",
        verification: "document_received",
        status: "red",
        reasons: ["unverified"],
        validUntil: null,
        evaluatedAt: "2026-10-16T18:00:00Z",
        maskedIdentifier: "••••1234",
        mayReview: false,
      },
    ],
    mode: "warn_only",
    nextCursor: null,
  });
  render(<FleetComplianceRegister />);
  expect(await screen.findByText("••••1234")).toBeTruthy();
  expect(screen.getByText(/warnings do not block/i)).toBeTruthy();
  expect(
    mocks.api.mock.calls.some((call) => /private|document/.test(call[0])),
  ).toBe(false);
  mocks.api.mockRejectedValue(new Error("403"));
  fireEvent.change(screen.getByLabelText("Register"), {
    target: { value: "vehicle" },
  });
  await screen.findByRole("alert");
  expect(screen.queryByText("••••1234")).toBeNull();
});
vi.mock("./FleetComplianceRules",()=>({default:()=> <div>Requirements opened</div>}));
it("opens native requirement history only on request",async()=>{
 mocks.api.mockResolvedValue({entries:[],nextCursor:null,mode:"warn_only"});render(<FleetComplianceRegister/>);expect(screen.queryByText("Requirements opened")).toBeNull();fireEvent.click(screen.getByRole("button",{name:"Requirements and history"}));expect(screen.getByText("Requirements opened")).toBeTruthy();
});
