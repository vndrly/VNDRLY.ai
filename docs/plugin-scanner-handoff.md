# Existing VNDRLY plugin scanner repair

Prepared for publication from home. Do not create another plugin, change grants,
or update the personal installed copy as a substitute for publication.

Existing public publisher:
https://platform.openai.com/plugins/manage/plugin_asdk_app_6ac4fdaf65b881919b596b4b046090e8

## Verified findings and changes

The November 2 rescan explicitly failed because its saved scanner authorization
is missing or no longer works. That is independent of the server definitions.
The displayed findings are from the October 27 review, not a successful new scan.

The source now exposes individually fixed operations for reviewed Work Hub,
Inventory, trip, incident, and assignment action families. Operation substitution
still fails; execution continues through the same canonical permission checks.
Destructive hints conservatively cover removal, revocation, replacement, and
other reviewed changes. Public preparation descriptions no longer claim that a
pending request has already scheduled a worker, updated a record, notified
someone, or collected location. The legacy generic dispatcher remains callable
for existing saved clients but is omitted from new discovery.

File sharing and finance also have nonspecific “further review” findings. They
cannot honestly be declared resolved before a fresh OpenAI review.

## Publish from home

1. Check out the repair branch/commit reported in the handoff. Run the prepared
   API deployment through the established release path. These are server-side
   definitions; uploading a ZIP alone cannot change the live MCP tools.
2. Build the matching package with
   `python scripts/build-chatgpt-publisher.py <absolute-output-zip-path>`.
   The generated ZIP targets the existing `vndrly-ai` publisher identity and
   records the source commit. It leaves the private installed identity intact.
3. In the existing publisher MCP card, reconnect the scanner account with the
   existing permissions and rescan. Inspect fresh results. Do not treat old
   findings disappearing during “Starting scan” as a completed scan.
4. Upload the ZIP as an update to the existing listing. Review the legal
   declarations yourself and submit when the fresh checks are satisfactory.
   Submission, approval, and public availability are separate outcomes.

No publication, legal acceptance, or live credential changes are part of this
prepare-and-commit request.
