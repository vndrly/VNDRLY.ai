# MidCon notification hold — 2026-11-09

John explicitly ordered all MidCon notifications paused until he explicitly instructs resume. Deployments, restarts, tests, changed preferences and future releases do not authorize resume. No automatic expiry exists.

The server operational hold is in `artifacts/api-server/src/lib/notification-company-hold.ts`, vendor1054 (MidCon Solutions). It resolves current memberships, linked employees and active sponsored workers on each check, so future recipients are included and switching active company does not bypass the hold. Notification lookup failures withhold delivery. Other unrelated recipients retain their preferences and delivery behavior.

The hold filters notification fanout before creating ordinary/urgent records, hides stored inbox/badge rows, blocks real-time browser events, and rechecks native push, urgent multi-channel retries and notification email/digests. Existing notification history, device registrations and opt-in preferences are preserved. Authentication password-reset/verification messages remain separate from notification alerts. No test notification is sent to MidCon.

The read-only platform-admin endpoint `GET /api/notifications/company-holds` reports company identity, covered recipient count, channels and indefinite hold. It has no resume action. Only John's explicit instruction to resume authorizes removing this operational hold and releasing a new API version. Historical queued alerts remain withheld during the hold; review stale backlog before any explicitly authorized future resume.
