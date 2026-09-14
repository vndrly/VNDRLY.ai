import { capabilityTools } from "./types";
export const INVITATION_CAPABILITY_TOOLS = capabilityTools("account_invitations", "account invitations, activation status, resends, and revocations without passwords", "directory.read", ["admin", "partner", "vendor"]);
