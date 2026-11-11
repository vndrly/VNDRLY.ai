# Ask V workflow acceptance — November 11, 2026

Ask V uses an OpenAI model with VNDRLY's authenticated tools. It does not inherit
ChatGPT's connected apps, browsing, files, personal conversation history or device
permissions. Model fine-tuning does not implement absent application actions.

## Observed through the actual application API

| Workflow | Observed outcome |
| --- | --- |
| Site listing followed by “Next page please” | Two distinct pages; saved trace used offset 0 then 2, preserving page size. |
| Spoken-name spelling supplied as text | “Open Sand Roman Completions 2 on the Gate Map” opened the correct live map and selected San Roman gate 2. This was a typed test, not microphone acceptance. |
| Gate discovery | Authenticated vendor request executed `query_gate_stations`. |
| Tasks, channels, documents, search, live meetings, settings, inventory | Eight read workflows including gate discovery selected and executed their expected tools without a server error. An empty authorized result is distinct from unavailable functionality. |
| Unassigned synthetic task creation | Initially failed due to confirmation sequencing. After repair, the server prepared exact arguments, a subsequent Confirm created the task, and a fresh read verified it. |
| Synthetic task editing | Read current version, prepared exact update, confirmed, saved version 2 and verified the description. |
| Synthetic task completion | Prepared completion with the supplied resolution, confirmed, saved version 3 and read back completed status. No assignee, due date, or customer work was introduced. |

Local evidence is recorded in `.local/askv-workflow-live-results.json`,
`.local/askv-company-workflow-results.json`, `.local/askv-task-workflow-results.json`
and `.local/askv-task-completion-results.json`. Do not publish their raw records
as public documentation. Release/test evidence is in `.local/release-state.json`.

## Repairs and regression coverage

- The live-model evaluation uses the production OpenAI adapter and actual page
  tool packs. It now includes preparing a task before asking for confirmation.
- Exact pending values survive the next turn in the same user, organization,
  conversation and page context. This does not approve execution or override
  expiry, cancellation, current permission or record-version checks.
- Task completion sends the canonical completion action and supplied resolution.
  A task payload now describes its supported fields instead of accepting an
  undocumented object from the model.
- Task reads expose a continuation cursor, bounded page size, status/assignee
  filters and exact ID lookup. Legacy app callers retain their existing format.
- Next Steps partner-priority completion is saved even when normal ordering is
  chosen. Successful saving returns to the remaining work; failed saving stays
  in the editor. Existing role and company checks remain in force.

## Coverage limits and remaining handoffs

Runtime and database suites cover many additional mutation, permission,
confirmation, conflict and replay paths. They are not a claim that every action
has been exercised with a live model, real customer data and every device.

| Boundary | Meaning |
| --- | --- |
| Microphone and native devices | Actual spoken microphone-to-result acceptance and physical iOS device behavior remain separate checks. Synthetic speech and text cannot prove microphone behavior. |
| Files, photos, scanning, location | Device selection or permission can require a user action. Preparing upload metadata does not mean bytes were uploaded or a photo was captured. |
| External accounts | Provider readiness, an authorized connection and an executable tool are required. No arbitrary ChatGPT connector access is implied. |
| Task lists versus other lists | Task and site pagination are explicit. Each other list must use its own supported cursor; do not imply universal pagination from those two implementations. |
| Full workflow coverage | The matrix distinguishes live-model selection, actual execution and saved readback. Additional workflows need the same standard before being labelled fully accepted. |
| Cloud model evaluation | Local live evaluations work with the existing local credential. Copying that credential to GitHub was rejected by automatic approval review; the cloud evaluation is manual-only until that destination is explicitly authorized. No credential was transferred. |

MidCon's notification hold remains mandatory. Operational writes for acceptance
must use clearly synthetic records or isolated fixtures, not customer assignments.
