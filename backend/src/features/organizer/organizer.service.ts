import type { Database } from "../../infra/database/db.js";
import type { Clock, Page } from "../../types/common.types.js";
import { clamp } from "../../types/common.types.js";
import { newId } from "../../utils/crypto.js";
import { parseEnum } from "../../utils/enums.js";
import { ConflictError, NotFoundError, ValidationError } from "../../utils/errors.js";
import { AuditActions, writeAuditLog } from "../audit/audit.service.js";
import { authRepository } from "../auth/auth.repository.js";
import { RoleNames } from "../auth/auth.types.js";
import { ORGANIZER_STATUSES, organizerRepository, statusName, type OrganizerApplicationRow, type OrganizerProfileRow } from "./organizer.repository.js";

export interface ApplyForOrganizerInput {
  fullLegalName?: string | null; phone?: string | null; address: string; city: string; state: string; postalCode: string;
  reasonForBecomingOrganizer: string; experienceDescription?: string | null;
}

const clean = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);

/** Port of OrganizerService. Approval grants the ORGANIZER role in the same transaction as the profile change. */
export class OrganizerService {
  constructor(private readonly db: Database, private readonly clock: Clock) {}

  async apply(userId: string, input: ApplyForOrganizerInput, correlationId: string | null) {
    const errors: Record<string, string[]> = {};
    if (!input.address?.trim()) errors.address = ["Address is required."];
    if (!input.city?.trim()) errors.city = ["City is required."];
    if (!input.state?.trim()) errors.state = ["State is required."];
    if (!input.postalCode?.trim()) errors.postalCode = ["Postal code is required."];
    if (!input.reasonForBecomingOrganizer?.trim()) errors.reasonForBecomingOrganizer = ["A reason is required."];
    if (Object.keys(errors).length > 0) throw new ValidationError(errors);
    if (!(await authRepository.directory(this.db, userId))) throw new NotFoundError("User was not found.");
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      // Serialize applications per user: the profile row (or the user row when no profile exists) is the lock.
      await authRepository.findById(tx, userId, true);
      if (await organizerRepository.hasActiveApplication(tx, userId)) throw new ConflictError("An active organizer application already exists.");
      const application: OrganizerApplicationRow = {
        Id: newId(), UserId: userId, Status: "Pending", FullLegalName: clean(input.fullLegalName), Phone: clean(input.phone), Address: input.address.trim(),
        City: input.city.trim(), State: input.state.trim(), PostalCode: input.postalCode.trim(), ReasonForBecomingOrganizer: input.reasonForBecomingOrganizer.trim(),
        ExperienceDescription: clean(input.experienceDescription), SubmittedAt: now, ReviewedAt: null, ReviewedByUserId: null, RejectionReason: null,
      };
      let profile = await organizerRepository.profile(tx, userId, true);
      if (!profile) {
        profile = { Id: newId(), UserId: userId, Status: "Pending", ApprovedAt: null, ApprovedByUserId: null, SuspendedAt: null, CreatedAt: now, UpdatedAt: now };
        await organizerRepository.insertProfile(tx, profile);
      } else {
        await organizerRepository.setProfileStatus(tx, userId, "Pending", now);
        profile = { ...profile, Status: "Pending" };
      }
      await organizerRepository.insertApplication(tx, application);
      await writeAuditLog(tx, { actorUserId: userId, action: AuditActions.OrganizerApplicationSubmitted, entityType: "OrganizerApplication", entityId: application.Id, timestamp: now, correlationId });
      return this.mapStatus(profile, application);
    });
  }

  async myStatus(userId: string) {
    const profile = await organizerRepository.profile(this.db, userId);
    if (!profile) return { status: "NOT_APPLIED", application: null };
    return this.mapStatus(profile, await organizerRepository.latestApplication(this.db, userId));
  }

  async applications(page: number, pageSize: number, status: string | undefined, search: string | undefined): Promise<Page<unknown>> {
    page = Math.max(1, page); pageSize = clamp(pageSize, 1, 100);
    const where: string[] = []; const params: unknown[] = [];
    const parsed = status?.trim() ? parseEnum(status, ORGANIZER_STATUSES) : null;
    if (parsed) { params.push(parsed); where.push(`a."Status" = $${params.length}`); }
    if (search?.trim()) {
      params.push(`%${search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      where.push(`(u."Email" ILIKE $${params.length} OR (u."FirstName" || ' ' || u."LastName") ILIKE $${params.length})`);
    }
    const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const from = `FROM organizers.organizer_applications a JOIN identity.users u ON u."Id" = a."UserId" ${filter}`;
    const total = (await this.db.one<{ count: number }>(`SELECT count(*)::int AS count ${from}`, params)).count;
    const rows = await this.db.query<{ Id: string; UserId: string; FirstName: string; LastName: string; Email: string; Phone: string | null; PhoneNumber: string | null; SubmittedAt: Date; Status: (typeof ORGANIZER_STATUSES)[number] }>(
      `SELECT a."Id", a."UserId", u."FirstName", u."LastName", u."Email", a."Phone", u."PhoneNumber", a."SubmittedAt", a."Status" ${from}
       ORDER BY a."SubmittedAt" DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, pageSize, (page - 1) * pageSize]);
    return {
      items: rows.map((r) => ({ id: r.Id, userId: r.UserId, applicant: `${r.FirstName} ${r.LastName}`, email: r.Email, phone: r.Phone ?? r.PhoneNumber, submittedAt: r.SubmittedAt, status: statusName(r.Status) })),
      page, pageSize, totalCount: total,
    };
  }

  async approve(applicationId: string, reviewerId: string, correlationId: string | null): Promise<void> {
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      const application = await organizerRepository.application(tx, applicationId, true);
      if (!application) throw new NotFoundError("Organizer application was not found.");
      if (application.Status !== "Pending" && application.Status !== "UnderReview") throw new ConflictError("Only pending or under-review applications can be reviewed.");
      await organizerRepository.reviewApplication(tx, applicationId, "Approved", reviewerId, now, null);
      await organizerRepository.setProfileStatus(tx, application.UserId, "Approved", now, { approvedBy: reviewerId });
      const added = await authRepository.assignRole(tx, application.UserId, RoleNames.Organizer, now);
      await writeAuditLog(tx, { actorUserId: reviewerId, action: AuditActions.OrganizerApplicationApproved, entityType: "OrganizerApplication", entityId: applicationId, timestamp: now, correlationId });
      if (added) await writeAuditLog(tx, { actorUserId: reviewerId, action: AuditActions.UserRoleAssigned, entityType: "User", entityId: application.UserId, timestamp: now, correlationId });
    });
  }

  async reject(applicationId: string, reviewerId: string, reason: string, correlationId: string | null): Promise<void> {
    if (!reason?.trim()) throw new ValidationError({ reason: ["Rejection reason is required."] });
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      const application = await organizerRepository.application(tx, applicationId, true);
      if (!application) throw new NotFoundError("Organizer application was not found.");
      if (application.Status !== "Pending" && application.Status !== "UnderReview") throw new ConflictError("Only pending or under-review applications can be reviewed.");
      await organizerRepository.reviewApplication(tx, applicationId, "Rejected", reviewerId, now, reason.trim());
      await organizerRepository.setProfileStatus(tx, application.UserId, "Rejected", now);
      await writeAuditLog(tx, { actorUserId: reviewerId, action: AuditActions.OrganizerApplicationRejected, entityType: "OrganizerApplication", entityId: applicationId, timestamp: now, correlationId });
    });
  }

  async suspend(userId: string, reviewerId: string, correlationId: string | null): Promise<void> {
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      const profile = await organizerRepository.profile(tx, userId, true);
      if (!profile) throw new NotFoundError("Organizer profile was not found.");
      await organizerRepository.setProfileStatus(tx, userId, "Suspended", now);
      await writeAuditLog(tx, { actorUserId: reviewerId, action: AuditActions.OrganizerSuspended, entityType: "OrganizerProfile", entityId: profile.Id, timestamp: now, correlationId });
    });
  }

  private mapStatus(profile: Pick<OrganizerProfileRow, "Status">, a: OrganizerApplicationRow | null) {
    return {
      status: statusName(profile.Status),
      application: a && { id: a.Id, submittedAt: a.SubmittedAt, reviewedAt: a.ReviewedAt, rejectionReason: a.RejectionReason, address: a.Address, city: a.City,
        state: a.State, postalCode: a.PostalCode, reasonForBecomingOrganizer: a.ReasonForBecomingOrganizer, experienceDescription: a.ExperienceDescription },
    };
  }
}
