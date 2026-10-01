import type { Queryable } from "../../infra/database/db.js";
import { newId } from "../../utils/crypto.js";

/**
 * Audit trails, both append-only:
 *  - audit.audit_logs: platform audit (identity, organizers, ledger postings, payments, payouts). ActorUserId is
 *    nullable; automated jobs write null with the job id as correlation id.
 *  - groups."GroupAuditEvents": group/cycle/selection/auction events, written inside the business transaction so
 *    an event can never exist without (or be lost from) the change it records.
 */
export const AuditActions = {
  UserRegistered: "USER_REGISTERED",
  UserLoginSuccess: "USER_LOGIN_SUCCESS",
  PasswordChanged: "PASSWORD_CHANGED",
  PasswordReset: "PASSWORD_RESET",
  OrganizerApplicationSubmitted: "ORGANIZER_APPLICATION_SUBMITTED",
  OrganizerApplicationApproved: "ORGANIZER_APPLICATION_APPROVED",
  OrganizerApplicationRejected: "ORGANIZER_APPLICATION_REJECTED",
  OrganizerSuspended: "ORGANIZER_SUSPENDED",
  UserRoleAssigned: "USER_ROLE_ASSIGNED",
} as const;

export interface AuditLogEntry {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  timestamp: Date;
  correlationId?: string | null;
}

export async function writeAuditLog(db: Queryable, e: AuditLogEntry): Promise<void> {
  await db.execute(
    `INSERT INTO audit.audit_logs ("Id","ActorUserId","Action","EntityType","EntityId","Timestamp","CorrelationId") VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [newId(), e.actorUserId === "00000000-0000-0000-0000-000000000000" ? null : e.actorUserId, e.action, e.entityType, e.entityId, e.timestamp, e.correlationId ? e.correlationId.slice(0, 100) : null]);
}

export interface GroupAuditEvent {
  groupId: string;
  actorUserId: string;
  action: string;
  createdAt: Date;
  subjectId?: string | null;
  cycleId?: string | null;
  selectionResultId?: string | null;
  winnerMembershipId?: string | null;
  algorithmVersion?: string | null;
}

export async function writeGroupAudit(db: Queryable, events: GroupAuditEvent | GroupAuditEvent[]): Promise<void> {
  for (const e of Array.isArray(events) ? events : [events]) {
    await db.execute(
      `INSERT INTO groups."GroupAuditEvents" ("Id","GroupId","ActorUserId","Action","CreatedAt","SubjectId","CycleId","SelectionResultId","WinnerMembershipId","AlgorithmVersion")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [newId(), e.groupId, e.actorUserId, e.action, e.createdAt, e.subjectId ?? null, e.cycleId ?? null, e.selectionResultId ?? null, e.winnerMembershipId ?? null, e.algorithmVersion ?? null]);
  }
}
