export type StaffSort = "name" | "nearest" | "first" | "latest";
type Person = { userId: number; name: string; onCallStartedAt?: string | null; fresh: boolean; demonstration?: boolean; location: { latitude: number; longitude: number } | null };
export function sortGateMapStaff<T extends Person>(people: T[], sort: StaffSort, origin: { latitude: number; longitude: number } | null, locale: string) {
  const distance = (person: T) => {
    if (!origin || (!person.fresh && !person.demonstration) || !person.location) return Infinity;
    const rad = Math.PI/180, a = origin.latitude*rad, b = person.location.latitude*rad;
    return Math.sin((b-a)/2)**2 + Math.cos(a)*Math.cos(b)*Math.sin((person.location.longitude-origin.longitude)*rad/2)**2;
  };
  return [...people].sort((a,b) => {
    let difference = 0;
    if (sort === "nearest") difference = distance(a)-distance(b);
    if (sort === "first" || sort === "latest") {
      const x = Date.parse(a.onCallStartedAt ?? ""), y = Date.parse(b.onCallStartedAt ?? "");
      if (Number.isFinite(x) !== Number.isFinite(y)) return Number.isFinite(x) ? -1 : 1;
      if (Number.isFinite(x)) difference = sort === "first" ? x-y : y-x;
    }
    return difference || a.name.localeCompare(b.name, locale, { sensitivity: "base" }) || a.userId-b.userId;
  });
}
