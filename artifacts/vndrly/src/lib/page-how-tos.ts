export type PageHowTo = { title: string; steps: string[] };
/** Instructions describe controls on this route only, never account-wide tasks. */
const pageHowTos: Record<string, PageHowTo[]> = {
  "/gate/map": [{title:"How to view staff locations",steps:["Choose a site and gate, or All.","Open Reveal Staff and select Show.","Only current shared locations appear as pins; other staff remain in Staff locations."]},{title:"How to review site presence",steps:["Find Site Presence below Staff locations and Gate activity.","Open a person’s entry to review the recorded check-in."]}],
  "/gate/change-over": [
    {title:"How to review gate activity",steps:["Choose the site and gate.","Expand a Gate activity row to see its records.","Open a record to review its gate log."]},
    {title:"How to report an incident",steps:["Select Report an incident in the header.","Review the site, choose the incident type, and describe what happened.","Submit the report when the details are correct."]},
    {title:"How to hand off a watch",steps:["Review Watch & handover and the current gate.","Enter the shift handoff notes and review open items.","Use Sign Handoff to save the handoff."]},
  ],
  "/gate": [{title:"How to check someone in",steps:["Choose the correct site and gate.","Enter the visitor and vehicle details in the check-in form.","Review the filled details and submit the check-in."]}],
  "/work-hub": [{title:"How to find your work",steps:["Open My Work under Today.","Choose the assignment you want to review."]},{title:"How to review assigned training",steps:["Expand a certification or course in the training card.","Open the course to review its instruction and saved progress."]}],
  "/work-hub/profile": [{title:"How to edit your profile",steps:["Expand Edit Profile & Update Password.","Update your details and select Save Changes."]},{title:"How to update a credential",steps:["Expand the appropriate certification or license list.","Choose Edit on the credential card.","Update its details or supporting documents and save."]}],
  "/work-hub/calendar": [{title:"How to review your schedule",steps:["Select the date you want to review.","Open a scheduled item to review its details."]}],
  "/work-hub/managed-crews": [{title:"How to review tasks and crews",steps:["Open the task or crew list you need.","Select an item to review its details and available actions."]}],
  "/work-hub/chat": [{title:"How to open a conversation",steps:["Choose a conversation from the list.","Read the messages and enter your reply.","Select Send when the reply is ready."]}],
  "/work-hub/library": [{title:"How to find a course",steps:["Choose Courses or Certifications.","Search for the training you need.","Open its card to review the course or certification details."]}],
  "/gate/history": [{title:"How to find a gate record",steps:["Choose the site, gate, and date range.","Select the record type and open a matching record."]}],
};
export function howTosForPage(path: string): PageHowTo[] {
  const route = path.split("?")[0].replace(/\/\(tabs\)/, "").replace(/\/$/, "");
  const aliases: Record<string, string> = { "/profile": "/work-hub/profile", "/edit-profile": "/work-hub/profile", "/calendar": "/work-hub/calendar", "/work-hub/library/index": "/work-hub/library" };
  return pageHowTos[aliases[route] ?? route] ?? [];
}
