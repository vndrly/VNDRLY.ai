import { readFleetPrivateComplianceSource } from "./fleet-compliance-source";
import { loadFleetComplianceTrip, listFleetComplianceTrips } from "./fleet-compliance-trip-context";
import { fleetComplianceRunScopeFingerprint } from "./fleet-compliance-work";
import { createHmac } from "node:crypto";
import { z } from "zod/v4";
import {
  FleetComplianceConfigurationSchema,
  FleetComplianceIndexEntrySchema,
  FleetComplianceRecordSchema,
  FleetComplianceSaveSchema,
  FleetComplianceVerifySchema,
  FleetComplianceReviewerSaveSchema,
  FleetComplianceRegisterQuerySchema,
  FleetComplianceRegisterPageSchema,
  FleetComplianceSubjectSchema,
  FleetComplianceRequirementAdoptSchema,
  FleetComplianceSubjectsQuerySchema,
  FleetComplianceFactsSaveSchema,
  FleetComplianceRequirementsViewSchema,
  FleetComplianceFactsViewSchema,
  FleetComplianceFactRecordSchema,
  FleetRequirementVersionSchema,
  FleetComplianceRecordReceiptSchema,
  FleetComplianceSubjectChoicesQuerySchema,
  FleetComplianceSubjectChoicesPageSchema,
  FleetComplianceDocumentUploadSchema,
  FleetComplianceDocumentAuthorizationSchema,
  FleetComplianceSourceContextSchema,
  evaluateFleetCompliance,
  projectFleetComplianceForDispatch,
  fleetComplianceSubjectKey,
  fleetComplianceSourceSupportsRequirement,
  type FleetRequirementVersion,
  type FleetComplianceRecord,
  type FleetComplianceIndexEntry,
  type FleetComplianceSubject,
} from "@workspace/api-zod";
import type { PoolClient } from "pg";
import type { FleetActor } from "./fleet-ops";
import { FleetError, type FleetState } from "./fleet-repository";
import {
  getObjectStore,
  type ObjectStore,
  type StoredObject,
} from "../lib/objectStore";
import { appendFleetResourceRecord } from "./fleet-resource-store";
import { mergeFleetComplianceScoreHistory, projectFleetComplianceConfigurationScore } from "./fleet-compliance-score";
type Transaction = <T>(
  actor: FleetActor,
  work: (state: FleetState, client: PoolClient) => Promise<T>,
) => Promise<T>;
type Access = (
  state: FleetState,
  actor: FleetActor,
) => { fleetIds: readonly string[]; officeFleetIds?: readonly string[]; officeSiteIds?: readonly number[]; roles: readonly string[] } | null;
type Configuration = z.infer<typeof FleetComplianceConfigurationSchema>;
const uploadSchema = FleetComplianceDocumentUploadSchema;
const receiptSchema = z
  .object({
    actorUserId: z.number().int().positive(),
    fingerprint: z.string(),
    result: z.unknown(),
  })
  .strict();
const owner = (companyId: number) => `fleet-compliance:${companyId}`;
const keyPrefix = (companyId: number) =>
  `/objects/fleet-compliance-private/${companyId}/`;

/** Private objects contain the actual source/medical/license/policy data. The
 * ordinary vendor/audit records contain only typed opaque revision pointers.
 * The enclosing repository rechecks current membership/session before retries. */
