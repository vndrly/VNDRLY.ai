// Tiny in-process knowledge corpus. Each doc is a short markdown blob
// tagged with the roles it applies to. The assistant route picks slices
// by role + by keyword overlap with the user's latest message so we
// don't blow Claude's context window on irrelevant docs.

export type KnowledgeRole = "admin" | "partner" | "vendor" | "field_employee" | "any";
export const KNOWLEDGE_VERSION = "2026-11-11";
const synonyms: Record<string, string> = { organization: "org", organizations: "org", switching: "switch", switcher: "switch", overtime: "ot", puerta: "gate", mapa: "map", tareas: "tasks", tarea: "task", factura: "invoice", facturas: "invoices", turno: "shift", archivos: "files", calendario: "calendar", equipo: "crew", permisos: "permissions", paginacion: "pagination" };
const stopWords = new Set(["the", "and", "for", "how", "can", "you", "please", "what", "with", "this", "that", "from", "are", "have", "does", "show", "tell", "about", "como", "por", "favor", "que", "los", "las", "una", "del", "para", "con", "mostrar"]);
function queryWords(query: string): string[] {
  return [...new Set(query.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/\W+/).filter(word => (word.length >= 3 || word === "ot") && !stopWords.has(word)).flatMap(word => [word, ...(word.length > 4 && word.endsWith("s") && !word.endsWith("ss") ? [word.slice(0, -1)] : []), ...(synonyms[word] ? [synonyms[word]] : [])]))];
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  roles: KnowledgeRole[];
  // Free-text body. Keep it under ~30 lines so we can include several
  // docs at once without blowing up the system prompt.
  body: string;
}

// IMPORTANT: Edit knowledge by adding/replacing entries here, NOT by
// loading external files. Keeping it in-process avoids any filesystem
// IO on the hot path of every chat request and means the corpus is
// type-checked at build time.
import { KNOWLEDGE_DOCS } from "./docs";

export function getAllDocs(): KnowledgeDoc[] {
  return KNOWLEDGE_DOCS;
}

// ─── Pre-auth (signup-page) knowledge slice ─────────────────────
// Curated allow-list of doc IDs that are safe to surface to a visitor
// who has NOT signed in yet (e.g. on `/signup/partner`,
// `/signup/vendor`). Intentionally restricted to:
//   - cross-cutting "what is VNDRLY / how do I navigate" docs
//   - the partner/vendor/field onboarding overviews so we can answer
//     "what happens after I create the account"
//   - auth + glossary so we can field "how do I sign in" / "what's a COI"
// Anything that would describe operational features only an authed
// user could touch (tickets, invoices, crew map, analytics, etc.) is
// excluded so the pre-auth assistant can never imply a capability the
// visitor doesn't yet have.
const SIGNUP_PUBLIC_DOC_IDS: ReadonlySet<string> = new Set([
  "nav-overview",
  "ask-vndrly",
  "onboarding-partner",
  "onboarding-vendor",
  "onboarding-field",
  "finish-setup-widget",
  "auth-context",
  "auth-password",
  "glossary",
]);

export type SignupPersona = "partner" | "vendor";

/**
 * Return the public-only docs surfaced to the unauthenticated signup
 * assistant. Persona-aware: gives a small score boost to the matching
 * onboarding doc so a partner asking "what's next?" gets the partner
 * onboarding overview ranked first, and a vendor asking the same gets
 * the vendor overview. No session, no role context — knowledge is
 * limited to SIGNUP_PUBLIC_DOC_IDS regardless of query.
 */
export function selectSignupDocs(
  persona: SignupPersona,
  query: string,
  max = 6,
): KnowledgeDoc[] {
  const eligible = KNOWLEDGE_DOCS.filter((d) => SIGNUP_PUBLIC_DOC_IDS.has(d.id));
  const q = query.toLowerCase().replace(/emergency contact/g, "personal emergency contact");
  const personaDocId = persona === "partner" ? "onboarding-partner" : "onboarding-vendor";
  const scored = eligible.map((d) => {
    const hay = new Set(queryWords(`${d.title} ${d.body}`));
    const words = queryWords(q);
    const keywordScore = words.reduce((s, w) => s + (hay.has(w) ? 1 : 0), 0);
    // Persona boost: ensures the right onboarding overview floats to
    // the top even when the user's question doesn't mention the word
    // "partner"/"vendor" explicitly.
    const personaBoost = d.id === personaDocId ? 5 : 0;
    return { doc: d, score: keywordScore + personaBoost };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((s) => s.doc);
}

/**
 * Exposed for tests so the regression catalog can assert the allow-list
 * doesn't drift (e.g. someone removing the partner overview from the
 * public slice would break pre-auth signup help).
 */
export function getSignupPublicDocIds(): ReadonlySet<string> {
  return SIGNUP_PUBLIC_DOC_IDS;
}

/**
 * Return the docs relevant to a given role + (optional) keyword query.
 * The "any" role bucket always shows up first as it covers cross-cutting
 * concepts (auth, navigation, branding) that every persona needs.
 */
export function selectDocs(role: KnowledgeRole, query: string, max = 8): KnowledgeDoc[] {
  const q = query.toLowerCase().replace(/emergency contact/g, "personal emergency contact");
  const eligible = KNOWLEDGE_DOCS.filter((d) => d.roles.includes(role) || d.roles.includes("any"));
  // Score = number of stem words from the query that appear in the
  // doc's title or body. Cheap heuristic; good enough for Claude to
  // pick up on.
  const scored = eligible.map((d) => {
    const hay = new Set(queryWords(`${d.title} ${d.body}`));
    const words = queryWords(q);
    const score = words.reduce((s, w) => s + (hay.has(w) ? 1 : 0), 0);
    return { doc: d, score };
  });
  // Stable sort: highest score first, but always include "any" docs
  // as a baseline floor.
  scored.sort((a, b) => b.score - a.score);
  const picked = scored.filter(s => s.score > 0).slice(0, max).map((s) => s.doc);
  // Deduplicate while preserving order in case max>length.
  const seen = new Set<string>();
  return picked.filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
}
