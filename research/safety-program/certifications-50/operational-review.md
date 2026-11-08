# Operational curriculum review — 2026-11-07

`operational-curricula.mjs` exports `programs`, an object keyed by OG ID. It contains 14 original VNDRLY/U knowledge programs, 87 lessons and 261 individually keyed four-option checks. Every lesson includes taught material, a solved original scenario, a transfer exercise and observable instructor/evaluator criteria. Minimum rendered lesson length at structural verification was 293 words. No lesson is a placeholder or an assignment merely to obtain another course.

## Baseline and added instruction

Reviewed `catalog.mjs` and the actual lesson titles/contents structure in `../2026-11-02/prepared-course-publication.json`. Existing C05/C06/C08 and G02/G61/G63/G69/G79/G88 supporting courses principally cover authorization, coordination, records and boundaries. They remain useful supporting content. The new lessons supply missing subject teaching and worked applications:

| Program | Dedicated instruction |
|---|---|
| OG02 | Rig systems and simultaneous work; tubular/rotation exposure; pressure force calculation and trapped volumes; traffic and transfer capacity; offshore interfaces; emergency communication and induction observation. |
| OG06 | Adult arrest recognition; current adult CPR quality; AED sequence and no-shock interpretation; severe bleeding/shock; burns/illness and last-known-well; integrated skills/coverage/handover evaluation. |
| OG10 | HAZWOPER paragraph/role classification; source-pathway-receptor characterization; monitoring limitations; PPE/decontamination; response levels; hours/field experience; recovery handoff. |
| OG12 | Configuration-specific chart reading; gross load/deductions/utilization; ground-bearing arithmetic; bridle geometry; power-line/signaling decisions; equipment and operator evaluation. |
| OG13 | CDL/endorsement/ELDT distinctions; inspection and defects; reaction-distance arithmetic; cargo/tank dynamics; fatigue and trip planning; behind-the-wheel evidence. |
| OG14 | Actual TWIC purpose; enrollment status; facility permission and escorts; loss/privacy; behavior-based security reporting; accurate mobilization records. TWIC is not represented as an occupational qualification. |
| OG16 | Hydrostatic pressure/TVD; pressure window and influx/loss; barriers; volume discrepancy arithmetic; density-increment calculation; IADC discipline/level and simulator handover. |
| OG17 | Eight lessons covering offshore induction, flight briefing, escape concepts, sea survival, fire/self-rescue, first aid, EBS variants and approved practical evidence. |
| OG18 | Six helicopter-specific lessons covering briefing, orientation/escape concepts, EBS variants, sea survival, HUET assessment and independent reassessment. |
| OG19 | Seven refresher lessons covering eligibility/skill decay, changed aircraft/equipment, escape/EBS, fire, care and change-focused reassessment. |
| OG34 | MEWP selection; support/travel path; inspection/model familiarization; load arithmetic and entrapment; fall protection/rescue; observed practical operation. |
| OG42 | Shared physical well-control foundations and original calculations, with an IWCF-specific scope/assessment endpoint. |
| OG43 | Access versus trade competence; equipment compatibility/traceability; independent protection and common-mode failure; movement concepts/tool control; feasible rescue; levels/logbooks/assessment. |
| OG50 | STCW four-element knowledge teaching, shipboard scenarios, pollution/human factors, current PSSR violence/harassment awareness, and approved proficiency/endorsement route. |

Foundational well-pressure lessons are intentionally reused in OG16/OG42 because the physics is identical; their credential-route lessons and limitations distinguish IADC and IWCF. Relevant offshore lessons are intentionally shared across BOSIET/HUET/FOET bundles, with distinct initial, helicopter and refresher endpoints. Exported lesson/check IDs remain unique to each program.

## Sources actually checked

Official live sources were searched/opened during authoring. Each exported program carries source URL strings and lesson links. The original case numbers, decision exercises and evaluator criteria were authored for VNDRLY; they are not copied examination questions or proprietary course text.

