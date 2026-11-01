import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { matchSafetyTrainingRoles, type ReviewedTrainingRoleRule } from './safety-training-role-match';

const rule = (role: string, familyIds: string[]): ReviewedTrainingRoleRule => ({ role, familyIds, rationale: 'Reviewed actual-role knowledge requirement.', trigger: 'Actual assigned duty only.' });
const gate = rule('Site guard, gate attendant or security worker', ['H18','H20','H21','R01']);
const h2s = [
  rule('Worker exposed to H2S who wears an assigned personal detector', ['H13','E04']),
  rule('Gas-monitoring installation and monitoring technician', ['H13','E04','H01','H02','E02']),
  rule('Designated gas tester or permit-atmosphere verifier', ['H13','E04','C07','H03']),
  rule('Breathing-air equipment technician or assigned respirator user', ['H15','E07','E02']),
  rule('Assigned H2S rescue/response team', ['H13','H15','R01','R02','C08']),
  rule('Detector calibration/repair technician', ['E04','E01','E02']),
];

describe('matchSafetyTrainingRoles: knowledge applicability, never qualification', () => {
  it('separates a gate attendant from office staff in the same service', () => {
    const attendant = matchSafetyTrainingRoles({ jobTitle: ' Gate Attendant ', vendorRole: 'field' }, [gate]);
    const office = matchSafetyTrainingRoles({ jobTitle: 'Payroll', vendorRole: 'office' }, [gate]);
    expect(attendant.familyIds).toEqual(expect.arrayContaining(['H18','H20','H21']));
    expect(office.familyIds).not.toContain('H20');
    expect(office.matchedRoleRules.some(r => r.role === gate.role)).toBe(false);
    expect(attendant.knowledgeOnly).toBe(true);
  });
  it('does not make a personal detector user a gas tester, respirator user, calibrator or rescuer', () => {
    const got = matchSafetyTrainingRoles({ roles: ['H2S user'] }, h2s);
    expect(got.familyIds).toEqual(expect.arrayContaining(['H13','E04']));
    for (const family of ['C07','H15','R02','C08','E01']) expect(got.familyIds).not.toContain(family);
  });
  it('adds only the designated gas tester branch', () => {
    const got = matchSafetyTrainingRoles({ operationalRoles: ['gas tester'] }, h2s);
    expect(got.familyIds).toEqual(expect.arrayContaining(['H13','E04','C07','H03']));
    expect(got.familyIds).not.toContain('R02');
    expect(got.familyIds).not.toContain('H15');
    expect(got.matchedRoleRules.find(r => r.role.includes('Designated'))?.trigger).toBe('Actual assigned duty only.');
  });
  it('keeps rescue and respiratory knowledge specific to assigned H2S rescue', () => {
    const got = matchSafetyTrainingRoles({ jobTitle: 'H2S rescue technician' }, h2s);
    expect(got.familyIds).toEqual(expect.arrayContaining(['H13','H15','R02','C08']));
    expect(got.familyIds).not.toContain('C07');
    expect(got.matchedRoleRules.every(r => !!r.rationale)).toBe(true);
  });
  it('separates a gas-monitoring technician from a designated gas tester', () => {
    const got = matchSafetyTrainingRoles({ jobTitle: 'H2S Technician' }, h2s);
    expect(got.familyIds).toEqual(expect.arrayContaining(['H13','E04','E02']));
    expect(got.familyIds).not.toContain('C07');
    expect(got.familyIds).not.toContain('R02');
  });
  it('does not turn an office dispatcher into a driver from a combined reviewed label', () => {
    const transport = rule('Drivers, transport dispatch and loaders', ['H19','H20','E03','C05']);
    const office = matchSafetyTrainingRoles({ jobTitle: 'office dispatcher', vendorRole: 'office' }, [transport]);
    const driver = matchSafetyTrainingRoles({ roles: ['driver'] }, [transport]);
    expect(office.familyIds).not.toContain('H19');
    expect(office.familyIds).not.toContain('C05');
    expect(driver.familyIds).toEqual(expect.arrayContaining(['H19','H20','E03']));
    expect(driver.familyIds).not.toContain('C05');
    expect(matchSafetyTrainingRoles({ roles: ['commercial driver'] }, [transport]).familyIds).toContain('C05');
  });
  it('flags generic technician as ambiguous without awarding an electrical or gas specialty', () => {
    const got = matchSafetyTrainingRoles({ jobTitle: 'Technician', vendorRole: 'field' }, [
      ...h2s, rule('Electrical or instrument technician', ['H12','H04','C07']),
    ]);
    expect(got.unresolvedRoles.some(r => r.role === 'Technician')).toBe(true);
    for (const family of ['H12','C07','H15','R02']) expect(got.familyIds).not.toContain(family);
  });
  it('does not equate admin access with programme ownership or supervision', () => {
    const got = matchSafetyTrainingRoles({ membershipRole: 'admin' }, []);
    expect(got.familyIds).not.toContain('L01');
    expect(got.familyIds).not.toContain('C03');
    expect(got.unresolvedRoles.length).toBeGreaterThan(0);
    expect(matchSafetyTrainingRoles({ jobTitle: 'Safety Manager' }, []).familyIds).toContain('L01');
  });
  it('does not award rescue, electrical or lifting-role knowledge to every well crew member', () => {
    const got = matchSafetyTrainingRoles({ roles: ['driller'] }, [rule('Well-service or drilling crew member', ['H10','H13','R02','C08','H12','H07'])]);
    expect(got.familyIds).toEqual(expect.arrayContaining(['H10','H13']));
    for (const family of ['R02','C08','H12','H07']) expect(got.familyIds).not.toContain(family);
  });
  it('keeps instrument placement distinct from electrical work endorsement', () => {
    const got = matchSafetyTrainingRoles({ jobTitle: 'Instrument Technician' }, [rule('Electrical or instrument technician', ['H12','H04','C07','E04'])]);
    expect(got.familyIds).toContain('E04');
    expect(got.familyIds).not.toContain('H12');
    expect(got.familyIds).not.toContain('C07');
  });
  it('does not fuzzy-match an unknown reviewed role or silently claim complete coverage', () => {
    const got = matchSafetyTrainingRoles({ jobTitle: 'Gate Attendant' }, [rule('Super advanced gate engineering specialist', ['H24'])]);
    expect(got.familyIds).not.toContain('H24');
    expect(got.unresolvedRoles).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'Super advanced gate engineering specialist' })]));
  });
  it('deduplicates overlapping knowledge requirements and does not mutate inputs', () => {
    const person = { roles: Object.freeze(['driver','gatekeeper']) };
    const rules = Object.freeze([Object.freeze({ ...gate, familyIds: Object.freeze(gate.familyIds) }), gate]);
    const got = matchSafetyTrainingRoles(person, rules);
    expect(got.familyIds.filter(id => id === 'H20')).toHaveLength(1);
    expect(person.roles).toEqual(['driver','gatekeeper']);
    expect(got.matchedRoleRules).toHaveLength(3); // common worker + two traced source rules
  });
  it('matches actual legacy Gatekeeping labels without promoting all attendants to supervisors/responders/H2S users', () => {
    const map = JSON.parse(readFileSync(new URL('../../../../research/safety-program/2026-11-01/legacy-service-training-crosswalk.json', import.meta.url), 'utf8'));
    const rules: ReviewedTrainingRoleRule[] = map.entries.find((entry: { name: string }) => entry.name === 'Gatekeeping').roleMappings;
    const attendant = matchSafetyTrainingRoles({ vendorRole: 'gatekeeper' }, rules);
    expect(attendant.familyIds).toContain('H20');
    for (const family of ['C03','C08','H13','E04','R02']) expect(attendant.familyIds).not.toContain(family);
    expect(attendant.unresolvedRoles).toEqual([]);
    const lead = matchSafetyTrainingRoles({ vendorRole: 'gate_supervisor' }, rules);
    expect(lead.familyIds).toContain('C03');
    expect(lead.familyIds).not.toContain('C08');
    const exposed = matchSafetyTrainingRoles({ vendorRole: 'gatekeeper', roles: ['H2S user'] }, rules);
    expect(exposed.familyIds).toEqual(expect.arrayContaining(['H13','E04']));
    expect(exposed.familyIds).not.toContain('C07');
  });
  it('flags an unspecified equipment operator scope without inventing the machine', () => {
    const got = matchSafetyTrainingRoles({ jobTitle: 'Equipment Operator' }, [rule('Assigned equipment operators, spotters and supervisors', ['C06','H07','R02'])]);
    expect(got.familyIds).toContain('C06');
    expect(got.familyIds).not.toContain('H07');
    expect(got.unresolvedRoles.some(r => r.role === 'equipment operator')).toBe(true);
  });
  it('covers the full reviewed service-rule vocabulary with explicit mapping or a documented unresolved interpretation', () => {
    const map = JSON.parse(readFileSync(new URL('../../../../research/safety-program/2026-11-01/service-training-map.json', import.meta.url), 'utf8'));
    const rules = Object.entries(map.roleRules).map(([id, value]) => ({ ...(value as ReviewedTrainingRoleRule), id }));
    const got = matchSafetyTrainingRoles({ jobTitle: 'Office Staff' }, rules);
    expect([...new Set(got.unresolvedRoles.map(r => r.role))].sort()).toEqual([
      'Aviation operator, flight crew and passenger-interface personnel',
      'Lift-equipment service technicians after exact equipment scope review',
      'Marine/aviation personnel and coordinating supervisors',
      'Nitrogen service engineers and actual execution personnel after scope review',
      'Passenger-service coordinators and mode-qualified operating personnel',
      'Specialist leak-sealing technicians and process authority',
    ].sort());
    expect(got.unresolvedRoles.every(r => !r.reason.includes('no explicit executable cue'))).toBe(true);
  });
  it('matches clear real trade labels without inferring specialist authority', () => {
    const equipment = rule('Assigned equipment operators, spotters and supervisors', ['C06','H07']);
    expect(matchSafetyTrainingRoles({ jobTitle: 'Backhoe Operator' }, [equipment]).familyIds).toContain('C06');
    expect(matchSafetyTrainingRoles({ jobTitle: 'Compressor Mechanic' }, [rule('Mechanics, installers and maintenance supervisors', ['H04','E01','H12'])]).familyIds).toEqual(expect.arrayContaining(['H04','E01']));
    const gas = matchSafetyTrainingRoles({ jobTitle: 'Gas Tech' }, h2s);
    expect(gas.familyIds).toContain('E04');
    expect(gas.familyIds).not.toContain('C07');
    expect(gas.familyIds).not.toContain('R02');
    for (const jobTitle of ['BOP Tech','HBIC','Technician']) expect(matchSafetyTrainingRoles({ jobTitle }, h2s).unresolvedRoles.some(r => r.role === jobTitle)).toBe(true);
  });
  it('preserves every supplemental service, source and exposure gate from its exact consolidated group', () => {
    const additional = JSON.parse(readFileSync(new URL('../../../../research/safety-program/2026-11-01/additional-course-service-rules.json', import.meta.url), 'utf8'));
    const gaps = JSON.parse(readFileSync(new URL('../../../../research/safety-program/2026-11-01/consolidated-training-gaps.json', import.meta.url), 'utf8'));
    expect(additional.courses.map((c: { courseId: string }) => c.courseId)).toEqual(['G01','G02','G03','G04','G05','G06','G15','G21','G22','G23']);
    for (const course of additional.courses) {
      const group = gaps.groups.find((g: { groupId: string }) => g.groupId === course.groupId);
      expect(course.masterServiceIds).toEqual(group.affectedServiceIds);
      expect(course.qualificationBoundary).toBeTruthy();
      for (const rule of course.roleMappings) {
        expect(rule.familyIds).toEqual([course.courseId]);
        expect(rule.requiresExposureConfirmation).toBe(true);
        expect(rule.sourceRecordIds.length).toBeGreaterThan(0);
        expect(rule.primarySourceIds).toEqual(group.primarySourceIds);
        expect(rule.masterServiceIds.every((id: string) => course.masterServiceIds.includes(id))).toBe(true);
      }
    }
  });
  it('requires an explicit hazmat shipping function instead of interpreting every dispatcher as hazmat staff', () => {
    const shipping: ReviewedTrainingRoleRule = { ...rule('Assigned hazardous-material shipping/dispatch function', ['G01']), requiresExposureConfirmation: true };
    expect(matchSafetyTrainingRoles({ jobTitle: 'Office Dispatcher' }, [shipping]).familyIds).not.toContain('G01');
    const got = matchSafetyTrainingRoles({ jobTitle: 'Hazmat Dispatcher' }, [shipping]);
    expect(got.familyIds).toContain('G01');
    expect(got.matchedRoleRules.find(r => r.role === shipping.role)?.requiresExposureConfirmation).toBe(true);
  });
  it('does not give desk medical coordinators or ordinary cleaners bloodborne-exposure coverage', () => {
    const clinical = rule('Licensed clinical personnel and medical interface coordinator', ['G04']);
    const laundry = rule('Hospitality, housekeeping, laundry and personal-service personnel', ['G04']);
    expect(matchSafetyTrainingRoles({ roles: ['medical_return_to_work_coordinator'] }, [clinical]).familyIds).not.toContain('G04');
    expect(matchSafetyTrainingRoles({ jobTitle: 'Cleaner' }, [laundry]).familyIds).not.toContain('G04');
    expect(matchSafetyTrainingRoles({ jobTitle: 'Nurse' }, [clinical]).familyIds).toContain('G04');
    expect(matchSafetyTrainingRoles({ jobTitle: 'Laundry Handler' }, [laundry]).familyIds).toContain('G04');
    expect(matchSafetyTrainingRoles({ jobTitle: 'Funeral Attendant' }, [rule('Human-remains handling personnel', ['G04'])]).familyIds).toContain('G04');
  });
  it('distinguishes laboratory service from field instrumentation', () => {
    const lab = rule('Laboratory instrument service technicians', ['G06']);
    expect(matchSafetyTrainingRoles({ jobTitle: 'Instrument Technician' }, [lab]).familyIds).not.toContain('G06');
    expect(matchSafetyTrainingRoles({ jobTitle: 'Laboratory Instrument Technician' }, [lab]).familyIds).toContain('G06');
  });
});
