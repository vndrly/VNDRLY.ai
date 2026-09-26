export const marketingCtaHref = "/signup";
export const marketingDemoHref =
  "mailto:support@vndrly.ai?subject=VNDRLY%20demo%20request";

export const FEATURED_SOLUTIONS = [
  {
    title: "Hotlist",
    eyebrow: "Find the right vendor faster",
    description:
      "Turn urgent field demand into a qualified opportunity without rebuilding the vendor search from scratch.",
    points: [
      "Match requested work with vendor service catalogs and operating areas.",
      "Compare verified activity, responsiveness, and ratings without exposing customer identities.",
      "Keep bidding, eligibility, and assignment context connected to the job.",
    ],
  },
  {
    title: "VNDRLY Gate (or upgrade to Gate Pro)",
    eyebrow: "Run accountable gate operations",
    description:
      "Connect gate locations, shifts, arrivals, visitors, handoffs, and history in one operational record.",
    points: [
      "Schedule authorized gatekeepers and supervisors by location.",
      "Track arrivals, departures, passes, notes, and shift changes.",
      "Give office and field teams a shared view of gate activity.",
    ],
  },
];

export const MARKETING_MODULES = [
  [
    "Plan & dispatch",
    "Sites, geofences, service catalogs, Hotlist opportunities, scheduling, assignments, and notifications keep the next move clear.",
  ],
  [
    "Execute & verify",
    "Mobile tickets, QR workflows, authorized GPS phases, hours, mileage, gate records, credentials, and completion evidence document the work as it happens.",
  ],
  [
    "Collaborate & hand off",
    "Work Hub brings channels, calendars, tasks, forms, files, notes, comments, announcements, meetings, and handoffs into operational context.",
  ],
  [
    "Review & report",
    "Approvals, analytics, accounting context, exports, audit history, and year-end reporting turn field facts into office-ready records.",
  ],
].map(([title, description]) => ({
  title,
  description,
  ctaHref: marketingCtaHref,
}));

export const JOB_WORKFLOW = [
  ["Find", "Discover a qualified vendor by service, location, and verified signals."],
  ["Dispatch", "Send the opportunity with the site and work context attached."],
  ["Accept", "The vendor confirms capacity and takes ownership of the work."],
  ["Assign", "Schedule the right crew, gate team, equipment, and instructions."],
  ["Verify", "Capture arrival, time, mileage, credentials, progress, and evidence."],
  ["Complete", "Field teams finish the work and submit the connected record."],
  ["Approve", "Vendor and partner offices review the same facts and close the handoff."],
];

export const PARTNER_BENEFITS = [
  "Discover vendors by service, geography, verified activity, responsiveness, and ratings.",
  "See live operational facts without chasing calls, texts, spreadsheets, or paper logs.",
  "Review compliance, field completion, and approval-ready records in one accountable workflow.",
];

export const VENDOR_BENEFITS = [
  "Maintain an accurate service profile and build a portable reputation through verified work.",
  "Coordinate people, schedules, credentials, gates, tickets, files, and office handoffs.",
  "Turn completed field work into cleaner billing records and a faster path toward payment.",
];
