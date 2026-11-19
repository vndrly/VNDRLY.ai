# VNDRLY/U certification catalog

The catalog source is research/safety-program/certifications-115/catalog-source.json.
It connects 115 completed public material packages to 647 constituent study courses.
The 114 external credentials each map to a distinct VNDRLY/U curriculum counterpart.
VUC115 is the field-work umbrella, not an external credential mapping.

## Generate and verify

Run node --experimental-strip-types scripts/build-certification-catalog.mjs, then
node scripts/build-certification-program-references.mjs. Both support --check.
The generator checks package SHA-256 values, source coverage, course and lesson
schema limits, and exact coverage of the external credential catalog. It retains
all public material text. Controlled final exams and protected answer keys remain
outside the public catalog and are not copied by the generator.

## Publish

Run node --experimental-strip-types scripts/publish-certification-catalog.mjs for
read-only preflight; --first-company limits the check to the first existing company
catalog. --apply performs additive publication into existing company catalogs.
Deploy the updated API schemas and catalog projection reader before publication.
The publisher checks the exact configured database target, uses deterministic IDs,
verifies content and bundle readbacks, records publication audits, preserves prior
template revisions, and refreshes the owner-scoped library projection. It does not
create assignments, learner credentials, notification deliveries or onboarding rules.
It can be rerun without duplicate templates or publication audits.

## Completion and mapping boundaries

Study-course checkoff is reading progress. The program bundles retain an assessment
requirement, so reading completion does not produce a completed certification.
Final-exam and practical assessment administration remain separate as specified in
the original materials. Existing independently issued credentials and G99 learner
credentials are unchanged. External mapping is curriculum correspondence, not
external accreditation, transferable credit, or employer task authorization.

VUC115 retains the exact common certificates VUC001, VUC003 and VUC016, plus VUC009
for general industry, VUC011 for construction, or both for mixed field work.
It requires its capstone and evidence review, including practical first aid;
all 114 certificates are not required. The original policy remains in the source
and generated catalog. No umbrella certificate is automatically awarded.

The legacy OG reference URLs remain readable. New external mappings resolve to
VUC references, whose courses link to the active company's published records.
