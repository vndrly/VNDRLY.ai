import type { ReactNode } from "react";
import { formatPhone } from "@/lib/utils";
import "./staffing-summary-list.css";

export type StaffingSummary = {
  id: string | number;
  name: string;
  email?: string | null;
  phone?: string | null;
  role: string;
  enrollment: ReactNode;
  remove?: ReactNode;
  onOpen: () => void;
};

/** Compact, read-only roster summaries; changes belong in the employee profile. */
export default function StaffingSummaryList({ people, emptyText = "No employees added yet" }: {
  people: StaffingSummary[];
  emptyText?: string;
}) {
  if (!people.length) return <p className="staffing-summary-empty">{emptyText}</p>;
  return <div className="staffing-summary-list" role="table" aria-label="Staffing summaries">
    <div className="staffing-summary-heading" role="row">
      {["Name", "Email", "Phone", "Role", "Sent Invite", ""].map((label, index) => <span key={index} role="columnheader">{label}</span>)}
    </div>
    {people.map(person => <div className="staffing-summary-row" role="row" key={person.id}>
      <span className="staffing-summary-name" role="cell"><button type="button" onClick={person.onOpen}>{person.name}</button></span>
      <span role="cell" data-label="Email" className="staffing-summary-email">{person.email || "—"}</span>
      <span role="cell" data-label="Phone">{person.phone ? formatPhone(person.phone) : "—"}</span>
      <span role="cell" data-label="Role">{person.role}</span>
      <span role="cell" data-label="Sent Invite">{person.enrollment}</span>
      <span role="cell" className="staffing-summary-remove">{person.remove}</span>
    </div>)}
  </div>;
}
