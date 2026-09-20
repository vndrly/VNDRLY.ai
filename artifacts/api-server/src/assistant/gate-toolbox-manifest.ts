import type { AskVRole } from "./tool-registry";

export const REQUIRED_GATE_ACTIONS = [
  "resolve_location",
  "list_local_rigs",
  "read_plate",
  "search_history",
  "list_on_site",
  "resolve_check_in",
  "prepare_check_in",
  "correct_check_in",
  "cancel_check_in",
  "submit_check_in",
  "resolve_check_out",
  "prepare_check_out",
  "correct_check_out",
  "cancel_check_out",
  "submit_check_out",
  "update_checkout_notes",
  "read_shift_context",
  "focus_gate_surface",
] as const;

export type GateToolboxAction = (typeof REQUIRED_GATE_ACTIONS)[number];

export interface GateToolboxEntry {
  action: GateToolboxAction;
  tool: string;
  kind: "read" | "client" | "prepare" | "mutate";
  roles: readonly AskVRole[];
  mutating: boolean;
  confirmation: "none" | "required";
  auditTarget: "site" | "visit" | "device";
  web: true;
  ios: true;
}

const GATE_ROLES = ["admin", "partner", "vendor", "field_employee"] as const;
const parity = { roles: GATE_ROLES, web: true, ios: true } as const;
const read = { ...parity, kind: "read", mutating: false, confirmation: "none", auditTarget: "site" } as const;
const prepare = { ...parity, kind: "prepare", mutating: false, confirmation: "none", auditTarget: "site" } as const;
const client = { ...parity, kind: "client", mutating: false, confirmation: "none" } as const;
const mutate = { ...parity, kind: "mutate", mutating: true, confirmation: "required", auditTarget: "visit" } as const;

/**
 * Product-level Gate actions mapped to the existing audited Ask V tools.
 * Corrections and cancellation remain client/pending-draft operations; they
 * are intentionally not modeled as new server mutations.
 */
export const GATE_TOOLBOX_MANIFEST = [
  { action: "resolve_location", tool: "resolve_gate_check_in", ...read },
  { action: "list_local_rigs", tool: "resolve_gate_check_in", ...read },
  { action: "read_plate", tool: "launch_camera", ...client, auditTarget: "device" },
  { action: "search_history", tool: "search_gate_history", ...read },
  { action: "list_on_site", tool: "find_active_visitors", ...read },
  { action: "resolve_check_in", tool: "resolve_gate_check_in", ...read },
  { action: "prepare_check_in", tool: "prepare_visitor_check_in", ...prepare },
  { action: "correct_check_in", tool: "prefill_draft", ...client, auditTarget: "device" },
  { action: "cancel_check_in", tool: "focus_control", ...client, auditTarget: "device" },
  { action: "submit_check_in", tool: "confirm_visitor_check_in", ...mutate },
  { action: "resolve_check_out", tool: "find_active_visitors", ...read },
  { action: "prepare_check_out", tool: "prepare_visitor_check_out", ...prepare },
  { action: "correct_check_out", tool: "prefill_draft", ...client, auditTarget: "device" },
  { action: "cancel_check_out", tool: "focus_control", ...client, auditTarget: "device" },
  { action: "submit_check_out", tool: "confirm_visitor_check_out", ...mutate },
  { action: "update_checkout_notes", tool: "prepare_visitor_check_out", ...prepare },
  { action: "read_shift_context", tool: "search_gate_history", ...read },
  { action: "focus_gate_surface", tool: "focus_control", ...client, auditTarget: "device" },
] as const satisfies readonly GateToolboxEntry[];
