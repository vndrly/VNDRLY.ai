# Oil and gas external credential catalogue

Reviewed 2026-11-13. The entry picker contains 50 distinct credential and
qualification types spanning onshore/offshore orientation, well control,
workplace safety, lifting, transport, pipeline operations, inspection and
corrosion. This is a curated industry coverage list, not a statistically ranked
claim: no authoritative industry-wide frequency ranking was located. Existing
company-specific names remain available and existing records are not renamed.

The single source is `lib/api-zod/src/external-certification-catalog.ts`.
Each entry specifies its primary issuer/regulator source and the extra scope
fields needed for that credential. All entries capture the credential number,
issuer, optional issue date, expiration date, and private card image or PDF.
Dates come from the actual credential, rather than a guessed renewal period.

## Sources and capture decisions

| Entries | Primary source | Scope retained in the record |
| --- | --- | --- |
| PEC Basic Orientation, SafeGulf, H2S Clear | [Veriforce orientation](https://veriforce.com/course/basic-orientation), [H2S Clear](https://veriforce.com/course/h2s-clear) | Provider, version, offshore module and practical scope; Basic Orientation has no issuer expiry. |
| RigPass, WellSharp Drilling and Well Servicing | [IADC RigPass](https://iadc.org/accreditation/rigpass/), [WellSharp](https://iadc.org/accreditation/wellsharp/) | Endorsement, discipline, role, level, surface/subsea scope, training centre. |
| IWCF Drilling and Well Intervention | [IWCF programmes](https://www.iwcf.org/programmes/), [intervention](https://www.iwcf.org/programmes/well-intervention-pressure-control-programme/) | Level, equipment/discipline scope and centre; levels have different validity rules. |
| OSHA Outreach 10/30 construction/general industry | [OSHA FAQ](https://www.osha.gov/training/outreach/faq) | Authorized provider and completion date; cards do not expire federally, but employer/site acceptance may differ. |
| HAZWOPER 40/24/refresher | [OSHA preparedness](https://www.osha.gov/emergency-preparedness/hazardous-waste-operations/preparedness) | Underlying qualification, field experience and refresher date. |
| First Aid/CPR/AED | [American Red Cross](https://www.redcross.org/take-a-class/first-aid) | Provider, adult/pediatric scope and hands-on assessment. |
| Confined space entry/rescue, LOTO, fall protection, respirator fit, forklift, MEWP | [OSHA training requirements](https://www.osha.gov/sites/default/files/publications/OSHA2254.pdf), [respiratory protection](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.134), [powered trucks](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.178) | Employer/evaluator, roles, equipment and practical evaluation. These are task qualifications, not universal OSHA-issued licenses. |
| CCO crane/rigger I/rigger II/signalperson, NCCER rigger/signal | [CCO](https://www.nccco.org/nccco/certification-programs), [NCCER](https://www.nccer.org/rigger-signal-certifications/) | Designation, level, methods, restrictions and assessment organisation. |
| CDL, TWIC | [FMCSA](https://www.fmcsa.dot.gov/registration/commercial-drivers-license/drivers), [TSA TWIC](https://www.tsa.gov/for-industry/twic) | State/class/endorsements/restrictions or card status; these remain government-issued credentials. |
| Pipeline OQ | [PHMSA OQ](https://www.phmsa.dot.gov/pipeline/operator-qualifications/operator-qualification) | Operator, covered task IDs, evaluator and task reevaluation dates; a generic course is not operator qualification. |
| OPITO BOSIET/FOET/HUET | [OPITO](https://opito.com/for-learners-opito) | Product code, EBS/CA-EBS/tropical variant, approved centre. |
| API 510/570/653/571/577/580/936/1169 | [API ICP](https://www.api.org/products-and-services/individual-certification-programs) | Exact programme, credential status and restrictions; API controls examination/experience requirements. |
| AWS CWI and Certified Welder | [AWS CWI](https://www.aws.org/Certification-and-Education/Professional-Certification/Certified-Welding-Inspector/), [AWS programmes](https://cm.aws.org/certification-and-education/program-price-list/) | Code endorsement or welding process/WPS/material/position/continuity. |
| ASNT NDT II/III | [ASNT](https://www.asnt.org/certification) | Method, scheme and employer authorization. |
| AMPP Basic/Certified/Senior Coatings Inspector and Corrosion Technician | [AMPP inspection](https://www.ampp.org/education/education-resources/courses-by-program/coating-inspector-program), [corrosion technician](https://ampp.org/education/education-resources/courses-by-program/general-corrosion/corrosion-technician) | Exact designation including legacy NACE/SSPC and restrictions. |

Selecting a name or uploading a card never awards safety points automatically.
An authorized reviewer maps verified evidence to the particular current
curriculum topics it satisfies. Internal completion or reviewed external credit
satisfies a requirement once. Rescue, equipment, operator and site authorization
remain separate. See `external-training-credit.md` for the credit rules.

Dashboard recommendations are generated by the existing background projection
worker from that company's service/role requirements. The page reads the saved
top two outstanding topics and links to the corresponding library course.