- [IADC RigPass](https://iadc.org/accreditation/rigpass/) and [WellSharp](https://iadc.org/accreditation/wellsharp/): issuer/accreditation boundaries.
- [OSHA drilling/servicing eTool](https://www.osha.gov/etools/oil-and-gas): rig hazard context.
- [AHA 2025 adult BLS](https://cpr.heart.org/en/resuscitation-science/cpr-and-ecc-guidelines/adult-basic-life-support), [Red Cross adult CPR](https://www.redcross.org/take-a-class/cpr/performing-cpr/cpr-steps), [AED guidance](https://www.redcross.org/take-a-class/aed/using-an-aed/aed-steps), and [2024 AHA/Red Cross first aid](https://cpr.heart.org/en/resuscitation-science/2024-first-aid-guidelines): adult emergency-care concepts. No pediatric or medication protocol is claimed.
- [OSHA 1910.120](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.120) and [Appendix E](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.120AppE): pathway/training distinctions.
- OSHA [1926.1417](https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.1417), [1402](https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.1402), [1408](https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.1408), [1427](https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.1427): crane operation, support, electrical and qualification boundaries. CCO official brochure search evidence confirmed written/practical route; current CCO overview direct open returned 403, so no detailed current exam schedule, fees or designation list is taught.
- [FMCSA ELDT](https://www.fmcsa.dot.gov/registration/commercial-drivers-license/entry-level-driver-training-eldt), [official curriculum summary](https://tpr.fmcsa.dot.gov/content/Resources/ELDT-Curriculum-Summary_508.pdf), [hours-of-service summary](https://www.fmcsa.dot.gov/regulations/hours-service/summary-hours-service-regulations): driver pathway and rule distinctions. This course does not claim all Part 380 curriculum hours or registered ELDT status.
- TSA TWIC landing/FAQ direct requests returned 403. Official [DHS privacy document](https://www.dhs.gov/xlibrary/assets/privacy/privacy_pia_twic09.pdf), [Federal Register access rule](https://public-inspection.federalregister.gov/2016-19383.pdf?1471869926=), and [2026 GAO TWIC report](https://files.gao.gov/reports/GAO-26-107521/index.html) provide official context. No third-party proxy is treated as an authoritative source. Enrollment fees, processing promises, contact numbers, renewal eligibility and temporary-access durations are deliberately not asserted.
- [IWCF programme](https://www.iwcf.org/programmes/drilling-well-control-programme/) and [IADC official field worksheet](https://iadc.org/wp-content/uploads/2015/06/IADC-Bullhead_FIELD-012214.pdf): programme route and stable unit/formula verification. The older worksheet is used only for the hydrostatic mathematical relation, not current accreditation requirements or an operational bullheading procedure.
- [OPITO standards library](https://opito.com/standards-and-qualifications/industry-standards-library), [official BOSIET EBS digital product](https://opito.com/standards-and-qualifications/industry-standards-library/basic-offshore-safety-induction-and-emergency-training-bosiet-with-emergency-breathing-system-ebs-digital-delivery), and [approved center directory](https://opito.com/centre-network): variant and supervised practical boundaries. No unverified product code or universal eligibility/expiry rule is taught.
- [IPAF MEWP operator route](https://www.ipaf.org/en-us/training-courses/mewp-operator-training), [OSHA aerial-lift eTool](https://www.osha.gov/etools/scaffolding/aerial-lifts), and [OSHA aerial-lift fact sheet](https://www.osha.gov/sites/default/files/publications/AERIAL_LIFTS.pdf): machine-specific instruction and practical evidence.
- [IRATA training requirements](https://irata.org/page/training-requirements), [ICOP](https://irata.org/uploads/documents/International_Code_of_Practice_%28ICOP%29_-_English_TC-102ENG.pdf), and [rescue-planning update](https://irata.org/neuigkeiten/article/new-icop-annex-R/): system/supervision/rescue and external assessment route.
- USCG STCW landing page direct request returned 403. Official indexed [NVIC 01-26 training guidance](https://www.dco.uscg.mil/Portals/9/DCO%20Documents/5p/5ps/NVIC/2025/NVIC%2001-26%20Guidelines%20for%20Coast%20Guard%20Approved%20Training%202JUN2026.pdf?ver=kCMwTe4P2oaqdGMA_cgPIA%3D%3D) identifies 2026 PSSR violence/harassment changes. The course flags current-provider verification rather than claiming transition compliance. Basic Training elements were cross-checked against official CFR material; no automatic BOSIET equivalence is asserted.

## Assessment and practical boundaries

All 261 knowledge checks have one answer, three distinct distractors and a rationale. Three checks are attached to every lesson. Arithmetic checks include units and assumptions. The curriculum includes specific observation criteria rather than a blanket instruction to ask a supervisor. Physical CPR, driving, crane/MEWP operation, rope maneuvers, offshore water/fire exercises and STCW skills still require safe supervised practical delivery and an authorized/qualified evaluator. No practical session has been conducted or passed by authoring these files.

No licensed proprietary standards, operator procedures, manufacturer charts or issuer question banks were available. Consequently these are complete original knowledge courses within the declared scope, not claims of full proprietary syllabus equivalence, issuer accreditation or unrestricted occupational authorization. Numeric examples cannot be used as real equipment limits or well-control setpoints. Clinical content is adult workplace first-aid preparation; current recognized-provider assessment remains necessary.

## Verification performed

- `node --check operational-curricula.mjs`: passed.
- ESM import of named `programs`: passed.
- Exactly the 14 assigned OG IDs present; 87 lessons and 261 checks.
- Minimum lesson length 293 words; every program has at least six lessons.
- Every lesson has three checks; all check options are distinct.
- No database, publication, shared builder or other agent-owned file was changed by this authoring task.

This is author/source review and structural validation, not independent clinical, engineering or accredited-issuer approval. Publication and learner completion must retain the declared knowledge scope and separate external/practical requirements.
