export type AdmissionMode = "company_open" | "host_approval";
export type AdmissionState = "pending" | "admitted" | "declined";
export function meetingAdmissionDecision(i: {
  currentMember: boolean; owner: boolean; companyAdmin: boolean; ended: boolean;
  mode: AdmissionMode | null; state: AdmissionState | null; removed: boolean; participant: boolean;
}) {
  const eligible = i.currentMember && !i.removed;
  const discover = eligible && (i.mode !== null || i.participant);
  const manage = eligible && (i.owner || i.companyAdmin);
  return {
    discover,
    enter: discover && !i.ended && (manage || i.mode === "company_open" || (i.participant && (i.state === "admitted" || (i.mode === null && i.state === null)))),
    request: discover && !i.ended && i.mode === "host_approval" && !manage && i.state !== "admitted" && i.state !== "declined",
    manage,
  };
}
