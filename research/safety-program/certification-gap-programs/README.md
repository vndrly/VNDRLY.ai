# Certification-picker gaps — controlled development

This directory is not an application catalog, publication source, company library,
assignment list, or credential-award source. Nothing here may be added to the
VNDRLY/U catalog until its instruction and assessments meet the existing program
requirements and the program is usable within its stated credential scope.

## User instructions

- "plus there approximately half a dozen certifications in list that dont have vndrly/u equivalents can you create the missing certifications and its constituent courses for them"
- "i dont want them added to catalog and training courses unless you can use the certification but these are incomplete and have to be flushed out like the 115 yesterday"
- "if they are duplicate or near duplicate training courses use our approved vndrly/u in catalog already rather than two near identical training courses"

## Verified inventory

Read-only authenticated local `/api/certification-names` returned 133 names on
2026-11-19. Twelve did not resolve through `certificationProgram`:

| Name | Development decision | Status |
|---|---|---|
| Cementing Tech | Reuse safety and well-servicing courses; develop cementing execution competencies | In development |
| DOT Medical Card | Medical examination, not a teachable substitute credential; review existing VUC029 coverage | Not a new award |
| Drilling Operator | Reuse VUC004/VUC005; evaluate operating-skill gaps | Coverage review pending |
| Excavating Tech | Reuse VUC011; develop equipment/task-specific excavation competence | Coverage review pending |
| Field Mechanic | Reuse VUC019 and safety courses; evaluate maintenance-skill gaps | Coverage review pending |
| Hot Oil Operator | Reuse well-servicing and chemical/ignition controls; develop thermal-service execution | Coverage review pending |
| OSHA 10 | Ambiguous General Industry/Construction label; existing VUC009/VUC011 already cover named routes | Resolve route without duplicating courses |
| Perforating Specialist | Reuse pressure-control content; evaluate explosives-specialist scope and requirements | Coverage review pending |
| Pump Mechanic | Reuse VUC019 and shared maintenance material; develop pump-specific competencies | Coverage review pending |
| Texas Level II Security | Current DPS training/provider/license requirements govern recognition | Coverage review pending |
| Wellhead Tech II | Reuse VUC006; develop assembly, testing and servicing competencies | Coverage review pending |
| Wireline Operator | Reuse VUC006/VUC008; develop line-handling and operating competencies | Coverage review pending |

There are not twelve automatically valid new certification products. An ambiguous
alias, medical clearance or existing course is not turned into a duplicate or
misleading credential merely to fill a missing link.

## Reuse and completion controls

Use the actual existing course IDs and preserve their content and completion
history. Document objectives satisfied, supporting lessons and assessments,
version/hash, and any remaining gap before accepting reuse. A similar title alone
does not establish coverage. Do not rewrite shared foundation material under a
new ID. Any genuinely new specialist course must teach its additional objectives
and have corresponding application and assessment material.

The material requirements are preserved in
`../certifications-115/authorization-verbatim.txt`; subsequent user corrections
separate material completion from deployment. Keep instruction, source review,
assessment, application integration and publication status distinct. No program
in this development directory is currently accepted complete or published.

Controlled examination keys belong in instructor-only material and must never
be bundled into learner course bodies or a public static asset. A VNDRLY award
must not claim another issuer's license, medical determination or accreditation.
