/**
 * Drizzle Kit occasionally proposes replacing an already matching composite
 * Fleet constraint after introspection. Confirm the live definition before
 * suppressing that proposal; any real difference remains a schema failure.
 */
export async function filterEquivalentFleetConstraintDrift(
  statements: readonly string[],
  readDefinition: (table: string, name: string) => Promise<string | null>,
): Promise<string[]> {
  const addByKey = new Map<string, { index: number; definition: string }>();
  const addPattern = /^ALTER TABLE "(fleet_[^"]+)" ADD CONSTRAINT "(fleet_[^"]+)" (.+);$/i;
  const dropPattern = /^ALTER TABLE "(fleet_[^"]+)" DROP CONSTRAINT "(fleet_[^"]+)";$/i;
  statements.forEach((statement, index) => {
    const match = statement.trim().match(addPattern);
    if (match) addByKey.set(`${match[1]}:${match[2]}`, { index, definition: match[3]! });
  });
  const suppress = new Set<number>();
  for (const [index, statement] of statements.entries()) {
    const match = statement.trim().match(dropPattern);
    if (!match) continue;
    const table = match[1]!;
    const name = match[2]!;
    const add = addByKey.get(`${table}:${name}`);
    if (!add) continue;
    const live = await readDefinition(table, name);
    if (live && canonicalConstraint(live) === canonicalConstraint(add.definition)) {
      suppress.add(index);
      suppress.add(add.index);
    }
  }
  return statements.filter((_, index) => !suppress.has(index));
}

function canonicalConstraint(value: string): string {
  return value
    .replace(/"public"\.|\bpublic\./gi, "")
    .replaceAll('"', "")
    .replace(/\s+ON DELETE no action ON UPDATE no action/gi, "")
    .replace(/\s+ON UPDATE no action/gi, "")
    .replace(/\s+/g, "")
    .replace(/;$/, "")
    .toLowerCase();
}
