import type { StoredUser } from "@/lib/auth";
import { isForemanEmployeeUser } from "@/lib/mobile-viewer";

export type QuickAction = { labelKey: string; prompt: string };

export function quickActionsForUser(user: StoredUser | null): QuickAction[] {
  if (!user) return [];
  const role = user.role;

  if (role === "partner") {
    return [
      { labelKey: "askv.quickActions.partnerOnboarding", prompt: "Help me finish my partner onboarding step by step." },
      { labelKey: "askv.quickActions.partnerQr", prompt: "How do I print visitor QR posters for my sites?" },
      { labelKey: "askv.quickActions.partnerStatement", prompt: "Walk me through generating a statement for one of my vendors." },
    ];
  }
  if (role === "vendor") {
    return [
      { labelKey: "askv.quickActions.vendorOnboarding", prompt: "Help me finish my vendor onboarding step by step." },
      { labelKey: "askv.quickActions.vendorInvoices", prompt: "Show me my open invoices and what's overdue." },
      { labelKey: "askv.quickActions.vendorEmployee", prompt: "How do I add a new field employee?" },
    ];
  }
  if (role === "admin") {
    return [
      { labelKey: "askv.quickActions.adminPartner", prompt: "Walk me through inviting and onboarding a new partner." },
      { labelKey: "askv.quickActions.adminUnlock", prompt: "How do I unlock a closed ticket so I can edit it?" },
      { labelKey: "askv.quickActions.admin1099", prompt: "Where do I run the 1099 e-delivery report?" },
    ];
  }
  if (role === "field_employee" && isForemanEmployeeUser(user)) {
    return [
      { labelKey: "askv.quickActions.foremanCrew", prompt: "How do I check my crew in and out on a ticket?" },
      { labelKey: "askv.quickActions.foremanSchedule", prompt: "How does the schedule tab work for foremen?" },
      { labelKey: "askv.quickActions.foremanMap", prompt: "How do I use the crew map to see where my team is?" },
    ];
  }
  if (role === "field_employee") {
    return [
      { labelKey: "askv.quickActions.fieldStatus", prompt: "How do I update my ticket status from the field portal?" },
      { labelKey: "askv.quickActions.fieldPhoto", prompt: "How do I update my profile photo and certifications?" },
      { labelKey: "askv.quickActions.fieldGps", prompt: "How do I pause GPS tracking for the day?" },
    ];
  }
  return [];
}