export function createFleetComplianceOperations(
  transaction: Transaction,
  access: Access,
  options: {
    store?: () => ObjectStore;
    secret?: () => string;
    now?: () => Date;
  } = {},
) {
  const store = options.store ?? getObjectStore,
    now = () => (options.now?.() ?? new Date()).toISOString();
  const digest = (value: unknown) => {
    const secret = options.secret?.() ?? process.env.SESSION_SECRET;
    if (!secret) throw new FleetError("fleet.private_storage_unavailable", 503);
    return createHmac("sha256", secret)
      .update(JSON.stringify(value))
      .digest("hex");
  };
  const readConfig = async (client: PoolClient, actor: FleetActor) => {
    const result = await client.query(
      "SELECT fleet_compliance_configuration FROM vendors WHERE id=$1 FOR UPDATE",
      [actor.companyId],
    );
    if (!result.rows.length) throw new FleetError("fleet.not_found", 404);
    return FleetComplianceConfigurationSchema.parse(
      result.rows[0].fleet_compliance_configuration ?? {
        version: 1,
        reviewerUserIds: [],
        entries: [],
      },
    );
  };
  const writeConfig = async (
    client: PoolClient,
    actor: FleetActor,
    config: Configuration,
    preservePartnerPreview = false,
  ) => {
    const next = preservePartnerPreview
      ? config
      : { ...config, partnerScorePreview: null };
    await client.query(
      "UPDATE vendors SET fleet_compliance_configuration=$2::jsonb WHERE id=$1",
      [
        actor.companyId,
        JSON.stringify(FleetComplianceConfigurationSchema.parse(next)),
      ],
    );
  };
  const isReviewer = (config: Configuration, actor: FleetActor) =>
    config.reviewerUserIds.includes(actor.userId);
  const managementFleetIds = (grant: ReturnType<Access>) =>
    grant?.roles.some(role => ["fleet_manager", "dispatcher"].includes(role))
      ? grant.fleetIds : grant?.officeFleetIds ?? [];
  const managesDriver = (grant: ReturnType<Access>, row: FleetState["grants"][number]) =>
    row.fleetIds.some(id => managementFleetIds(grant).includes(id)) &&
    (grant?.roles.some(role => ["fleet_manager", "dispatcher"].includes(role)) ||
      row.siteIds.some(id => grant?.officeSiteIds?.includes(id)));
  function writable(actor: FleetActor) {
    if (actor.readOnly) throw new FleetError("fleet.read_only", 403);
  }
  function requireReviewer(config: Configuration, actor: FleetActor) {
    if (!isReviewer(config, actor))
      throw new FleetError("fleet.compliance_reviewer_required", 403);
  }
  async function canUseSubject(
    state: FleetState,
    client: PoolClient,
    actor: FleetActor,
    config: Configuration,
    subject: FleetComplianceSubject,
    write = false,
    retainedRead = false,
  ) {
    if (
      retainedRead &&
      !write &&
      isReviewer(config, actor) &&
      config.entries.some(
        (row) =>
          fleetComplianceSubjectKey(row.subject) ===
          fleetComplianceSubjectKey(subject),
      )
    )
      return;
    if (!state.enabled) throw new FleetError("fleet.unavailable", 403);
    if (write) writable(actor);
    const grant = access(state, actor),
      admin = actor.role === "vendor" && actor.membershipRole === "admin",
      reviewer = isReviewer(config, actor),
      manager =
        admin ||
        (!write && !!grant?.officeFleetIds?.length) ||
        !!grant?.roles.some((role) =>
          ["fleet_manager", "dispatcher"].includes(role),
        );
    if (
      !manager &&
      !reviewer &&
      !(
        subject.kind === "driver" &&
        subject.id === actor.userId &&
        grant?.roles.includes("driver")
      ) &&
      !(
        !write&&subject.kind==="carrier"&&subject.id===actor.companyId&&grant?.roles.includes("driver")
      )
    )
      throw new FleetError("fleet.compliance_subject_required", 403);
    if (subject.kind === "carrier") {
      if (subject.id !== actor.companyId)
        throw new FleetError("fleet.not_found", 404);
    } else if (subject.kind === "driver") {
      const members = await client.query(
        "SELECT m.id FROM user_org_memberships m JOIN users u ON u.id=m.user_id WHERE m.vendor_id=$1 AND m.org_type='vendor' AND m.user_id=$2 AND u.suspended_at IS NULL",
        [actor.companyId, subject.id],
      );
      if (
        !members.rows.length ||
        (!admin &&
          !reviewer &&
          subject.id !== actor.userId &&
          !state.grants.some(
            (row) =>
              row.userId === subject.id &&
              row.roles.includes("driver") &&
              managesDriver(grant, row),
          ))
      )
        throw new FleetError("fleet.not_found", 404);
    } else if (subject.kind === "vehicle" || subject.kind === "component") {
      const assets = await client.query(
        "SELECT id FROM assets WHERE id=$1 AND responsible_org_type='vendor' AND responsible_org_id=$2",
        [subject.id, actor.companyId],
      );
      if (
        !assets.rows.length ||
        (!admin &&
          !reviewer &&
          !state.fleets.some(
            (group) =>
              managementFleetIds(grant).includes(group.id) &&
              group.equipmentAssetIds.includes(subject.id),
          ))
      )
        throw new FleetError("fleet.not_found", 404);
    } else {
      const run = await loadFleetComplianceTrip(state, client, actor.companyId, subject.id);
      if (!run || !(managementFleetIds(grant).includes(run.fleetId) && (grant?.roles.some(role => ["fleet_manager", "dispatcher"].includes(role)) || run.siteIds.every(id => grant?.officeSiteIds?.includes(id))) || run.driverUserId === actor.userId && grant?.roles.includes("driver") && grant.fleetIds.includes(run.fleetId)))
        throw new FleetError("fleet.not_found", 404);
    }
  }
  async function receipt(
    client: PoolClient,
    actor: FleetActor,
    id: string,
    input: unknown,
  ) {
    const rows = await client.query(
      "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-compliance-operation' AND target_id=$2 ORDER BY id DESC LIMIT 1",
      [actor.companyId, id],
    );
    if (!rows.rows.length) return null;
    const saved = receiptSchema.parse(rows.rows[0].tool_output);
    if (
      saved.actorUserId !== actor.userId ||
      saved.fingerprint !== digest(input)
    )
      throw new FleetError("fleet.operation_conflict");
    return saved.result;
  }
  async function saveReceipt(
    client: PoolClient,
    actor: FleetActor,
    id: string,
    input: unknown,
    result: unknown,
  ) {
    await appendFleetResourceRecord(
      client,
      actor,
      "fleet-compliance-operation",
      id,
      { actorUserId: actor.userId, fingerprint: digest(input), result },
    );
  }
  const privateRecord=(entry:FleetComplianceIndexEntry,actor:FleetActor)=>readFleetPrivateComplianceSource(entry,actor.companyId,store,digest);
  async function persistRecord(
    client: PoolClient,
    actor: FleetActor,
    config: Configuration,
    record: FleetComplianceRecord,
  ) {
    const path = `${keyPrefix(actor.companyId)}${record.evidence.id}/${record.evidence.revision}/${digest(record)}`;
    await store().putObject(
      path,
      "application/json",
      Buffer.from(JSON.stringify(record)),
      {
        owner: owner(actor.companyId),
        visibility: "private",
        purpose: "fleet-compliance-private",
      },
    );
    const e = record.evidence,
      entry = FleetComplianceIndexEntrySchema.parse({
        id: e.id,
        revision: e.revision,
        subject: e.subject,
        requirementId: e.requirementId,
        requirementVersion: e.requirementVersion,
        status: e.status,
        validFrom: e.validFrom,
        validUntil: e.validUntil,
        verifiedAt: e.verifiedAt,
        verifiedByUserId: e.verifiedByUserId,
        attributeKind: record.attributes.kind,
        objectPath: path,
        updatedAt: now(),
      });
    config.entries = config.entries.filter((row) => row.id !== entry.id);
    config.entries.push(entry);
    if (entry.subject.kind === "vehicle" || entry.subject.kind === "component")
      await client.query(
        "UPDATE assets SET fleet_compliance_record_ids=COALESCE(fleet_compliance_record_ids,'[]'::jsonb)||jsonb_build_array($2::text) WHERE id=$1 AND responsible_org_type='vendor' AND responsible_org_id=$3 AND NOT (COALESCE(fleet_compliance_record_ids,'[]'::jsonb) ? $2::text)",
        [entry.subject.id, entry.id, actor.companyId],
      );
    if (entry.subject.kind === "driver")
      await client.query(
        "UPDATE vendor_people SET fleet_compliance_record_ids=COALESCE(fleet_compliance_record_ids,'[]'::jsonb)||jsonb_build_array($3::text) WHERE user_id=$1 AND vendor_id=$2 AND deleted_at IS NULL AND NOT (COALESCE(fleet_compliance_record_ids,'[]'::jsonb) ? $3::text)",
        [entry.subject.id, actor.companyId, entry.id],
      );
    config.version++;
    await writeConfig(client, actor, config);
    await appendFleetResourceRecord(
      client,
      actor,
      "fleet-compliance-revision",
      entry.id,
      entry,
    );
    return {
      id: entry.id,
      revision: entry.revision,
      subject: entry.subject,
      status: entry.status,
      updatedAt: entry.updatedAt,
    };
  }
  const locate = async (
    client: PoolClient,
    actor: FleetActor,
    config: Configuration,
    id: string,
    revision?: number,
  ) => {
    let entry = config.entries.find(
      (row) =>
        row.id === id && (revision === undefined || row.revision === revision),
    );
    if (!entry && revision !== undefined) {
      const rows = await client.query(
        "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-compliance-revision' AND target_id=$2 AND tool_output->>'revision'=$3 ORDER BY id DESC LIMIT 1",
        [actor.companyId, id, String(revision)],
      );
      if (rows.rows.length)
        entry = FleetComplianceIndexEntrySchema.parse(rows.rows[0].tool_output);
    }
    if (!entry) throw new FleetError("fleet.not_found", 404);
    return entry;
  };
  // A verified insurance document is not a work-specific coverage decision.
  // The coverage evaluator additionally needs the complete planned work scope,
  // required limit and filing source. A generic register cannot infer those.
  function matchesRequirement(record:FleetComplianceRecord,requirements:FleetRequirementVersion[]){
    const rule=requirements.find(row=>row.id===record.evidence.requirementId&&row.version===record.evidence.requirementVersion);
    return !rule||(rule.subjectKinds.includes(record.evidence.subject.kind)&&fleetComplianceSourceSupportsRequirement(record.attributes.kind,rule.category));
  }
  const operationalEvidence = (record: FleetComplianceRecord,requirements:FleetRequirementVersion[]) =>
    (record.attributes.kind === "insurance" || !matchesRequirement(record,requirements)) && record.evidence.status === "verified"
      ? { ...record.evidence, status: "reviewed" as const }
      : record.evidence;
  return {
    assertFleetComplianceScoreAccess: (actor: FleetActor) => transaction(actor, async (state) => {
      const grant = access(state, actor);
      if (actor.role === "vendor" && actor.membershipRole === "admin") return;
      if (!managementFleetIds(grant).length) throw new FleetError("fleet.finance_required", 403);
    }),
    readFleetComplianceScoreProjection: (actor: FleetActor) => transaction(actor, async (state, client) => {
      const grant = access(state, actor);
      if (!(actor.role === "vendor" && actor.membershipRole === "admin") && !managementFleetIds(grant).length)
        throw new FleetError("fleet.finance_required", 403);
      const config = await readConfig(client, actor);
      const projected = projectFleetComplianceConfigurationScore(actor.companyId, config, now());
      const scoreHistory = mergeFleetComplianceScoreHistory(config.scoreHistory, projected.evaluatedAt, projected.score);
      await writeConfig(client, actor, { ...config, scoreHistory, partnerScorePreview: projected.partnerPreview ?? null }, true);
      return { ...projected, history: scoreHistory };
    }),
    recordFleetComplianceScoreSnapshot: (actor: FleetActor, preview: { score: number; status: "red" | "amber" | "green"; advisoryOnly: true; evaluatedAt: string; categories: Array<{ category: "vehicle" | "driver_license" | "insurance" | "company_records"; score: number }>; reasons: Array<{ category: "vehicle" | "driver_license" | "insurance" | "company_records"; reason: string; reasonCode: "missing_evidence" | "expired_record" | "revoked_record" | "failed_record" | "unverified_record" | "excluded_record" | "requires_review" }> }) => transaction(actor, async (state, client) => {
      const grant = access(state, actor);
      if (!(actor.role === "vendor" && actor.membershipRole === "admin") && !managementFleetIds(grant).length)
        throw new FleetError("fleet.finance_required", 403);
      const config = await readConfig(client, actor);
      const scoreHistory = mergeFleetComplianceScoreHistory(config.scoreHistory, preview.evaluatedAt, preview.score);
      await writeConfig(client, actor, { ...config, scoreHistory, partnerScorePreview: preview }, true);
      return scoreHistory;
    }),
    readFleetComplianceSubjects: (actor: FleetActor, input: unknown) => {
      const query=FleetComplianceSubjectChoicesQuerySchema.parse(input);
      return transaction(actor,async(state,client)=>{
        if(!state.enabled)throw new FleetError("fleet.unavailable",403);
        const config=await readConfig(client,actor),grant=access(state,actor),admin=actor.role==="vendor"&&actor.membershipRole==="admin",reviewer=isReviewer(config,actor);
        const manager=admin||reviewer||!!grant&&(!!grant.officeFleetIds?.length||grant.roles.some(role=>["fleet_manager","dispatcher"].includes(role)));
        let rows:Array<{subject:FleetComplianceSubject;label:string}>=[];
        if(query.kind==="carrier"){
          await canUseSubject(state,client,actor,config,{kind:"carrier",id:actor.companyId});
          const company=await client.query("SELECT name FROM vendors WHERE id=$1 AND name ILIKE $2",[actor.companyId,`%${query.search}%`]);
          if(company.rows.length)rows=[{subject:{kind:"carrier",id:actor.companyId},label:company.rows[0].name}];
        } else if(query.kind==="driver"){
          const ids=state.grants.filter(row=>row.roles.includes("driver")&&(admin||reviewer||(manager&&managesDriver(grant,row))||row.userId===actor.userId)).map(row=>row.userId);
          const people=await client.query("SELECT DISTINCT u.id,COALESCE(NULLIF(u.display_name,''),u.username) AS label FROM user_org_memberships m JOIN users u ON u.id=m.user_id WHERE m.vendor_id=$1 AND m.org_type='vendor' AND u.suspended_at IS NULL AND ($2::integer[] IS NULL OR u.id=ANY($2::integer[])) AND u.id>$3 AND COALESCE(NULLIF(u.display_name,''),u.username) ILIKE $4 ORDER BY u.id LIMIT $5",[actor.companyId,ids,Number(query.after??0),`%${query.search}%`,query.limit+1]);
          rows=people.rows.map(row=>({subject:{kind:"driver",id:row.id},label:row.label}));
        } else if(query.kind==="vehicle"||query.kind==="component"){
          const ids=manager?[...new Set(state.fleets.filter(group=>admin||reviewer||managementFleetIds(grant).includes(group.id)).flatMap(group=>group.equipmentAssetIds))]:[];
          const assets=await client.query("SELECT id,name FROM assets WHERE responsible_org_type='vendor' AND responsible_org_id=$1 AND id=ANY($2::uuid[]) AND retired_at IS NULL AND merged_into_id IS NULL AND ($3::uuid IS NULL OR id>$3::uuid) AND name ILIKE $4 AND ((category=ANY($5::text[]))=$6::boolean) ORDER BY id LIMIT $7",[actor.companyId,ids,query.after??null,`%${query.search}%`,["truck","vehicle","service_vehicle","support_vehicle"],query.kind==="vehicle",query.limit+1]);
          rows=assets.rows.map(row=>({subject:{kind:query.kind as "vehicle"|"component",id:row.id},label:row.name}));
        } else {
          rows=manager?await listFleetComplianceTrips(state,client,actor.companyId,managementFleetIds(grant),query):[];
        }
        const entries=[];
        for(const row of rows.slice(0,query.limit)){
          await canUseSubject(state,client,actor,config,row.subject);
          let canSubmit=false;
          if(!actor.readOnly){try{await canUseSubject(state,client,actor,config,row.subject,true);canSubmit=true;}catch(error){if(!(error instanceof FleetError)||![403,404].includes(error.status))throw error;}}
          entries.push({...row,canSubmit});
        }
        return FleetComplianceSubjectChoicesPageSchema.parse({entries,nextCursor:rows.length>query.limit?String(entries.at(-1)!.subject.id):null});
      });
    },
    readFleetComplianceRequirements:(actor:FleetActor)=>transaction(actor,async(state,client)=>{
      const config=await readConfig(client,actor),reviewer=isReviewer(config,actor);
      if(!reviewer&&(!state.enabled||!access(state,actor)&&!(actor.role==="vendor"&&actor.membershipRole==="admin")))throw new FleetError("fleet.dispatch_required",403);
      return FleetComplianceRequirementsViewSchema.parse({requirements:config.requirements,canAdopt:state.enabled&&reviewer&&!actor.readOnly,mode:"warn_only"});
    }),
    readFleetComplianceFacts:(actor:FleetActor,raw:unknown,version?:number)=>{
      const subject=FleetComplianceSubjectSchema.parse(raw);
      if(version!==undefined)z.number().int().positive().parse(version);
      return transaction(actor,async(state,client)=>{
        const config=await readConfig(client,actor),key=fleetComplianceSubjectKey(subject);
        let fact=config.facts.find(row=>fleetComplianceSubjectKey(row.subject)===key);
        if(!(fact&&isReviewer(config,actor)))await canUseSubject(state,client,actor,config,subject);
        if(version!==undefined&&fact?.version!==version){
          const raw=(await client.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-compliance-facts' AND target_id=$2 AND tool_output->>'version'=$3 ORDER BY id DESC LIMIT 1",[actor.companyId,key,String(version)])).rows[0]?.tool_output;
          if(!raw)throw new FleetError("fleet.not_found",404);
          fact=FleetComplianceFactRecordSchema.parse(raw);
          if(fact.version!==version||fleetComplianceSubjectKey(fact.subject)!==key)throw new FleetError("fleet.not_found",404);
        }
        return fact?FleetComplianceFactsViewSchema.parse({subject:fact.subject,version:fact.version,facts:fact.facts,reviewedAt:fact.reviewedAt,reviewedByUserId:fact.reviewedByUserId,sourceKind:fact.sourceKind}):null;
      });
    },
    recordFleetComplianceFacts: (actor: FleetActor, input: unknown) => {
      const value = FleetComplianceFactsSaveSchema.parse(input);
      return transaction(actor, async (state, client) => {
        writable(actor);
        const config = await readConfig(client, actor);
        requireReviewer(config, actor);
        await canUseSubject(state, client, actor, config, value.subject);
        const prior = await receipt(client, actor, value.operationId, value);
        if (prior) return prior as { version: number };
        const key = fleetComplianceSubjectKey(value.subject),
          previous = config.facts.find(
            (row) => fleetComplianceSubjectKey(row.subject) === key,
          );
        if ((previous?.version ?? 0) !== value.expectedVersion)
          throw new FleetError("fleet.version_conflict");
        const version = value.expectedVersion + 1,
          path = `${keyPrefix(actor.companyId)}facts/${key.replace(":", "-")}/${version}/${digest(value)}`;
        await store().putObject(
          path,
          "application/json",
          Buffer.from(JSON.stringify({ source: value.source })),
          {
            owner: owner(actor.companyId),
            visibility: "private",
            purpose: "fleet-compliance-private",
          },
        );
        const fact = {
          subject: value.subject,
          version,
          facts: value.facts,
          reviewedAt: now(),
          reviewedByUserId: actor.userId,
          sourceKind: value.source.kind,
          sourceObjectPath: path,
          ...(value.subject.kind==="trip"?{workScopeFingerprint:fleetComplianceRunScopeFingerprint(state.runs.find(run=>run.id===value.subject.id)!)}:{}),
        };
        config.facts = config.facts.filter(
          (row) => fleetComplianceSubjectKey(row.subject) !== key,
        );
        config.facts.push(fact);
        config.version++;
        await writeConfig(client, actor, config);
        await appendFleetResourceRecord(
          client,
          actor,
          "fleet-compliance-facts",
          key,
          fact,
        );
        const result = { version };
        await saveReceipt(client, actor, value.operationId, value, result);
        return result;
      });
    },
    adoptFleetRequirement: (actor: FleetActor, input: unknown) => {
      const value = FleetComplianceRequirementAdoptSchema.parse(input);
      return transaction(actor, async (state, client) => {
        writable(actor);
        const config = await readConfig(client, actor);
        requireReviewer(config, actor);
        if (!state.enabled) throw new FleetError("fleet.unavailable", 403);
        const prior = await receipt(client, actor, value.operationId, value);
        if (prior) return FleetRequirementVersionSchema.parse(prior);
        const previous = Math.max(
          0,
          ...config.requirements
            .filter((row) => row.id === value.requirement.id)
            .map((row) => row.version),
        );
        if (
          previous !== value.expectedVersion ||
          value.requirement.version !== previous + 1
        )
          throw new FleetError("fleet.version_conflict");
        const requirement = FleetRequirementVersionSchema.parse({
          ...value.requirement,
          source: {
            ...value.requirement.source,
            reviewedAt: now(),
            reviewedByUserId: actor.userId,
          },
        });
        config.requirements.push(requirement);
        config.version++;
        await writeConfig(client, actor, config);
        await appendFleetResourceRecord(
          client,
          actor,
          "fleet-compliance-requirement",
          requirement.id,
          requirement,
        );
        await saveReceipt(client, actor, value.operationId, value, requirement);
        return requirement;
      });
    },
    assessFleetComplianceSubjects: (actor: FleetActor, input: unknown) => {
      const value = FleetComplianceSubjectsQuerySchema.parse(input);
      return transaction(actor, async (state, client) => {
        const config = await readConfig(client, actor);
        for (const subject of value.subjects)
          await canUseSubject(state, client, actor, config, subject);
        const evidence = [];
        for (const entry of config.entries.filter((entry) =>
          value.subjects.some(
            (subject) =>
              fleetComplianceSubjectKey(subject) ===
              fleetComplianceSubjectKey(entry.subject),
          ),
        )) {
          try {
            evidence.push(
              operationalEvidence(await privateRecord(entry, actor),config.requirements),
            );
          } catch {
            /* Missing private storage remains missing/red, never blocks capture. */
          }
        }
        const assessments = evaluateFleetCompliance({
          facts: { carrierId: actor.companyId },
          members: value.subjects.map((subject) => ({
            subject,
            facts:
              config.facts.find(
                (row) =>
                  fleetComplianceSubjectKey(row.subject) ===
                  fleetComplianceSubjectKey(subject),
              )?.facts ?? {},
          })),
          requirements: config.requirements,
          evidence,
          at: now(),
          freshness: "current",
        });
        return {
          assessments,
          summaries: assessments.map(projectFleetComplianceForDispatch),
          mode: "warn_only" as const,
        };
      });
    },
    complianceConfiguration: (actor: FleetActor) =>
      transaction(actor, async (state, client) => {
        if (!state.enabled) throw new FleetError("fleet.unavailable", 403);
        const config = await readConfig(client, actor);
        if (
          !access(state, actor) &&
          !(actor.role === "vendor" && actor.membershipRole === "admin") &&
          !isReviewer(config, actor)
        )
          throw new FleetError("fleet.dispatch_required", 403);
        return {
          version: config.version,
          isReviewer: isReviewer(config, actor),
          mayAppointReviewers:
            actor.role === "vendor" &&
            actor.membershipRole === "admin" &&
            !actor.readOnly,
          reviewerUserIds:
            actor.membershipRole === "admin" ? config.reviewerUserIds : [],
        };
      }),
    saveComplianceReviewers: (actor: FleetActor, input: unknown) => {
      const value = FleetComplianceReviewerSaveSchema.parse(input);
      return transaction(actor, async (state, client) => {
        writable(actor);
        if (
          !state.enabled ||
          actor.role !== "vendor" ||
          actor.membershipRole !== "admin"
        )
          throw new FleetError("fleet.company_admin_required", 403);
        const config = await readConfig(client, actor),
          prior = await receipt(client, actor, value.operationId, value);
        if (prior)
          return prior as { version: number; reviewerUserIds: number[] };
        if (config.version !== value.expectedVersion)
          throw new FleetError("fleet.version_conflict");
        const ids = [...new Set(value.reviewerUserIds)];
        if (ids.length) {
          const result = await client.query(
            "SELECT DISTINCT m.user_id FROM user_org_memberships m JOIN users u ON u.id=m.user_id WHERE m.vendor_id=$1 AND m.org_type='vendor' AND m.user_id=ANY($2::int[]) AND u.suspended_at IS NULL",
            [actor.companyId, ids],
          );
          if (result.rows.length !== ids.length)
            throw new FleetError("fleet.current_member_required", 403);
        }
        config.reviewerUserIds = ids;
        config.version++;
        await writeConfig(client, actor, config);
        const result = { version: config.version, reviewerUserIds: ids };
        await saveReceipt(client, actor, value.operationId, value, result);
        return result;
      });
    },
    saveFleetComplianceEvidence: (actor: FleetActor, input: unknown) => {
      const value = FleetComplianceSaveSchema.parse(input);
      return transaction(actor, async (state, client) => {
        const config = await readConfig(client, actor);
        await canUseSubject(
          state,
          client,
          actor,
          config,
          value.record.evidence.subject,
          true,
        );
        const prior = await receipt(client, actor, value.operationId, value);
        if (prior) return prior as { id: string; revision: number };
        if(!matchesRequirement(value.record,config.requirements))throw new FleetError("fleet.evidence_requirement_mismatch");
        const previous = config.entries.find(
          (row) => row.id === value.record.evidence.id,
        );
        if ((previous?.revision ?? 0) !== value.expectedVersion)
          throw new FleetError("fleet.version_conflict");
        let record=value.record;
        if (previous) {
          const old = await privateRecord(previous, actor);
          const mapping=value.mapUnmappedRequirement&&old.evidence.requirementId===`unmapped:${old.attributes.kind}`&&config.requirements.some(row=>row.id===value.record.evidence.requirementId&&row.version===value.record.evidence.requirementVersion&&row.subjectKinds.includes(value.record.evidence.subject.kind)&&fleetComplianceSourceSupportsRequirement(value.record.attributes.kind,row.category));
          if (
            fleetComplianceSubjectKey(old.evidence.subject) !==
              fleetComplianceSubjectKey(value.record.evidence.subject) ||
            (old.evidence.requirementId !==
              value.record.evidence.requirementId && !mapping) ||
            old.attributes.kind !== value.record.attributes.kind
          )
            throw new FleetError("fleet.evidence_identity_conflict");
          if(value.preserveExistingRetention)record=FleetComplianceRecordSchema.parse({...record,retentionClass:old.retentionClass,legalHold:old.legalHold||record.legalHold,retainUntil:old.retainUntil&&(!record.retainUntil||Date.parse(old.retainUntil)>Date.parse(record.retainUntil))?old.retainUntil:record.retainUntil});
          if(value.reusePriorDocument){
            const privateDocumentRef=old.evidence.privateDocumentRef;if(!privateDocumentRef)throw new FleetError("fleet.private_document_unavailable");
            record=FleetComplianceRecordSchema.parse({...record,evidence:{...record.evidence,privateDocumentRef},attributes:record.attributes.kind==="insurance"?{...record.attributes,coverage:{...record.attributes.coverage,privateDocumentRef}}:record.attributes});
          }
          if (
            (old.legalHold && !record.legalHold) ||
            (old.retainUntil &&
              (!record.retainUntil ||
                Date.parse(record.retainUntil) <
                  Date.parse(old.retainUntil)))
          )
            throw new FleetError("fleet.retention_cannot_shorten");
        }
        const path = record.evidence.privateDocumentRef;
        if (path) {
          const acl = await store().getObjectAcl(path);
          const grant = await client.query(
            "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-compliance-document' AND target_id=$2 AND tool_output->>'objectPath'=$3 ORDER BY id DESC LIMIT 1",
            [actor.companyId, value.record.evidence.id, path],
          );
          if (
            !grant.rows.length ||
            fleetComplianceSubjectKey(
              FleetComplianceSubjectSchema.parse(
                grant.rows[0].tool_output.subject,
              ),
            ) !== fleetComplianceSubjectKey(value.record.evidence.subject) ||
            !path.startsWith(
              `${keyPrefix(actor.companyId)}${value.record.evidence.id}/documents/`,
            ) ||
            acl?.purpose !== "fleet-compliance-private" ||
            acl.visibility !== "private" ||
            acl.owner !== owner(actor.companyId)
          )
            throw new FleetError("fleet.private_document_required", 403);
        }
        const result = await persistRecord(client, actor, config, record);
        await saveReceipt(client, actor, value.operationId, value, result);
        return result;
      });
    },
    verifyFleetComplianceEvidence: (actor: FleetActor, input: unknown) => {
      const value = FleetComplianceVerifySchema.parse(input);
      return transaction(actor, async (state, client) => {
        writable(actor);
        const config = await readConfig(client, actor);
        requireReviewer(config, actor);
        const entry = await locate(client, actor, config, value.evidenceId);
        await canUseSubject(state, client, actor, config, entry.subject);
        const prior = await receipt(client, actor, value.operationId, value);
        if (prior) return prior as { id: string; revision: number };
        if (entry.revision !== value.expectedVersion)
          throw new FleetError("fleet.version_conflict");
        if (Date.parse(value.reviewedAt) > Date.parse(now()))
          throw new FleetError("fleet.future_review", 400);
        const old = await privateRecord(entry, actor),
          attr = old.attributes;
        if(value.decision==="verified"&&!matchesRequirement(old,config.requirements))throw new FleetError("fleet.evidence_requirement_mismatch");
        if (
          value.decision === "verified" &&
          ((attr.kind === "driver_license" &&
            (attr.licenseStatus !== "active" || attr.licenseNumber === null || attr.issuingState === null || attr.licenseClass === null)) ||
            (attr.kind === "driver_medical" &&
              attr.qualification !== "qualified") ||
            (attr.kind === "driver_testing" && (attr.result !== "eligible" || attr.program === null)) ||
            (attr.kind === "credential" && attr.issuingAuthority === null) ||
            (attr.kind === "driver_qualification" &&
              attr.result !== "satisfactory") ||
            (attr.kind === "duty" &&
              (!["ELD", "reviewed_paper_log"].includes(attr.source) ||
                attr.dutyStatus !== "available")))
        )
          throw new FleetError("fleet.credential_not_eligible");
        if (
          value.decision === "verified" &&
          ["revoked", "failed"].includes(old.evidence.status)
        )
          throw new FleetError("fleet.new_evidence_required");
        const reviewedAt = now(),
          revision = old.evidence.revision + 1,
          record = {
            ...old,
            review: {
              source: value.source,
              reviewedAt,
              reportedReviewedAt: value.reviewedAt,
              reviewerUserId: actor.userId,
              filingSource: value.coverageReview?.filingSource ?? null,
            },
            evidence: {
              ...old.evidence,
              revision,
              status: value.decision,
              verifiedAt: reviewedAt,
              verifiedByUserId: actor.userId,
              source: value.source.kind,
            },
          };
        if (attr.kind === "insurance") {
          const review = value.coverageReview;
          if (
            review &&
            ["accepted", "not_required", "cancelled"].includes(
              review.filingStatus,
            ) &&
            !review.filingSource
          )
            throw new FleetError("fleet.filing_source_required", 400);
          record.attributes = {
            ...attr,
            coverage: {
              ...attr.coverage,
              revision,
              state: value.decision,
              reviewedAt,
              reviewedByUserId: actor.userId,
              scopesReviewed: review?.scopesReviewed ?? false,
              followFormReviewed: review?.followFormReviewed ?? false,
              filingStatus: review?.filingStatus ?? attr.coverage.filingStatus,
              filingVerifiedAt: review?.filingSource ? reviewedAt : null,
            },
          };
        }
        const parsed = FleetComplianceRecordSchema.parse(record),
          result = await persistRecord(client, actor, config, parsed);
        await saveReceipt(client, actor, value.operationId, value, result);
        return result;
      });
    },
    readFleetComplianceSourceContext:(actor:FleetActor,id:string,revision:number)=>transaction(actor,async(state,client)=>{
      z.uuid().parse(id);z.number().int().positive().parse(revision);const config=await readConfig(client,actor),entry=await locate(client,actor,config,id);
      await canUseSubject(state,client,actor,config,entry.subject,false,true);if(entry.revision!==revision)throw new FleetError("fleet.version_conflict");
      let canSubmit=false;if(!actor.readOnly){try{await canUseSubject(state,client,actor,config,entry.subject,true);canSubmit=true;}catch(error){if(!(error instanceof FleetError)||![403,404].includes(error.status))throw error;}}
      let label="";const subject=entry.subject;
      if(subject.kind==="driver")label=(await client.query("SELECT COALESCE(NULLIF(u.display_name,''),u.username) AS label FROM users u JOIN user_org_memberships m ON m.user_id=u.id WHERE u.id=$1 AND m.org_type='vendor' AND m.vendor_id=$2 LIMIT 1",[subject.id,actor.companyId])).rows[0]?.label??`Recorded driver · ${subject.id}`;
      else if(subject.kind==="carrier")label=(await client.query("SELECT name AS label FROM vendors WHERE id=$1",[actor.companyId])).rows[0]?.label??"Recorded carrier";
      else if(subject.kind==="trip")label=state.runs.find(row=>row.id===subject.id)?.title??`Recorded activity · ${subject.id.slice(-6)}`;
      else label=(await client.query("SELECT name AS label FROM assets WHERE id=$1 AND responsible_org_type='vendor' AND responsible_org_id=$2",[subject.id,actor.companyId])).rows[0]?.label??`Recorded asset · ${subject.id.slice(-6)}`;
      const source=await privateRecord(entry,actor);
      return FleetComplianceSourceContextSchema.parse({id:entry.id,revision:entry.revision,subject,attributeKind:entry.attributeKind,requirementId:entry.requirementId,requirementVersion:entry.requirementVersion,label,hasDocument:source.evidence.privateDocumentRef!==null,canSubmit,coverageType:source.attributes.kind==="insurance"?source.attributes.coverage.coverageType:null});
    }),
    readFleetComplianceReceipt: (actor: FleetActor, id: string, revision: number) =>
      transaction(actor, async (state, client) => {
        z.uuid().parse(id); z.number().int().positive().parse(revision);
        const config = await readConfig(client, actor), entry = await locate(client, actor, config, id, revision);
        await canUseSubject(state, client, actor, config, entry.subject, false, true);
        // Deliberately do not fetch the source object. Workers can establish that
        // their exact revision was received without reviewer/private-file access.
        return FleetComplianceRecordReceiptSchema.parse({ id: entry.id, revision: entry.revision, subject: entry.subject, status: entry.status, updatedAt: entry.updatedAt });
      }),
    readPrivateComplianceRecord: (
      actor: FleetActor,
      id: string,
      revision?: number,
    ) =>
      transaction(actor, async (state, client) => {
        z.uuid().parse(id);
        if (revision !== undefined) z.number().int().positive().parse(revision);
        const config = await readConfig(client, actor);
        requireReviewer(config, actor);
        const entry = await locate(client, actor, config, id, revision);
        await canUseSubject(
          state,
          client,
          actor,
          config,
          entry.subject,
          false,
          true,
        );
        const record=await privateRecord(entry, actor);
        await appendFleetResourceRecord(client,actor,"fleet-compliance-private-access",entry.id,{revision:entry.revision,access:"record",occurredAt:now()});
        return record;
      }),
    readFleetComplianceRegister: (actor: FleetActor, input: unknown) => {
      const query = FleetComplianceRegisterQuerySchema.parse(input);
      return transaction(actor, async (state, client) => {
        if (actor.fleetCapabilities?.has("office") && !actor.fleetCapabilities.has("admin") && !actor.fleetCapabilities.has("dispatch") && !access(state, actor))
          throw new FleetError("fleet.finance_required", 403);
        const config = await readConfig(client, actor),
          rows = [];
        for (const entry of [...config.entries].sort((a, b) =>
          a.id.localeCompare(b.id),
        )) {
          if (
            (query.after && entry.id <= query.after) ||
            (query.subjectKind && entry.subject.kind !== query.subjectKind) ||
            (query.subjectId && String(entry.subject.id) !== query.subjectId)
          )
            continue;
          try {
            await canUseSubject(
              state,
              client,
              actor,
              config,
              entry.subject,
              false,
              true,
            );
          } catch (error) {
            if (
              error instanceof FleetError &&
              [403, 404].includes(error.status)
            )
              continue;
            throw error;
          }
          rows.push(entry);
          if (rows.length > query.limit) break;
        }
        const page = [];
        for (const entry of rows.slice(0, query.limit)) {
          const record = await privateRecord(entry, actor),
            license =
              record.attributes.kind === "driver_license"
                ? record.attributes.licenseNumber
                : null;
          const subjectKey = fleetComplianceSubjectKey(entry.subject),
            subjectEvidence = [];
          for (const related of config.entries.filter(
            (row) => fleetComplianceSubjectKey(row.subject) === subjectKey,
          )) {
            try {
              subjectEvidence.push(
                operationalEvidence(await privateRecord(related, actor),config.requirements),
              );
            } catch {}
          }
          const assessment = evaluateFleetCompliance({
            facts: { carrierId: actor.companyId },
            members: [
              {
                subject: entry.subject,
                facts:
                  config.facts.find(
                    (row) =>
                      fleetComplianceSubjectKey(row.subject) === subjectKey,
                  )?.facts ?? {},
              },
            ],
            requirements: config.requirements,
            evidence: subjectEvidence,
            at: now(),
            freshness: "current",
          })[0];
          page.push({
            id: entry.id,
            revision: entry.revision,
            subject: entry.subject,
            requirementId: entry.requirementId,
            requirementVersion: entry.requirementVersion,
            kind: entry.attributeKind,
            verification: entry.status,
            status: assessment.status,
            reasons: assessment.findings.map((row) => row.reason),
            validUntil: entry.validUntil,
            evaluatedAt: now(),
            maskedIdentifier:
              license && license.length > 4 ? `••••${license.slice(-4)}` : null,
            mayReview:
              isReviewer(config, actor) && !actor.readOnly && state.enabled,
          });
        }
        return FleetComplianceRegisterPageSchema.parse({
          entries: page,
          nextCursor: rows.length > query.limit ? page.at(-1)!.id : null,
          mode: "warn_only",
        });
      });
    },
    authorizeFleetComplianceDocument:(actor:FleetActor,input:unknown)=>{
      const value=FleetComplianceDocumentAuthorizationSchema.parse(input);
      return transaction(actor,async(state,client)=>{
        const config=await readConfig(client,actor);
        await canUseSubject(state,client,actor,config,value.subject,true);
        const existing=config.entries.find(entry=>entry.id===value.recordId);
        if(existing&&fleetComplianceSubjectKey(existing.subject)!==fleetComplianceSubjectKey(value.subject))throw new FleetError("fleet.evidence_identity_conflict");
        if((existing?.revision??0)!==value.expectedRecordVersion)throw new FleetError("fleet.version_conflict");
        return {recordId:value.recordId,subject:value.subject,revision:existing?.revision??0};
      });
    },
    uploadComplianceDocument: (actor: FleetActor, input: unknown) => {
      const value = uploadSchema.parse(input);
      return transaction(actor, async (state, client) => {
        const config = await readConfig(client, actor);
        await canUseSubject(state, client, actor, config, value.subject, true);
        const existing = config.entries.find(
          (row) => row.id === value.recordId,
        );
        if (
          existing &&
          fleetComplianceSubjectKey(existing.subject) !==
            fleetComplianceSubjectKey(value.subject)
        )
          throw new FleetError("fleet.evidence_identity_conflict");
        const prior = await receipt(client, actor, value.operationId, value);
        if (prior) return prior as { objectPath: string };
        const body = Buffer.from(value.bodyBase64, "base64");
        if (
          !body.length ||
          body.length > 10 * 1024 * 1024 ||
          body.toString("base64") !== value.bodyBase64
        )
          throw new FleetError("fleet.invalid_request", 400);
        const signature =
          value.contentType === "application/pdf"
            ? body.subarray(0, 5).toString() === "%PDF-"
            : value.contentType === "image/jpeg"
              ? body.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
              : value.contentType === "image/png"
                ? body
                    .subarray(0, 8)
                    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
                : body.subarray(0, 4).toString() === "RIFF" &&
                  body.subarray(8, 12).toString() === "WEBP";
        if (!signature) throw new FleetError("fleet.invalid_request", 400);
        const path = `${keyPrefix(actor.companyId)}${value.recordId}/documents/${digest(value)}`;
        await store().putObject(path, value.contentType, body, {
          owner: owner(actor.companyId),
          visibility: "private",
          purpose: "fleet-compliance-private",
        });
        await appendFleetResourceRecord(
          client,
          actor,
          "fleet-compliance-document",
          value.recordId,
          {
            objectPath: path,
            subject: value.subject,
            uploadedByUserId: actor.userId,
            uploadedAt: now(),
            contentType: value.contentType,
            size: body.length,
            fingerprint: digest({contentType:value.contentType,bodyBase64:value.bodyBase64}),
          },
        );
        const result = { objectPath: path };
        await saveReceipt(client, actor, value.operationId, value, result);
        return result;
      });
    },
    readComplianceDocument: (
      actor: FleetActor,
      id: string,
      revision?: number,
    ) =>
      transaction(actor, async (state, client) => {
        z.uuid().parse(id);
        const config = await readConfig(client, actor);
        requireReviewer(config, actor);
        const entry = await locate(client, actor, config, id, revision);
        await canUseSubject(
          state,
          client,
          actor,
          config,
          entry.subject,
          false,
          true,
        );
        const record = await privateRecord(entry, actor),
          path = record.evidence.privateDocumentRef;
        if (
          !path ||
          !path.startsWith(`${keyPrefix(actor.companyId)}${id}/documents/`)
        )
          throw new FleetError("fleet.not_found", 404);
        const object = await store().getObject(path);
        if (
          !object ||
          object.acl?.purpose !== "fleet-compliance-private" ||
          object.acl.visibility !== "private" ||
          object.acl.owner !== owner(actor.companyId)
        )
          throw new FleetError("fleet.not_found", 404);
        const proof=await client.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-compliance-document' AND target_id=$2 AND tool_output->>'objectPath'=$3 ORDER BY id DESC LIMIT 1",[actor.companyId,id,path]);
        const descriptor=proof.rows[0]?.tool_output;
        if(!descriptor||descriptor.size!==object.body.length||object.size!==object.body.length||descriptor.contentType!==object.contentType||descriptor.fingerprint!==digest({contentType:object.contentType,bodyBase64:object.body.toString("base64")}))throw new FleetError("fleet.private_document_unavailable",503);
        await appendFleetResourceRecord(client,actor,"fleet-compliance-private-access",entry.id,{revision:entry.revision,access:"document",occurredAt:now()});
        return object;
      }),
  };
}
