# Workplace supplemental curricula review

Prepared 2026-11-07. Scope: OG03, OG07–09, OG11, OG26–33, OG35–41. Authoring touched only `workplace-curricula.mjs` and this review. No database, employee assignment, publication, release or external credential was changed by this work.

## Delivered teaching

The module exports `programs`, an object keyed by OG identifier, with `workplaceCurricula` and default aliases. Each of the twenty programs contains four new substantive lessons, twelve separately answered knowledge checks (three per lesson), worked decisions and a role-specific practical evaluation rubric. The final lesson specifies observable performance, critical failures, remediation and evidence boundaries. Every question supplies one correct answer, three distinct distractors and an explanation. The lessons are original supplemental instruction, not copied baseline lesson bodies or generic placeholders.

The original catalog bundles remain the mechanism for including the existing supporting courses. Those courses were inspected in `2026-11-02/prepared-course-publication.json`; the baseline has actual lesson bodies, worked cases, guided checks and final questions, rather than just titles. This module does not replace or weaken that teaching. It adds the following focused instruction:

| Program | Existing supporting families retained by catalog | New focus |
|---|---|---|
| OG03 H2S | H13 H15 E04 R01 R02 | Changed process readings, actual escape routes, respirator/rescue boundary, controlled alarm drill |
| OG07 confined spaces | H05 H03 H04 E04 G87 R02 | Classification and alternate procedures, team handover, rescue feasibility, role-by-role evaluation |
| OG08 energy control | H04 C07 H11 E02 | Governing scope, multi-energy verification, group/shift protection, actual equipment evaluation |
| OG09 heights | H08 E06 G88 R02 | Restraint versus arrest, worked clearance arithmetic, rescue loss, safe user demonstration |
| OG11 forklifts | C06 E02 E03 H20 G90 | Capacity/load-center decisions, docks and visibility, defects/fueling, actual truck evaluation |
| OG26 HazCom | H14 E07 H16 | Product/label matching, SDS task interpretation, nonroutine work, workplace teach-back |
| OG27 respirators | H15 H14 E07 | Unknown atmospheres, medical/fit/seal distinctions, failure response, actual-model demonstration |
| OG28 gas testing | E04 H13 H05 H03 G71 | Sensor selection, complete sampling assembly, timing/units, tester performance assessment |
| OG29 hot work | H06 H03 E02 R01 | Hidden ignition paths, watch coverage, changed permits, actual post-work watch and evaluation |
| OG30 excavation | H09 G86 H20 R01 | Utilities, soil/water changes, protective-system limits, competent-person decisions |
| OG31 scaffold | H08 G88 E06 | User/erector distinction, load/foundation/access, post-impact inspection, separate role rubrics |
| OG32 signal person | H07 G75 H20 | Common hand signals with official chart, dynamics, stop/handover, practical qualification route |
| OG33 rigger | H07 G75 E06 H02 | Center of gravity, idealized sling-force calculation, hitch/rating decisions, task-specific evaluation |
| OG35 electrical | H12 G60 G67 H04 E07 | Qualified scope, voltage verification, energized-work limits, controlled equipment assessment |
| OG36 hazmat | G01 G50 C05 E03 | Function scope, shipment reconciliation, loading/security, employer testing/certification records |
| OG37 bloodborne pathogens | G04 G53 I06 C08 | Occupational exposure, clean/dirty workflow, prompt clinical response, interactive Q&A and practice |
| OG38 fire response | H06 G97 R01 R03 | Evacuation/response roles, agent suitability, withdrawal, extinguisher versus brigade assessment |
| OG39 hearing | H17 E07 E02 | Exposure averaging, actual protector fit, audiometry boundaries, fit/program-use demonstration |
| OG40 silica | H16 G73 H15 H14 | Task and jurisdiction, complete Table 1 implementation, cleanup exposure, operating-control evaluation |
| OG41 driving | H19 H20 E03 C05 | Journey fitness, space/speed/attention, reversing/recovery, actual vehicle evaluation |

## Source review

