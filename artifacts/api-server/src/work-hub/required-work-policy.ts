export type RequiredWorkRow = {
  id: string;
  title: string;
  templateVersion: number;
  assignment: {
    membershipId: number;
    contentVersion: number;
    requiredBeforeWork: boolean;
    status: string;
  };
};
export function pendingRequiredWork(
  rows: RequiredWorkRow[],
  membershipId: number,
) {
  return rows.filter((row) => {
    const a = row.assignment;
    if (
      a.membershipId !== membershipId ||
      !a.requiredBeforeWork ||
      ["completed", "cancelled", "exempted"].includes(a.status)
    )
      return false;
    if (a.contentVersion !== row.templateVersion)
      throw Error("Required assignment content version is inconsistent");
    return true;
  });
}
