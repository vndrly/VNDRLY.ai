# Automatic installed-plugin release

The installed VNDRLY plugin is updated by the release agent through the documented browser file chooser. The user must not be sent a work-computer path or asked to select a ZIP as a normal release step. Do not call a version label alone proof of installation.

Verified on October 8, 2026: the Codex in-app browser successfully uploaded package 1.10.1 without manual file selection, new permissions, reconnecting accounts or creating another plugin. The Edge extension's disabled local-file access was specific to that browser and did not establish a platform requirement for manual uploads. Do not change security settings or use raw browser internals to bypass a denied operation.

1. Validate the package with `node scripts/src/check-chatgpt-plugin-package.mjs`. Preserve plugin `dev-6ac4f61e0aac8191b7f7b4fbbc5822b0` and app `asdk_app_6ac4f61e0aac8191b7f7b4fbbc5822b0`. Build the archive with hidden manifests, app reference, branding, all skills and their resources included.
2. Follow the user's browser selection and read its supported API documentation. Read the current plugin page. Open its actual More actions control and Upload new version. Do not infer visible controls from another browser's page.
3. In a browser that supports the documented chooser, start `tab.playwright.waitForEvent("filechooser")` before clicking Choose file; then call the returned chooser's `setFiles` with the exact validated archive path. This is the supported upload API, not native desktop scripting, injected network requests or a permissions change.
4. Wait for the actual New version uploaded status. Open View plugin and verify the expected version AND all five exact labels: VNDRLY/work hub, VNDRLY/gate, VNDRLY/field ops, VNDRLY/fleet, VNDRLY/inventory. Reject umbrella replacements or modified spacing/capitalization.
5. Verify the existing linked account remains, run an actual permission-scoped read, and save screenshot and timestamped evidence. Reuse the unchanged API's recent harmless synthetic action/readback proof for a package-only guidance correction; do not create duplicate test actions.
6. Public submission/review remains separate. Installed does not mean publicly approved or available. Do not cancel review or create a duplicate catalogue entry to finish a private update.

This process requires an available authenticated browser session on the release host; it requires no manual action from a remotely monitoring user under the verified conditions. If that session expires or a supported upload fails, report the exact boundary without presenting a manual routine as automatic completion.

OpenAI also supports GitHub marketplace sync and migration of an existing workspace plugin by its exact pluginId, preserving workspace policies. This is a distinct admin-managed distribution option, not configured here: the current account's Admin Console reports Access required. Do not create a duplicate entry or claim unattended GitHub sync enabled. Documentation: https://help.openai.com/en/articles/20001504-importing-and-syncing-plugin-marketplaces-from-github .
