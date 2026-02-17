import { PublisherPolicy, Role } from './enums';
import type { OrgGovernance } from './types';

// ─── Role hierarchy ──────────────────────────────────────────────────────────

export const ROLE_HIERARCHY: Record<Role, number> = {
  [Role.ADMIN]: 3,
  [Role.MANAGER]: 2,
  [Role.REP]: 1,
};

export function hasMinRole(userRole: Role, minRole: Role): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[minRole];
}

// ─── Agent permissions ───────────────────────────────────────────────────────

/**
 * Can this role publish an agent to ORG scope?
 * Depends on the org's publisher_policy.
 */
export function canPublishOrgAgent(role: Role, policy: PublisherPolicy): boolean {
  if (policy === PublisherPolicy.ADMIN_ONLY) {
    return role === Role.ADMIN;
  }
  // ADMIN_AND_MANAGERS
  return hasMinRole(role, Role.MANAGER);
}

/**
 * Can this role create a personal agent?
 * REPs can be restricted by allow_rep_agent_creation.
 */
export function canCreatePersonalAgent(role: Role, governance: OrgGovernance): boolean {
  if (role === Role.REP && !governance.allowRepAgentCreation) {
    return false;
  }
  return true;
}

/**
 * Can this role approve/reject a submitted personal agent?
 */
export function canApproveAgent(role: Role): boolean {
  return hasMinRole(role, Role.MANAGER);
}

// ─── Org permissions ─────────────────────────────────────────────────────────

export function canManageOrg(role: Role): boolean {
  return role === Role.ADMIN;
}

export function canManageMembers(role: Role): boolean {
  return hasMinRole(role, Role.MANAGER);
}

// ─── Call permissions ────────────────────────────────────────────────────────

export function canViewAllCalls(role: Role): boolean {
  return hasMinRole(role, Role.MANAGER);
}
