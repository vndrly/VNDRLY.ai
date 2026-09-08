export const marketingCtaHref = "/signup";
export const MARKETING_MODULES = [
  ["Sites, geofences & QR", "Coordinate locations with mapped boundaries, wellhead context, and QR-initiated field workflows."],
  ["Tickets & field workflow", "Move work from acceptance through field execution, review, payment, and a clear audit trail."],
  ["Scheduling, crews & live maps", "Align assignments, crew availability, GPS phases, and operations views in one connected flow."],
  ["Gate & visitor operations", "Support safer arrivals with visitor entry, gate logs, QR passes, and accountable site access."],
  ["Hotlist & service catalogs", "Match field demand with vendor services while keeping catalogs and eligibility coherent."],
  ["Files, notes & comments", "Keep operational context attached to the work instead of scattered across personal tools."],
  ["Work Hub collaboration", "Bring channels, calendars, tasks, files, forms, announcements, and meetings into VNDRLY context."],
  ["Tasks, checklists & approvals", "Turn handoffs into owned work with repeatable forms, acknowledgements, and approval paths."],
  ["Audio meetings & transcripts", "Consent-aware meeting records and transcripts are designed as an optional capability when enabled."],
  ["AskV assistance", "Use role-aware assistance to find context and move through VNDRLY workflows with appropriate controls."],
  ["Notifications", "Route operational updates by category and urgency while respecting user preferences."],
  ["Analytics, accounting & 1099", "Connect operational records to reporting, accounting workflows, and year-end tax preparation."],
  ["Branding & mobile", "Give each organization a coherent branded experience across responsive web and field-ready mobile."],
].map(([title, description]) => ({ title, description, ctaHref: marketingCtaHref }));
