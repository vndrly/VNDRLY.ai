# Semantic Service Marketplace Operations

This runbook covers the one-time, rerunnable projection of the existing
`work_types` and `vendor_work_types` catalogues into the semantic marketplace.
The legacy rows remain authoritative during rollout. The backfill only inserts
canonical concepts, mappings, vendor capabilities, and partner-specific offers.

## Safety contract

- Never run `drizzle push`, a database reset, a restore-over-live, `DROP`,
  `TRUNCATE`, or a broad `DELETE` as part of this rollout.
- Never edit or renumber a `work_types`, `vendor_work_types`, or `tickets` row.
- Historical vendor catalogue snapshots are audit evidence only. The backfill
  projects current `vendor_work_types` rows, so a removed selection stays removed.
- The script takes a database advisory lock and writes bounded transactions. A
  failed batch cannot undo a previously committed verified batch; a rerun resumes
  from durable lineage markers.
- The apply guard is intentionally separate from schema migration. Run
  `migrate:semantic-service-marketplace` before this backfill.

## 1. Review the target and thresholds

Confirm the explicit `DATABASE_URL` is the intended environment without printing
credentials. Set these reviewed policy values:

- `SERVICE_MATCHING_ACTIVATION_THRESHOLD`: calibrated confidence required for
  activation. The deterministic legacy pass records exact, unambiguous matches
  at confidence 1; ambiguous aliases remain `review_required`.
- `SEMANTIC_MARKETPLACE_BACKFILL_MAX_CONFLICT_RATE`: maximum allowed fraction of
  legacy work types with ambiguous exact aliases. The apply aborts before writing
  if this threshold is exceeded.
- `SEMANTIC_MARKETPLACE_BACKFILL_BATCH_SIZE`: optional, defaults to 100 and must
  be between 1 and 1000.

## 2. Dry run

Run the API package command with `--dry-run`. The apply guard is not required:

```text
pnpm --filter @workspace/api-server run backfill:semantic-service-marketplace -- --dry-run
```

Archive the JSON result. Review:

- planned mappings, capabilities, and offers (the backfill never creates a
  novel canonical concept; unmatched services require admin review);
- every conflict and its candidate canonical service IDs;
- the conflict rate against the approved threshold;
- unexpected zero-price, missing-unit, or missing partner-target rows (these are
  intentionally not projected as commercial offers).

Resolve incorrect, novel, or conflicting aliases through the marketplace admin
review workflow. A `capability_canonical_mismatch` means an earlier capability
lineage points to a different concept than the work type's current active
mapping; the affected commercial offer is blocked until an administrator
reconciles that lineage. Repeat the dry run until the evaluation is acceptable.
Do not lower a threshold merely to make an unsafe run pass.

## 3. Guarded apply

Only after the dry-run JSON is approved, set
`APPLY_SEMANTIC_SERVICE_MARKETPLACE_BACKFILL=1` and rerun the same package command
without `--dry-run`:

```text
pnpm --filter @workspace/api-server run backfill:semantic-service-marketplace
```

The output is the reconciliation record. Save it with the deployment evidence.
A safe retry uses the same command and thresholds. Durable process and source-row
lineage makes an unchanged rerun a no-op.

## 4. Reconciliation

The script fails if counts of legacy work types, current vendor selections, or
tickets change. Independently verify the output and run read-only checks:

```sql
select count(*) from work_types;
select count(*) from vendor_work_types;
select count(*) from tickets;

select status, count(*)
from service_mappings
where actor_process = 'semantic-service-marketplace-backfill:v1'
group by status order by status;

select count(*) as missing_capability_lineage
from vendor_capabilities
where evidence ? 'semanticMarketplaceBackfill'
  and evidence->'semanticMarketplaceBackfill'->>'sourceVendorWorkTypeId' is null;

select count(*) as missing_offer_lineage
from vendor_partner_service_offers o
join vendor_capabilities c on c.id = o.vendor_capability_id
where c.evidence ? 'semanticMarketplaceBackfill'
  and o.source_vendor_work_type_id is null;

select source_vendor_work_type_id, partner_id, work_type_id, count(*)
from vendor_partner_service_offers
where source_vendor_work_type_id is not null
group by source_vendor_work_type_id, partner_id, work_type_id
having count(*) > 1;
```

All missing-lineage and duplicate queries must return zero rows/counts. Compare
the three legacy counts with the pre-run evidence. Review every
`review_required` mapping, every novel-service result, and every capability
canonical mismatch before enabling marketplace writes. The backfill must never
auto-create or auto-activate a novel canonical service.

## 5. Feature activation and rollback

Enable the semantic marketplace capability flag only after schema verification,
backfill reconciliation, evaluation review, and application deployment are all
green. Activation changes application routing; it does not rewrite legacy data.

Rollback is operational: disable the semantic marketplace capability flag. This
returns users to the legacy catalogue paths while preserving all new rows for
diagnosis and a safe retry. Do not delete projected rows, restore an older
database over the current one, or rebuild the database. If reconciliation fails,
leave the flag disabled, gather read-only counts and lineage samples, fix the
guarded script, and rerun it idempotently.
