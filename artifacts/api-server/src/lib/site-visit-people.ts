type VisitPerson = { role: 'lead' | 'crew'; sessionId: number | null; employeeId: number; travelMinutes: number | null };

/** Structured sessions supersede the legacy ticket snapshot for the same lead.
 * Keep every recorded visit and its evidence; only the duplicate snapshot is omitted. */
export function canonicalSiteVisitPeople<T extends VisitPerson>(people: T[]): T[] {
 const lead = people.find(person => person.role === 'lead' && person.sessionId === null);
 if (!lead) return people;
 const sessions = people.filter(person => person.sessionId !== null && person.employeeId === lead.employeeId);
 if (!sessions.length) return people;
 const firstSessionId = sessions[0]!.sessionId;
 return people.filter(person => person !== lead).map(person => person.employeeId === lead.employeeId && person.sessionId !== null
  ? { ...person, role: 'lead', travelMinutes: person.travelMinutes ?? (person.sessionId === firstSessionId ? lead.travelMinutes : null) }
  : person);
}
