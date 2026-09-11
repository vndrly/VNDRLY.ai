export function nativeUuid(): string {
  const expo = (globalThis as typeof globalThis & { expo?: { uuidv4?: () => string } }).expo;
  if (typeof expo?.uuidv4 !== "function") throw new Error("Native UUID unavailable");
  return expo.uuidv4();
}
