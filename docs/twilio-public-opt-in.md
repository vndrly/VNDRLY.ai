# VNDRLY public SMS enrollment

The supported public form is `https://vndrly.ai/sms/`; `/legal/messaging/` presents the same form. Both are emitted as readable HTML at build time. They are not chat widgets, modals or disabled previews. JavaScript only improves the save response.

Users enter their own mobile number and select an initially unchecked consent box. They must sign in to save. SMS is never required for account creation or service use. The same-origin authenticated POST stores server time, exact disclosure, policy version, source and current membership in `notification_preferences.sms_consent_record`. Each grant appends an audit event without the raw phone. This is a self-attested web opt-in, not an OTP verification of phone ownership.

For Gate accounts the number must match the active saved employee phone, and the existing account/membership/phone-bound delivery consent is updated atomically with the evidence. Other accounts retain evidence without acquiring Gate access or new delivery capabilities. No text is sent by enrollment. Provider Advanced Opt-Out and STOP suppression remain authoritative; web enrollment cannot remove a carrier block. Existing role, subscription, readiness and delivery checks still apply.

Deploy `migrate:public-sms-consent` (one additive `ADD COLUMN IF NOT EXISTS`) before the API. Capture an empty form with its unchecked choice and legal links after deployment; publish that screenshot and reference both it and the real form URL in the existing Twilio campaign's message flow. Rerun the checker and record the actual result. Do not submit until the user reviews it and expressly releases the hold. Keep the described opt-in method supported after approval.
