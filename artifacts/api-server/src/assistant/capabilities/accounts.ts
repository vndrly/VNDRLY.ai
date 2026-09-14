import { capabilityTools } from "./types";
export const ACCOUNT_CAPABILITY_TOOLS = [
  ...capabilityTools("worker_subscriptions", "company-sponsored worker subscription lifecycle", "directory.read", ["admin", "partner", "vendor"]),
  ...capabilityTools("operations_displays", "authorized operations display views", "operations.display.view", ["admin", "partner", "vendor"]),
];
