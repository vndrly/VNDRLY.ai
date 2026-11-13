# Outside training and safety score credit

Outside certificates (including PEC/Veriforce and H2S providers) can satisfy
the same service/role training requirement as VNDRLY/U. The name alone is
never evidence of topic coverage. A verified PEC card is not a blanket waiver.

Vendor office/admin reviewers use the employee certificate's **Outside training
credit** control to select fully covered curriculum topics and record the
syllabus/version and verification source they reviewed. Certificates need a
verified issuer, certificate number and accepted expiration date. The issue
date is optional; when supplied it cannot be in the future. Issuer-defined
non-expiring credentials in the researched catalogue may omit expiration.
The review is bound to those certificate details and the current curriculum
source hash. Changes, expiry, deletion or removal of verification invalidate
credit; a changed curriculum requires review again.

H13 is the H2S/hazardous-atmosphere awareness requirement. H2S rescue, respiratory
equipment, instrument competence and workplace authorization remain separate.
Veriforce's H2S Clear syllabus describes the instruction and PEC record
verification: https://veriforce.com/wp-content/uploads/2026/05/H2S-Syllabus-2026.pdf
This source is not a declaration that every PEC course covers H13 or that
VNDRLY issues PEC credentials. The reviewer must verify the specific scope.

Coverage counts each active person/membership/topic once, even when both internal
and outside evidence exist. It retains the service/role denominator. Completed
training earns up to the existing 10 training points within the 20-point
competence category; it does not establish the other safety-program evidence.
Already credited competence points are not counted again. Unassessed categories
remain incomplete. Vendor bonus calculation is unchanged.

The background projection worker computes coverage and scores. Page reads only
retrieve saved projections. Existing employee-certificate database triggers
queue changes; the worker's periodic refresh handles expiration. No page read
performs the calculation. Existing certificate records are not auto-approved,
renamed or rewritten. The guarded training-projections migration adds only the
nullable `employee_certifications.training_credit` and `qualification_details`
columns for this feature. Qualification details are included in the review
fingerprint. Card images/PDFs use private storage with existing employee/office
access checks. Both personal profiles and office employee records use the same
complete capture form.