Official sources were opened live on 2026-11-07. Exact URLs accompany each program in `review.sources` and each lesson in `links`. Regulatory text is distinguished from original hypothetical worked cases; mathematical examples are not equipment ratings or approved designs.

- OSHA 1910.134, .146, .147, .178, .1200, .252, .157, .156, .332, .333, .1030, .95, .1053 and .30.
- OSHA 1926.503, .502, .651, .652, .451, .454, .1428, .1419, .1422, .251, .1404 and .1153.
- [OSHA H2S hazards](https://www.osha.gov/hydrogen-sulfide/hazards), [construction confined spaces](https://www.osha.gov/confined-spaces/construction), [direct-reading monitor calibration bulletin](https://www.osha.gov/publications/shib093013), and [standard hand-signal Appendix A](https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926SubpartCCAppA).
- [PHMSA industry training requirements](https://www.phmsa.dot.gov/training/hazmat/training-requirements-industry), including employer training/testing/certification, direct supervision during the initial window, three-year recurrence and records during employment plus ninety days.
- [NIOSH motor vehicle safety at work](https://www.cdc.gov/niosh/motor-vehicle/about/). Detailed driving scenarios are original instructional applications of prevention principles, not assertions that NIOSH prescribes a specific following gap or recovery technique.

The catalog's OSHA3529 rigger PDF returned HTTP403. It was not represented as successfully reviewed. Live OSHA 1926.251 and 1926.1404 were used instead. No licensed NFPA text was accessed, copied or claimed as verified. No site-adopted NFPA edition is asserted. The hand-signal chart is an official linked public source, and its applicable complete gesture set must also be practiced in the actual practical assessment.

## Important scope corrections preserved

1. 1910.147 expressly excludes oil and gas well drilling/servicing. The course teaches energy-control principles while requiring the actual governing scope; it does not claim that every oilfield task is governed by that provision.
2. General-industry and construction confined-space, silica and fall requirements are not silently merged into one universal rule.
3. A detector bump check, calibration, sampling result and permit clearance are different evidence. A zero reading does not certify every atmospheric hazard absent.
4. Respiratory medical suitability, actual fit testing, each-donning seal checks and observed use are distinct. Private medical details are not requested in routine course records.
5. Signal-person qualification requires the applicable knowledge and practical tests; the employer-evaluator route has its actual non-portability limitation.
6. OSHA's covered half-hour post-hot-work watch minimum is taught without inventing a universal NFPA watch period. The actual site may require longer.
7. Extinguisher education/use and brigade duties are distinct; an extinguisher drill does not qualify interior structural firefighting.

## Residual limitations and honest completion

This is an author review of supplemental curriculum and source alignment, not an independent licensed professional approval or a determination of every site's legal compliance. The new lessons are generally 200–257 words, with a longer signal lesson containing actual gesture instruction. They do not claim the approximate 300-word drafting target was achieved for every lesson.

The combined bundles can record VNDRLY knowledge completion. They cannot automatically issue Veriforce H2S Clear, OPITO AGT, a government license, a portable third-party signal qualification, a professional engineering design, a medical clearance or an employer field authorization. Actual practical performance is never inferred from correct quiz answers.

Equipment manuals, site procedures, exposure assessments, permits, live emergency capability, employer role appointments and observed practical performance remain real-world evidence to obtain where the assignment requires them. Hazmat function-specific material/package/mode instruction and testing are not complete merely because the common module is passed. Bloodborne-pathogen interactive questions require an actual knowledgeable person. Fire-brigade and specialist rescue capability require their actual duty-specific programs. These are explicit external requirements, not fabricated completed activities.

## Validation performed

`node --check` passed. An import-based structural check confirmed all twenty expected keys, eighty lessons, 240 checks, at least 200 words per lesson, exactly three linked checks per lesson, nonempty source links, unique lesson/check identifiers, four distinct answer options, explanations and all referenced baseline course families present with real lessons/questions. This validates artifact integrity, not practical competence or regulatory approval. No broad application or database tests were necessary for these two standalone content files.
