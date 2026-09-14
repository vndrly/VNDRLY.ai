import type { AuthorityCapability, AuthorityDecision } from "../../../../lib/api-zod/src/implementation-a/authority";

export type AuthorityOwnerType = "vendor" | "partner" | "organization";
export type AuthorityActorKind =
  | "system_admin"
  | "organization_admin"
  | "employee"
  | "managed_worker"
  | "operations_display";

export type AuthorityRole =
  | "admin"
  | "member"
  | "managed_company_manager"
  | "gatekeeper"
  | "gate_supervisor"
  | "foreman"
  | "asset_manager"
  | "safety_manager";

export interface AuthorityOwner {
  type: AuthorityOwnerType;
  id: number;
}

export interface AuthorityInvitation {
  resourceType: string;
  resourceId: string;
}

export interface AuthorityActor {
  userId: number;
  kind: AuthorityActorKind;
  activeOwner?: AuthorityOwner;
  sponsorVendorId?: number;
  roles: AuthorityRole[];
  siteIds: number[];
  crewIds: string[];
  explicitInvitations: AuthorityInvitation[];
}

export interface AuthorityResource {
  type: string;
  id: string;
  owner?: AuthorityOwner;
  siteId?: number;
  crewId?: string;
  subjectUserId?: number;
}

export interface AuthorityContext {
  actor: AuthorityActor;
  resource?: AuthorityResource;
}

const OPERATIONAL_FIELDS = [
  "id",
  "name",
  "role",
  "employer",
  "sponsor",
  "siteId",
  "siteStatus",
  "shiftStatus",
];

const HOURS_EXPORT_FIELDS = [
  "workerId",
  "workerName",
  "hours",
  "approvalStatus",
  "siteId",
  "shiftDate",
];

function decision(
  allowed: boolean,
  reasonCode: string,
  options: Pick<AuthorityDecision, "confirmation" | "visibleFields"> = {
    confirmation: "none",
    visibleFields: [],
  },
): AuthorityDecision {
  return { allowed, reasonCode, ...options };
}

function sameOwner(left?: AuthorityOwner, right?: AuthorityOwner): boolean {
  if (!left || !right) return true;
  return left.type === right.type && left.id === right.id;
}

function inScope(actor: AuthorityActor, resource?: AuthorityResource): boolean {
  if (!resource) return true;
  if (resource.siteId !== undefined && !actor.siteIds.includes(resource.siteId)) return false;
  if (resource.crewId !== undefined && !actor.crewIds.includes(resource.crewId)) return false;
  return true;
}

function hasInvitation(actor: AuthorityActor, resource?: AuthorityResource): boolean {
  if (!resource) return false;
  return actor.explicitInvitations.some(
    (invitation) => invitation.resourceType === resource.type && invitation.resourceId === resource.id,
  );
}

/**
 * Central authorization policy for Implementation A. Callers must pass the
 * resource being accessed; explicit invitations deliberately grant one item,
 * never access to another organization's directory or relationships.
 */
export async function authorizeCapability(
  context: AuthorityContext,
  capability: AuthorityCapability,
  resourceOverride?: AuthorityResource,
): Promise<AuthorityDecision> {
  const actor = context.actor;
  const resource = resourceOverride ?? context.resource;

  if (actor.kind === "system_admin") {
    return decision(true, "authority.system_admin", {
      confirmation: capability === "schedule.manage" ? "required" : "none",
      visibleFields: ["*"],
    });
  }

  if (actor.kind === "operations_display") {
    const readable = new Set<AuthorityCapability>([
      "operations.display.view",
      "location.read",
      "meeting.join",
      "events.subscribe",
    ]);
    if (!readable.has(capability) || !sameOwner(actor.activeOwner, resource?.owner) || !inScope(actor, resource)) {
      return decision(false, "authority.display_read_only");
    }
    return decision(true, "authority.display_read_only_allowed", {
      confirmation: "none",
      visibleFields: OPERATIONAL_FIELDS,
    });
  }

  const crossOwner = !sameOwner(actor.activeOwner, resource?.owner);
  if (crossOwner) {
    if (capability === "meeting.join" && hasInvitation(actor, resource)) {
      return decision(true, "authority.explicit_item_invitation", {
        confirmation: "none",
        visibleFields: OPERATIONAL_FIELDS,
      });
    }
    return decision(
      false,
      actor.kind === "managed_worker"
        ? "authority.downstream_relationship_denied"
        : "authority.owner_scope_denied",
    );
  }

  if (capability === "pay_rates.read") {
    const privileged = actor.kind === "organization_admin" || actor.roles.includes("admin");
    return privileged
      ? decision(true, "authority.organization_admin", { confirmation: "none", visibleFields: ["*"] })
      : decision(false, "authority.sensitive_compensation_denied");
  }

  if (actor.kind === "organization_admin" || actor.roles.includes("admin")) {
    return decision(true, "authority.organization_admin", {
      confirmation: capability === "schedule.manage" ? "required" : "none",
      visibleFields: ["*"],
    });
  }

  if (!inScope(actor, resource)) return decision(false, "authority.assignment_scope_denied");

  if (capability === "schedule.manage") {
    const canManage = actor.roles.some((role) => role === "gate_supervisor" || role === "foreman");
    return canManage
      ? decision(true, "authority.scoped_supervisor", { confirmation: "required", visibleFields: OPERATIONAL_FIELDS })
      : decision(false, "authority.supervisor_role_required");
  }

  if (capability === "export.read") {
    const canExport = actor.roles.some((role) =>
      ["managed_company_manager", "gate_supervisor", "foreman", "asset_manager", "safety_manager"].includes(role),
    );
    return canExport
      ? decision(true, "authority.scoped_operational_export", {
          confirmation: "none",
          visibleFields: resource?.type === "hours" ? HOURS_EXPORT_FIELDS : OPERATIONAL_FIELDS,
        })
      : decision(false, "authority.export_role_required");
  }

  if (capability === "directory.read") {
    return decision(true, "authority.active_owner_directory", {
      confirmation: "none",
      visibleFields: OPERATIONAL_FIELDS,
    });
  }

  if (["meeting.join", "location.read", "events.subscribe", "operations.display.view"].includes(capability)) {
    return decision(true, "authority.assignment_scope", {
      confirmation: "none",
      visibleFields: OPERATIONAL_FIELDS,
    });
  }

  return decision(false, "authority.capability_denied");
}

export function filterAuthorityFields<T extends Record<string, unknown>>(
  value: T,
  visibleFields: readonly string[],
): Partial<T> {
  if (visibleFields.includes("*")) return value;
  const allowed = new Set(visibleFields);
  return Object.fromEntries(Object.entries(value).filter(([key]) => allowed.has(key))) as Partial<T>;
}
