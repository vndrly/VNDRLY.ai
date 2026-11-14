import type { StoredUser } from "@/lib/auth";
export type QuickAction = { labelKey: string; prompt: string };
export function quickActionsForUser(user: StoredUser | null): QuickAction[] {
  return user
    ? [
        {
          labelKey: "askv.quickActions.gateWatch",
          prompt:
            "Help me review the handoff and assume watch at my authorized gate.",
        },
        { labelKey: "askv.quickActions.gateLog", prompt: "Open my Gate Log." },
        { labelKey: "askv.quickActions.gateMap", prompt: "Open the gate map." },
        {
          labelKey: "askv.quickActions.gateProfile",
          prompt: "Help me finish my profile and existing credentials.",
        },
      ]
    : [];
}
