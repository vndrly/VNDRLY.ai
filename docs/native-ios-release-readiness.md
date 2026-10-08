# Native work and cooperative V release

This candidate includes the previously validated shift-opening/background-work candidate and the approved native interview implementation. Applicable companies receive the capabilities by default and can opt out. Existing company modules, current role/site authority, worker consent and device permissions still determine use.

## Implemented behavior

- Manual, assigned-ticket and scheduled duty; End Duty suppresses automated restart and location collection. Workers choose their designated work phone and separately consent to location sharing. Other devices remain viewers.
- Purpose-bound supervisor location/photo requests share the same saved request across web, Ask V and ChatGPT. Location requests require fresh observations and fail unavailable rather than queue offline. Photo requests preserve their original upload identity, worker review and exact ticket association.
- Offline Gate, inventory and notes preserve original operation identities, observed times and conflicts. Reconciliation rechecks current authority. Offline observations do not assert admission approval or verified identity.
- Gate document scanning/manual review saves only reviewed fields and a restricted source image. Image reads expire at the retention deadline; cleanup removes active objects. Technical diagnostics exclude ID text/images and private connection content.
- Live Activities, authenticated system shortcuts, notification review/reply/assignment responses, local dictation and drafts, and file-backed background photo uploads use canonical record readback. Unsupported OS capabilities keep manual workflows available.
- Automatic arrival requires company and worker settings, fresh measured geometry and the designated phone. It records arrival without starting the clock. Correction preserves the original observation and audit.
- One V selectively uses approved Anthropic/OpenAI engines with shared context and bounded consultation. Domain denials do not trigger an engine workaround. Saved tasks preserve completed steps; personal connections require explicit per-task permission and separate intent before company saving.
- Company administrators can inspect estimated AI usage and alert thresholds without a hard spending stop. Support receives technical status by default; temporary company grants name the worker/site and purpose before content access.

## Release boundaries

The native release uses app/runtime version **1.0.3**. An initial OTA run must honor the native-impact safety guard. Publish its compatible OTA only after the exact 1.0.3 native build finishes; older 1.0.2 installs cannot receive its new native JavaScript.

The production migration contains only additive `ADD COLUMN IF NOT EXISTS` statements. Existing storage buckets are reused. The isolated verification workflow uses newly created runner-local databases and never resets development or production data.

The existing installed ChatGPT plugin identity and linked grants are preserved in package **1.10.0**. The installed update, public review submission, approval and public availability are distinct states.

Focused checks establish server authority, retry identities, permission redaction, transaction races and component behavior. The combined exact-tree repository gate, signed native archive, live release tracks and actual scoped plugin action/readback must be recorded separately. A server receipt or simulator test cannot establish physical iPhone camera, Siri, suspended upload, silent-push delivery, lock-screen or long-shift behavior. Physical execution remains unverified until evidence from a supported device exists.
