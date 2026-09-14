# Implementation A Work Hub Addendum

This addendum is part of Implementation A Task 17 and is required for the coordinated full ship.

## Shared cosmetic treatment

- Activity, Chat, and Crews & Channels place the page icon and title above and outside the primary card.
- Wide desktop layouts consume the available Work Hub content width rather than using the current Activity maximum-width cap.
- Search is a single white field with rounded corners and a primary-brand border. Do not retain a gray outer search container or a second black/square input border.
- The Chat and Crews & Channels conversation filter uses a white background.
- Work Hub page, card, and empty-state icons use brand color and contrast without drop shadows.

## Activity attention surface

- Group time-sensitive items.
- Group important non-urgent items.
- Group items with no action for at least 30 days.
- Show the next five scheduled calendar entries.
- Show uploaded receipts, forms, PDFs, and other documents that require review.
- Show recent meetings, calls, transcripts, document uploads, and collaboration activity.
- Deliver new assignments and late-shift notices through the real-time event path.
- Preserve acknowledgement state and an actionable deep link for notices that require acknowledgement.
- Expose the same acknowledgement and navigation actions to Ask V within the caller's authority.

## Test-first acceptance

Regression tests must fail on the current nested heading/search treatment, width cap, and icon-shadow class before implementation. Activity tests must also prove ranking, five-item calendar limiting, review-item visibility, real-time refresh, and acknowledgement behavior.
