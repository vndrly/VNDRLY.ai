# GateGo historical gate association correction — 2026-10-28

John confirmed “They'd all be main gate” and then “Okay, do that,” after clarification that each record maps to **its own site's active Main Gate**. This is a user-supplied historical correction, not a GPS observation or inference from current gate inventory.

Only GateGo #1115 sites #399, #400 and #401 are included. The repair script pins the three reviewed station UUIDs and verifies the current site identity, administrator membership, active Main Gate identity, expected record counts and any existing associations before writing.

| Site | Visitor associations added | Employee associations added | Existing associations preserved |
| --- | ---: | ---: | ---: |
| #399 Antelope Draw CTB | 492 | 106 | 0 |
| #400 Coyote Ridge 9 CTB | 476 | 102 | 0 |
| #401 GasGo Stanton Yard | 410 | 67 | 3 |
| Total | 1,378 | 275 | 3 |

The additive migration adds nullable `gate_station_id` and `gate_association_provenance` columns to `site_visits` and `ticket_check_ins`. Station foreign keys use normal restrictive deletion semantics. Historical associations never populate or change GPS evidence. Gate Log reads an explicit association first, then falls back to an existing, same-site gate ID inside visitor entry GPS evidence. Record details distinguish the two sources. The generic employee insert schema strips both server-owned fields.

The repair uses a repeatable-read transaction, current authorization checks, scoped row locks, an operation lock, exact site/record predicates, per-record audit receipts and a verified before-image. It compares hashes of every other field on all 1,656 records before committing. Existing associations remain untouched. The rejected Gate Map/replay implementation is not included.

Applied correction ID: `160703a9-04f9-49de-a7e2-5bacfa29dae5`. The repeat dry run reports zero remaining changes. Shared database changes are applied; code/display changes are local until a separately requested deployment.

Recovery artifacts are outside the repository at `C:/Users/JohnElerick/Documents/Codex/data-repairs/gatego-main-gate-20261028/`: `before-image.json`, SHA-256 checksum and `receipt.json`. The repair runner supports an explicit `--rollback <absolute before-image.json>` mode; **rollback has not been executed**. It validates the checksum, applied audit operation, current site and current association before restoring only its own new fields. It appends a compensating audit receipt and never erases original audit history or drops schema columns.

Commands run from `artifacts/api-server` with the configured environment and TypeScript loader:

```text
node --import tsx ../../scripts/repair-gate-history-associations.mjs
node --import tsx ../../scripts/repair-gate-history-associations.mjs --apply --backup-dir <new absolute backup folder>
```

The default mode is read-only. The supported migration entry point is `pnpm --filter @workspace/api-server run migrate:gate-history-association`; the existing API deployment workflow runs it after the Gate GPS migration. No deployment, push, map change or icon change was performed for this correction.
