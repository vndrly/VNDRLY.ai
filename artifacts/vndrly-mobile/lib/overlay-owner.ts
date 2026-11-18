const owners = new Set<string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
export const overlayOwner = {
  current: () => owners.values().next().value as string | undefined,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  claim(id: string) { owners.add(id); notify(); return () => { owners.delete(id); notify(); }; },
};
const webOwners = new Map<string, () => void>();
export function setWebOverlayOwner(id: string, open: boolean) {
  if (open && !webOwners.has(id)) webOwners.set(id, overlayOwner.claim(`web:${id}`));
  if (!open) { webOwners.get(id)?.(); webOwners.delete(id); }
}
