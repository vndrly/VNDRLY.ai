# Company form campaigns

Tasks & Forms supports policy acknowledgements, timed polls, and campaigns based on existing company forms. Company administrators save a draft, review its content and current eligible audience, then publish. Drafts send no invitations. Publication starts the canonical server deadline and queues in-app notifications and eligible push delivery.

Policy acknowledgements default to 30 elapsed days. Supply the real approved policy text or a finalized company-level attachment and a policy version. Published attachment bytes are copied and checksum-verified; later source-file changes do not alter the acknowledged copy. Employees must explicitly acknowledge their assigned version. Late responses remain possible and carry a late receipt.

Polls default to 24 elapsed hours. Configure named or anonymous answers, one or several choices, vote changes, and aggregate results during voting or at close. The server rejects submissions at or after closing, including delayed offline submissions. Anonymous responses never appear as individual answers in owner progress, CSV exports, or embedded assistant views.

Existing-form campaigns snapshot a current company template. Supported fields are text, textarea, number, and checkbox; unsupported source definitions fail explicitly rather than silently dropping fields. Required fields are validated on the server. Owners can review submitted answers and export named responses.

Audience can be all active company members or selected members. Optional rolling membership adds new eligible employees before the deadline. Removed or suspended employees lose access and are counted separately as excluded. Review audience counts and estimated deadlines refresh; the server rechecks both at publication.

Optional reminders target nonresponders. Optional daily owner briefings are stored in the inbox with counts and a campaign link. The configured IANA timezone controls briefing time and quiet-hours deferral, including DST. Optional escalation targets a current company administrator. Queue state does not prove push delivery.

Opening a page never submits a response. After an uncertain network result, Retry original request preserves its operation ID and payload. Exact form/campaign links preserve login destinations and recheck current company authority. Copying a link grants no access.

AskV uses the same APIs and current permissions, with existing exact-value confirmation for writes. It may submit only the caller's explicitly confirmed assigned response. Plugin candidate 1.13.0 contains the matching guidance and embedded views; this documentation does not claim installation or public approval.

The example at examples/midcon-security-campaign-draft.json is an unpublished configuration with no policy text. It is not an employee assignment or an approved MidCon policy. Supply real content before publication.

Local implementation does not apply the additive migration or enable the production worker. Isolated PostgreSQL transaction/concurrency tests, real-device push/login checks, and deployment remain required release evidence.
