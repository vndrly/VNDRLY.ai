# Conversation receipts

The Receipts header icon in Work Hub conversations opens a photo/camera form.
OCR proposes merchant, date, amounts and currency; unreadable values remain blank.
The user must review the image and fields before Save receipt. OCR is a draft,
never approval, reimbursement, tax advice, or an accounting posting.

## Durable source of truth

The existing Supabase-backed `work_hub_file_library` holds schema-versioned
`receipt` records, scoped by organization and channel. `data.fields` stores exact
two-decimal amount strings, merchant, ISO-style date/currency, category,
site/project reference text and notes. The receipt stores original document and
immutable file-version IDs, review actor/time, and optimistic edit version.
`receipt_revision` records preserve prior data for future accounting audit use.
No new schema migration or bucket is required: the existing managed document
storage uploads the photo into the configured private Supabase bucket. Local
filesystem fallback remains the existing development-only storage behavior.

CSV and genuine OOXML `.xlsx` exports are generated from saved records, not used
as storage. Money cells in Excel are numeric; arbitrary text is never interpreted
as an Excel formula. CSV formula prefixes are escaped. Export supports one receipt
or the current conversation (up to 10,000 records, explicit error above that).
The picker shows the latest 200; old conversation receipt links remain accessible.

## Access and behavior

Existing channel/chat read and write permissions apply to every endpoint and
export. A receipt photo must be a finalized managed image from that same
conversation and owner. Creator or channel manager can edit reviewed fields;
the original photo reference is retained. Receipt creation and its chat link
commit together, with operation IDs preventing duplicate receipts/messages on
retry. Updates require the last-read version. No new broad sharing grants exist.

Endpoints live under `/api/work-hub/channels/:channelId/receipts`: list/create,
`/:receiptId` read/update, `/ocr` draft extraction and `/export?format=csv|xlsx`.
Receipt links open `/work-hub/chat?channel=...&receipt=...`.

## OCR and verification

OCR reuses the existing server-only `OPENAI_API_KEY`; optional `RECEIPT_OCR_MODEL`
defaults to the existing image-reading model, `gpt-4o-mini`. Images sent for OCR
are resized in memory; the original uploaded photo is preserved. JPEG, PNG and
WebP are supported. Calls have a deadline and per-user rate limit. The OCR prompt
treats photo text as data, excludes payment-card details, and requires user review.
If OCR is unavailable, manual entry and saving remain possible. Never log photos,
receipt content, or credentials.

Tests use mocked photos/provider responses; database integration runs only on the
fresh isolated test database. Production receipt/message writes are not used as
release smoke tests.
