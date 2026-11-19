# VNDRLY/U certification catalog

VNDRLY/U owns one shared catalog: 115 certifications and 647 constituent courses.
The 114 named VNDRLY/U certifications map to their equivalent certification.
VUC115 is the field-work umbrella certificate and has no separate equivalent.

Generate with node scripts/build-vndrly-u-catalog.mjs; --check verifies the result.
The source material remains under research/safety-program/certifications-115.
Authenticated /api/work-hub/catalog and /api/work-hub/catalog/courses/:courseId
serve shared material directly. They create no company copies, assignments,
credentials, or notifications. Web and native catalog views display the mapping
as Equivalent certification.

Company replication through publish-certification-catalog.mjs is disabled.
The user-authorized undo script is scripts/undo-certification-company-copies.mjs.
Its default is read-only. --apply removes only deterministic IDs matched to the
original publication audit and manifest hash. Subsequent edits, assignments,
dependent rows and existing bundle references prevent removal. It verifies all
pre-existing company rows remain unchanged and refreshes the derived listing.
Publication audits remain available. Service catalogs are not modified.

Controlled final exams and protected answer keys stay outside shared course
material. Viewing material does not award credentials or authorize field work.
VUC115 retains the common VUC001, VUC003, VUC016 requirements, plus VUC009 for
general industry, VUC011 for construction, or both for mixed work, with its
original capstone, practical first-aid and review requirements.
