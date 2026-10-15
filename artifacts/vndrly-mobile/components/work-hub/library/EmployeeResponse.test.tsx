import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { vi, it, expect, afterEach } from "vitest";
import en from "@/lib/locales/en.json";
const m = vi.hoisted(() => ({ data: null as any, send: vi.fn() }));
vi.mock("@/lib/use-form-campaigns", () => ({
  useFormCampaigns: () => ({
    data: m.data,
    contextKey: "one",
    send: m.send,
    busy: false,
    uncertain: false,
  }),
}));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key.split(".").reduce((v: any, k) => v?.[k], en) ?? key,
  }),
}));
vi.mock("../../TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("react-native", () => ({
  View: ({ children }: any) => <div>{children}</div>,
  Text: ({ children }: any) => <span>{children}</span>,
  TextInput: ({ accessibilityLabel, value, onChangeText }: any) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
  Linking: { openURL: vi.fn() },
}));
vi.mock("@/lib/meeting-files", () => ({
  downloadAndShareProtectedFile: vi.fn(),
}));
import EmployeeResponse from "./EmployeeResponse";
afterEach(() => {
  cleanup();
  m.send.mockReset();
});
it("submits a quiz only from the explicit action with lesson checkoff and acknowledgement", async () => {
  m.data = {
    instanceId: "test",
    title: "Orientation",
    version: 2,
    canSubmit: true,
    attachments: [],
    history: [],
    assignment: {
      status: "assigned",
      dueAt: "2026-11-14T12:00:00Z",
      progress: { lessonIds: [], answers: {} },
    },
    metadata: {
      kind: "training",
      contentVersion: 1,
      content: {
        description: "Intro",
        fields: [],
        training: {
          completionMode: "both",
          lessons: [
            {
              id: "intro",
              title: "Read this",
              body: "Instructions",
              links: [],
              fileIds: [],
            },
          ],
          questions: [
            {
              id: "q",
              prompt: "Choose",
              multiple: false,
              options: [
                { id: "a", label: "A" },
                { id: "b", label: "B" },
              ],
            },
          ],
          passingPercent: 80,
          maximumAttempts: 3,
          allowRetries: true,
        },
      },
    },
  };
  m.send.mockResolvedValue({
    resource: {
      status: "completed",
      grade: { passed: true, scorePercent: 100 },
    },
  });
  render(<EmployeeResponse instanceId="test" />);
  fireEvent.click(screen.getByText("Mark lesson complete"));
  fireEvent.click(screen.getByText("A"));
  fireEvent.click(screen.getByText("I completed the required lessons"));
  expect(m.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Submit quiz"));
  await screen.findByText("Passed");
  expect(m.send).toHaveBeenCalledWith(
    "/api/work-hub/library/instances/test/attempt",
    expect.objectContaining({
      acknowledged: true,
      lessonIds: ["intro"],
      answers: { q: ["a"] },
    }),
    2,
  );
});

it("shows immutable saved answers when reviewing a completed form",()=>{
 m.data={instanceId:"saved",title:"Company form",version:3,canSubmit:false,attachments:[],assignment:{status:"completed",progress:{lessonIds:[],answers:{}}},metadata:{kind:"form",contentVersion:1,content:{fields:[{id:"note",label:"Comment",type:"text",required:true,options:[]}]}},history:[{id:"receipt",version:1,submittedAt:"2026-10-14T12:00:00Z",values:{note:"Saved employee answer"}}]};
 render(<EmployeeResponse instanceId="saved"/>);expect(screen.getByDisplayValue("Saved employee answer")).toBeTruthy();expect(m.send).not.toHaveBeenCalled();
});
