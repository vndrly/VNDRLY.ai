# Ask V live tool-use evaluation

Run `pnpm --filter @workspace/api-server run eval:tool-use` with the existing
`OPENAI_API_KEY` configured. The suite uses `requestOpenAIVRound`, the same
OpenAI adapter as Ask V, including its model and reasoning configuration.
It defaults to GPT-6.1 Sol; `ASKV_OPENAI_MODEL` overrides it as in production.
Keys must not be printed or committed.

The suite includes invoice/ticket/onboarding intent checks and page-pack checks
for Gate Map, gate discovery, tasks, channels, documents, search, meetings and
settings. Page-pack checks fail if a necessary tool is missing from the actual
page catalog or if the model answers without selecting that tool.

These tests make real model calls but do not execute domain mutations. Passing
tool selection is not proof that a screen opened or a record was saved. Use
this suite alongside authenticated workflow acceptance, database-backed runtime,
permission, confirmation, conflict and browser tests. Microphone, camera, file
pickers and external-provider delivery require their own acceptance evidence.

`.github/workflows/assistant-tool-use-eval.yml` is currently manual-only. Automated credential transfer was not approved; local
evaluation remains available with the existing local key. The workflow
fails explicitly when the OpenAI secret is missing rather than reporting
skipped tests as success. Outputs are retained as a workflow artifact.
Existing scheduled-failure reporting remains in place.

Add common requests to `src/assistant/__evals__/workflow-selection.eval.ts`
using the actual page and intended tool. Add authenticated execution checks
for new tools; do not substitute invented success results for saved-state proof.
