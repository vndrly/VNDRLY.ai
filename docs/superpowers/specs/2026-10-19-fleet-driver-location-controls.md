# Driver location controls

User direction: active paid Fleet runs share this phone automatically. Manual foreground/background start/stop controls are removed. Only a company policy manager may enable driver pausing; the policy defaults off. One labeled dot-on-slider switch then represents sharing on/off. An approved pause survives reopening the same run on the same account/session; revoking policy permission resumes automatic collection. Completing or pausing work stops the run collector.

Use the existing native operations company JSON policy, authenticated manager endpoint, current-duty checks, designated phone, device consent and iOS location permissions. No inferred consent, new dependency, schema change, forced permission, or fabricated physical arrival. Existing pending location reports are preserved. Permission setup is shown only when needed; accepting Fleet location setup enrolls an undesignated phone, preserving any different designated phone.

User UI preference: use dot-on-slider controls for binary settings as existing surfaces are redesigned. Save/Start Run/Arrived remain actions. Applied here to native operations company policy switches and the optional driver pause control.

Acceptance: current physical iPhone run/ticket100009 remains synthetic. UI changes, automated tests and an OTA release do not establish offline/photo/OS termination/push/background GPS/provider acceptance.

Consent is durable for the same user/device, inherited by later shifts/runs, and checked before displaying the consent screen. Missing OS permissions use the permission setup action, not another consent question. Reuse preserves the original acceptance timestamp. Revoked/missing consent remains unaccepted. The existing clipped accept control loses conflicting vertical padding and gains bottom scroll spacing.
