/** The service/role baseline is platform-owned. Vendor assignments are evidence,
 * never the source of the baseline denominator. */
export type RequiredTrainingRule = {
  serviceId: string;
  roleIds: string[];
  familyIds: string[];
};
export type TrainingPerson = {
  userId: number;
  membershipId: number;
  active: boolean;
  roleIds: string[];
};
export type RequiredCourseVersion = {
  familyId: string;
  itemId: string;
  contentVersion: number;
  sourceSha256: string;
  available: boolean;
};
export type TrainingCompletionEvidence = {
  userId: number;
  membershipId: number;
  itemId: string;
  contentVersion: number;
  sourceSha256: string;
  status: string;
  refresherDueAt: string | null;
};
export function requiredTrainingCoverage(input: {
  selectedServiceIds: string[];
  rules: RequiredTrainingRule[];
  people: TrainingPerson[];
  curriculum: RequiredCourseVersion[];
  completions: TrainingCompletionEvidence[];
  externalCompletions?: {userId:number;membershipId:number;familyId:string;sourceSha256:string;certificateId:number;expiresAt:string|null}[];
  now?: Date;
}) {
  const selected = new Set(input.selectedServiceIds);
  const now = (input.now ?? new Date()).getTime();
  const pairs = new Map<string, {
    userId: number;
    membershipId: number;
    familyId: string;
    serviceIds: string[];
    itemId: string | null;
    contentVersion: number | null;
    completed: boolean;
    externalCertificateId: number | null;
    unavailable: boolean;
  }>();
  for (const person of input.people.filter(p => p.active)) {
    for (const rule of input.rules) {
      if ((rule.serviceId !== '*' && !selected.has(rule.serviceId)) ||
          !rule.roleIds.some(role => role === '*' || person.roleIds.includes(role))) continue;
      for (const familyId of rule.familyIds) {
        const key = `${person.membershipId}:${person.userId}:${familyId}`;
        const previous = pairs.get(key);
        if (previous) {
          if (!previous.serviceIds.includes(rule.serviceId)) previous.serviceIds.push(rule.serviceId);
          continue;
        }
        const course = input.curriculum.find(c => c.familyId === familyId);
        const available = !!course?.available;
        const external = input.externalCompletions?.find(c => c.userId === person.userId &&
          c.membershipId === person.membershipId && c.familyId === familyId &&
          !!course && c.sourceSha256 === course.sourceSha256 && (c.expiresAt === null || c.expiresAt >= new Date(now).toISOString().slice(0,10)));
        const completed = !!external || (available && input.completions.some(c =>
          c.userId === person.userId && c.membershipId === person.membershipId &&
          c.itemId === course.itemId && c.contentVersion === course.contentVersion &&
          c.sourceSha256 === course.sourceSha256 && c.status === 'completed' &&
          (!c.refresherDueAt || Date.parse(c.refresherDueAt) > now)));
        pairs.set(key, { userId: person.userId, membershipId: person.membershipId,
          familyId, serviceIds: [rule.serviceId], itemId: course?.itemId ?? null,
          contentVersion: course?.contentVersion ?? null, completed, externalCertificateId:external?.certificateId??null,
          unavailable: !available && !external });
      }
    }
  }
  const requirements = [...pairs.values()];
  const unmappedServiceIds = [...selected].filter(id => !input.rules.some(r => r.serviceId === id));
  const unclassifiedMembershipIds = input.people.filter(p => p.active && !p.roleIds.length).map(p => p.membershipId);
  const serviceScopeMissing = selected.size === 0;
  return {
    required: requirements.length,
    completed: requirements.filter(r => r.completed).length,
    unavailable: requirements.filter(r => r.unavailable).length,
    unmappedServiceIds,
    unclassifiedMembershipIds,
    serviceScopeMissing,
    provisional: !!(serviceScopeMissing || unmappedServiceIds.length || unclassifiedMembershipIds.length || requirements.some(r => r.unavailable)),
    requirements,
  };
}
