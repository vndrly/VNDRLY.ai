/** System entry points select a workflow; they never authorize a record change. */
export const NATIVE_WORK_ACTIONS = [
  "workday",
  "assignments",
  "gate",
  "messages",
] as const;
export type NativeWorkAction = (typeof NATIVE_WORK_ACTIONS)[number];

export function parseNativeWorkAction(value: unknown): NativeWorkAction | null {
  return typeof value === "string" &&
    NATIVE_WORK_ACTIONS.some((action) => action === value)
    ? (value as NativeWorkAction)
    : null;
}

export function nativeWorkActionUrl(action: NativeWorkAction): string {
  if (!parseNativeWorkAction(action))
    throw new Error("Unsupported native work action");
  return `vndrly-mobile://work-hub/native-entry?action=${action}`;
}

export function parseNativeWorkActionUrl(
  value: unknown,
): NativeWorkAction | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "vndrly-mobile:" ||
      url.hostname !== "work-hub" ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      url.pathname !== "/native-entry"
    )
      return null;
    const entries = [...url.searchParams.entries()];
    if (entries.length !== 1 || entries[0][0] !== "action") return null;
    return parseNativeWorkAction(entries[0][1]);
  } catch {
    return null;
  }
}

/** Authenticated destination screens still resolve current roles and records. */
export function nativeWorkDestination(action: NativeWorkAction): string {
  switch (action) {
    case "workday":
      return "/work-hub";
    case "assignments":
      return "/(tabs)";
    case "gate":
      return "/(tabs)/gate";
    case "messages":
      return "/work-hub/channels";
  }
}
