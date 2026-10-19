import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { canonicalServicesTable as services, canonicalServiceAliasesTable as aliases } from "@workspace/db/schema";
import type { ServiceCandidate, ServiceCandidateProvider, ServiceSubjectInput } from "./types";

export function normalizeServiceText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function subjectFingerprint(input: ServiceSubjectInput): string {
  // Retrieval normalization intentionally erases punctuation and case. Snapshot
  // identity must preserve the complete saved text: `>`, `<`, signs, and other
  // characters can change operational meaning. Only absent nullable fields are
  // canonicalized to null so omitted fields match their database representation.
  return createHash("sha256").update(JSON.stringify([
    input.subjectType, input.subjectId, input.name,
    input.description ?? null, input.category ?? null,
  ])).digest("hex");
}

export function validateSubject(input: ServiceSubjectInput): void {
  if (!["partner_work_type", "vendor_capability"].includes(input.subjectType) ||
      !Number.isSafeInteger(input.subjectId) || input.subjectId <= 0 ||
      !input.name?.trim() || input.name.length > 1000 ||
      (input.description?.length ?? 0) > 16000 || (input.category?.length ?? 0) > 1000) {
    throw new Error("Invalid service subject");
  }
}

type CandidateQuery = (query: SQL) => Promise<{ rows: ServiceCandidate[] }>;

/** No pool is constructed until the default provider is actually used. */
export function createPostgresCandidateProvider(execute?: CandidateQuery): ServiceCandidateProvider {
  return {
    async findCandidates(input, limit) {
      validateSubject(input);
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("Candidate limit must be 1..20");
      const name = normalizeServiceText(input.name);
      const text = normalizeServiceText([input.name, input.description, input.category].filter(Boolean).join(" "));
      // Aliases improve retrieval only: every candidate still passes through the
      // classifier, including exact matches with ambiguous operational meaning.
      const query = sql`
        with vocabulary as (
          select ${services.id} as id, ${services.code} as code, ${services.name} as name,
            ${services.category} as category, ${services.definition} as definition,
            ${services.inclusionGuidance} as "inclusionGuidance",
            ${services.exclusionGuidance} as "exclusionGuidance",
            coalesce(array_agg(${aliases.alias}) filter (where ${aliases.id} is not null), array[]::text[]) as aliases
          from ${services}
          left join ${aliases} on ${aliases.canonicalServiceId} = ${services.id} and ${aliases.active} = true
          where ${services.active} = true
          group by ${services.id}
        ), ranked as (
          select *, (
            lower(btrim(regexp_replace(name, '[^[:alnum:]]+', ' ', 'g'))) = ${name}
            or exists (select 1 from unnest(aliases) alias where lower(btrim(regexp_replace(alias, '[^[:alnum:]]+', ' ', 'g'))) = ${name})
          ) as exact_alias,
          to_tsvector('english', name || ' ' || definition || ' ' || category || ' ' || array_to_string(aliases, ' ')) as document
          from vocabulary
        )
        select id, code, name, category, definition, "inclusionGuidance", "exclusionGuidance", aliases
        from ranked
        where exact_alias or document @@ plainto_tsquery('english', ${text})
        order by exact_alias desc, ts_rank_cd(document, plainto_tsquery('english', ${text})) desc, id asc
        limit ${limit}`;
      const result = execute ? await execute(query) : await (await import("@workspace/db")).db.execute<ServiceCandidate & Record<string, unknown>>(query);
      return result.rows;
    },
  };
}
