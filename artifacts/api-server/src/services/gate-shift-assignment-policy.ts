type Candidate = {
  userId: number;
  requirements: {
    code: string;
    currentRecorded: boolean;
    vendorVerified: boolean;
  }[];
  availability: string;
  eligibility: {
    allowed: boolean;
    overrideRequired: boolean;
    warnings?: readonly string[];
  };
};

/** Saved eligibility only; this does not establish physical qualification or attendance. */
export function assertGateShiftAssignmentPolicy(
  configuredRequirements: string[] | null,
  selectedUserIds: number[],
  candidates: Candidate[],
  supervisor = false,
): void {
  if (!selectedUserIds.length) return;
  if (configuredRequirements === null)
    throw Error("gate_assignment.configuration_unknown");
  for (const userId of new Set(selectedUserIds)) {
    const candidate = candidates.find((item) => item.userId === userId);
    if (!candidate) throw Error("gate_assignment.candidate_unavailable");
    if (
      configuredRequirements.some(
        (code) =>
          !candidate.requirements.some(
            (requirement) =>
              requirement.code.toLowerCase() === code.toLowerCase() &&
              requirement.currentRecorded &&
              requirement.vendorVerified,
          ),
      )
    ) {
      throw Error("gate_assignment.qualification_required");
    }
    // Calendar availability, rest and overtime are scheduling information.
    const { allowed, overrideRequired, warnings } = candidate.eligibility;
    const advisoryOnly = Boolean(warnings?.length) && warnings!.every(warning =>
      warning === "workforce.overtime_warning" || warning === "workforce.rest_window_warning");
    if (!allowed || (overrideRequired && !advisoryOnly))
      throw Error("gate_assignment.policy_denied");
  }
}
