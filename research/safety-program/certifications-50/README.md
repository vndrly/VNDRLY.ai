# VNDRLY/U — 50-program expansion

## Requested outcome

User instruction, 2026-11-07:

> do it and remediate existing training that wont have it, lets do it but include the 50 most common not just 25, and don't forget our flagship PEC equivalent umbrella certification. Use the internet and for examples, but go deep I want these Certifications to be shit hot

The user subsequently confirmed there are no licensed API/ASME/AWS/NFPA standards or operator OQ task lists available to supply.

## Current state — not a completed catalog

This work does **not** establish 50 complete certifications. `catalog.mjs` contains 50 source-linked program specifications, mapped to supporting courses in the existing 117-course catalog. `prepared-programs.json` preserves the supporting course/lesson identities and explicitly leaves publication readiness false. `coverage-report.md` describes the remaining work for each program. No title match, lesson count or automated test establishes full educational coverage or external equivalence.

The selection is a US-first set of commonly encountered training and credential pathways, with offshore/international programs identified. There is no reliable statistical prevalence ranking established by this research. Occupational training, external certifications, licenses and access credentials remain distinct.

The G99 Energy Safety Core flagship and its private examination are preserved. Its existing objective crosswalk and independent-review register remain applicable. This expansion does not claim PEC/Veriforce, SafeLand, SafeGulf or IADC approval or substitute a VNDRLY credential where a customer requires a named issuer credential.

## Completed original supplemental teaching

- C09, Training Assurance | Credential and Qualification Decisions: four substantive lessons, worked cases and sixteen explained checks.
- C10, Pipeline Safety | OQ Program Coordination: six substantive lessons, worked cases and eighteen explained checks. This teaches OQ program coordination, not qualification to perform an unspecified operator covered task.

These modules are in `supplemental-courses.json`. Their guided assessments preserve original responses and explained remediation through the existing training engine. They use varying answer positions. No active G99 exam material is included.

## Existing-course remediation

`artifacts/api-server/src/data/training-qualification-context.json` maps current, role-specific credential/qualification guidance to 41 existing course families. The assigned-training API returns the guidance alongside immutable content. Guided and ordinary web training display it in a collapsed reference section. It does not rewrite historical questions, lesson versions, scores, completions or assignments. It does not assert that every learner needs every associated credential.

This is **reference remediation only**. It is not proof that missing specialist teaching has been supplied or that individual external evidence has been verified. Individual credential verification, practical evaluation and task-authorization workflows still need to be connected to the applicable operator/employer records before any readiness claim.

## Research and sources

Official sources reviewed include OSHA Outreach and task-specific standards; PHMSA OQ and hazmat guidance; Veriforce's January 2025 Basic Orientation 7.0 syllabus; IADC RigPass and WellSharp; API's individual 510/570/653/1169/571/580 certification pages; AWS CWI and welder programs; ASNT Level II; OPITO's standards library and BOSIET digital-delivery requirements; IWCF; IRATA; AMPP; BCSP; FMCSA ELDT; IPAF; USCG STCW; and AHA/Red Cross delivery information. Each program retains its relevant source URLs. URLs are references, not a claim that every linked standard or current examination blueprint has been fully reviewed.

The Parallel deep-research action returned an authentication requirement and produced no research response. Direct public web research was used instead. TSA's TWIC page returned HTTP 403 to the research fetch; its current detailed application and renewal particulars remain to verify through an accessible official channel.

No proprietary course text or third-party question bank is copied. Exact code requirements, current editions and operator-specific procedures must be obtained through authorized access before claiming complete coverage. Public bodies of knowledge can guide original preparation but do not establish every underlying code requirement.

`outreach-delivery-requirements.json` records the official general-industry topic-hour allocations effective October 1, 2024, checked November 7, 2026. The build attaches them to OG04 and OG05 and verifies their totals. They are delivery constraints, not completed lesson plans or a claim of authorized Outreach delivery. CPR/first aid and standards-compliance training are not counted toward Outreach hours.

## Reproduction and checks

```powershell
node scripts/build-certification-programs.mjs
node --test scripts/certification-programs.test.mjs
pnpm --filter @workspace/api-server exec vitest run src/work-hub/training-qualification-context.test.ts
pnpm --filter @workspace/vndrly exec vitest run src/components/work-hub/library/qualification-requirements.test.tsx src/components/work-hub/library/guided-training.test.tsx
pnpm lint:i18n
```

The focused checks validate structural integrity, hashes, question/lesson associations, absence of automatic external-credit claims and display behavior. They do not validate all subject-matter accuracy, instructional effectiveness or regulatory sufficiency. Full repository validation and production deployment have not been performed for this work.

## Publication

`node scripts/publish-qualification-modules.mjs` is a read-only preflight for the two completed knowledge modules. `--apply` inserts only those modules and their audit events into existing libraries that already contain G99. It verifies deterministic identities and normalized content hashes, rejects collisions, preserves old rows and never creates assignments or publishes the unfinished 50 bundles. A readback/checkpoint records each committed company if publication runs.

At this checkpoint, publication has **not** run in apply mode. Read-only preflight stalled while reading the existing library scope. No publication success is claimed. A client query timeout was added in addition to the server timeout. Browser verification also encountered the existing PIN-setup error. Check the current process result before retrying; never infer publication from a prepared file.

Latest retry reached 155 company libraries, then stalled in the existing-family scan. The read-only process was stopped; its output is `.local/qualification-module-preflight.log`. No apply was attempted and no publication checkpoint was created. The PIN screen subsequently recovered after the local API rebuild, but the library request timed out; rendered course verification is still incomplete. Narrow successful database reads do not prove the full library scan works.

## Remaining authorized work

1. Complete source/edition checks and detailed objective-to-lesson-and-assessment mappings for all 50 programs, including the flagship crosswalk.
2. Author the missing specialist instruction, exercises and assessments identified in the coverage report. Supporting awareness courses are not sufficient substitutes.
3. Provide instructor/practical assessment materials where required and retain actual external delivery/issuer requirements separately.
4. Complete the applicable credential evidence and operator/employer acceptance workflows, with role-scoped applicability and expiry handling.
5. Validate subject matter, curriculum coverage and existing-record preservation, then create real bundled certifications in VNDRLY/U using the existing bundle model.
6. Publish and read back finished content, verify the rendered app, and report actual completion without representing this partial work as the requested finished 50-program catalog.

No user instruction has reduced that scope. Existing unrelated uncommitted Safety Program changes were present before this work and must be preserved.
