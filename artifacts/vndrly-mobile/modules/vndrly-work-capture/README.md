# VNDRLY work capture

Local Expo module; no remote model or new storage provider. VisionKit scans become private JPEG page drafts, and Vision OCR stays attached to its page. FoundationModels returns only a reviewable text draft when the installed SDK, iOS 26+, and SystemLanguageModel availability support it. Unavailable devices keep the existing manual workflow.

## Calling boundary

1. Capture the authenticated JS account scope and call setContext with an opaque nonsecret binding. Token, membership or account changes must call setContext(null). This local fence grants no API authority.
2. scanDocument requires an explicit screen action and the existing human camera permission. Summarization receives only selected work text; neither operation saves a business record or legal consent.
3. Stage a selected app Documents/Caches file (maximum 25 MiB) into the private, backup-excluded module directory. Scan pages are already staged. Explicit discardDraft removes owned idle drafts.
4. Reserve a private object through the existing current-auth API. Validate its returned HTTPS signed upload URL with validateNativeUploadDestination, using the configured canonical API origin. startUpload accepts only that exact /api/storage/upload/UUID endpoint and signed expiry/signature query, refuses redirects and sends no bearer token/cookies.
5. Persist the selected target, exact reservation, file digest and job UUID in the existing JS account-scoped workflow before starting transport. An existing job never resends or changes its file/destination/content type. readUpload supplies its saved transport state after foreground return; background callbacks update the same private receipt.
6. A 204 means bytes transport completed. It does not mean an attachment is saved, a document is authentic, or a server association was accepted. Revalidate the JS scope, finalize through the existing API, verify the actual descriptor, then explicitly associate through the existing reviewed canonical workflow. Unknown finalize/association outcomes retain the existing immutable operation/readback rules.

The OS controls background scheduling. Expired capabilities, interrupted jobs and unavailable local models are genuine failure/unavailable states. No automatic cloud fallback, new URL issuance or silent retry occurs. Account invalidation cancels active old-context tasks; it cannot undo bytes already accepted by the upload capability.

## Validation boundaries

JavaScript policy tests cover destination allowlisting, digest/context receipts and false canonical-save claims. Windows TypeScript checks validate only the JS bridge. The exact release must compile using Xcode/EAS, including SDK-guarded FoundationModels code, and actual iOS checks must exercise camera cancellation, OCR, account invalidation, model unavailable/available, app suspension/relaunch, expiry and canonical finalization. No device or physical-capture proof follows from source tests.
