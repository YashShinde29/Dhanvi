import type { Queryable } from "../../infra/database/db.js";
import { snakeUpper } from "../../utils/enums.js";

export const ORGANIZER_STATUSES = ["Pending", "UnderReview", "Approved", "Rejected", "Suspended"] as const;
export type OrganizerStatus = (typeof ORGANIZER_STATUSES)[number];

export interface OrganizerApplicationRow {
  Id: string; UserId: string; Status: OrganizerStatus; FullLegalName: string | null; Phone: string | null; Address: string; City: string; State: string;
  PostalCode: string; ReasonForBecomingOrganizer: string; ExperienceDescription: string | null; SubmittedAt: Date; ReviewedAt: Date | null;
  ReviewedByUserId: string | null; RejectionReason: string | null;
}
export interface OrganizerProfileRow { Id: string; UserId: string; Status: OrganizerStatus; ApprovedAt: Date | null; ApprovedByUserId: string | null; SuspendedAt: Date | null; CreatedAt: Date; UpdatedAt: Date }

/** OrganizerService.StatusName */
export const statusName = (status: OrganizerStatus): string => snakeUpper(status);

export const organizerRepository = {
  /** IOrganizerStatusReader: "NOT_APPLIED" when no profile exists. */
  async statusName(db: Queryable, userId: string): Promise<string> {
    const row = await db.maybeOne<{ Status: OrganizerStatus }>(`SELECT "Status" FROM organizers.organizer_profiles WHERE "UserId" = $1`, [userId]);
    return row ? statusName(row.Status) : "NOT_APPLIED";
  },
  async statusNames(db: Queryable, userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await db.query<{ UserId: string; Status: OrganizerStatus }>(`SELECT "UserId","Status" FROM organizers.organizer_profiles WHERE "UserId" = ANY($1::uuid[])`, [[...new Set(userIds)]]);
    const map = new Map(rows.map((r) => [r.UserId, statusName(r.Status)]));
    for (const id of userIds) if (!map.has(id)) map.set(id, "NOT_APPLIED");
    return map;
  },
  async isApproved(db: Queryable, userId: string): Promise<boolean> {
    return (await this.statusName(db, userId)) === "APPROVED";
  },
  async profile(db: Queryable, userId: string, lock = false): Promise<OrganizerProfileRow | null> {
    return db.maybeOne<OrganizerProfileRow>(`SELECT * FROM organizers.organizer_profiles WHERE "UserId" = $1${lock ? " FOR UPDATE" : ""}`, [userId]);
  },
  async latestApplication(db: Queryable, userId: string): Promise<OrganizerApplicationRow | null> {
    return db.maybeOne<OrganizerApplicationRow>(`SELECT * FROM organizers.organizer_applications WHERE "UserId" = $1 ORDER BY "SubmittedAt" DESC LIMIT 1`, [userId]);
  },
  async application(db: Queryable, id: string, lock = false): Promise<OrganizerApplicationRow | null> {
    return db.maybeOne<OrganizerApplicationRow>(`SELECT * FROM organizers.organizer_applications WHERE "Id" = $1${lock ? " FOR UPDATE" : ""}`, [id]);
  },
  async hasActiveApplication(db: Queryable, userId: string): Promise<boolean> {
    return (await db.maybeOne(`SELECT 1 FROM organizers.organizer_applications WHERE "UserId" = $1 AND "Status" IN ('Pending','UnderReview') LIMIT 1`, [userId])) !== null;
  },
  async insertApplication(db: Queryable, a: OrganizerApplicationRow): Promise<void> {
    await db.execute(`INSERT INTO organizers.organizer_applications ("Id","UserId","Status","FullLegalName","Phone","Address","City","State","PostalCode","ReasonForBecomingOrganizer","ExperienceDescription","SubmittedAt","ReviewedAt","ReviewedByUserId","RejectionReason")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [a.Id, a.UserId, a.Status, a.FullLegalName, a.Phone, a.Address, a.City, a.State, a.PostalCode, a.ReasonForBecomingOrganizer, a.ExperienceDescription, a.SubmittedAt, a.ReviewedAt, a.ReviewedByUserId, a.RejectionReason]);
  },
  async reviewApplication(db: Queryable, id: string, status: "Approved" | "Rejected", reviewer: string, now: Date, reason: string | null): Promise<void> {
    await db.execute(`UPDATE organizers.organizer_applications SET "Status" = $2, "ReviewedByUserId" = $3, "ReviewedAt" = $4, "RejectionReason" = $5 WHERE "Id" = $1`, [id, status, reviewer, now, reason]);
  },
  async insertProfile(db: Queryable, p: OrganizerProfileRow): Promise<void> {
    await db.execute(`INSERT INTO organizers.organizer_profiles ("Id","UserId","Status","ApprovedAt","ApprovedByUserId","SuspendedAt","CreatedAt","UpdatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [p.Id, p.UserId, p.Status, p.ApprovedAt, p.ApprovedByUserId, p.SuspendedAt, p.CreatedAt, p.UpdatedAt]);
  },
  async setProfileStatus(db: Queryable, userId: string, status: OrganizerStatus, now: Date, extra: { approvedBy?: string } = {}): Promise<void> {
    if (status === "Approved")
      await db.execute(`UPDATE organizers.organizer_profiles SET "Status" = 'Approved', "ApprovedAt" = $2, "ApprovedByUserId" = $3, "SuspendedAt" = NULL, "UpdatedAt" = $2 WHERE "UserId" = $1`, [userId, now, extra.approvedBy ?? null]);
    else if (status === "Suspended")
      await db.execute(`UPDATE organizers.organizer_profiles SET "Status" = 'Suspended', "SuspendedAt" = $2, "UpdatedAt" = $2 WHERE "UserId" = $1`, [userId, now]);
    else
      await db.execute(`UPDATE organizers.organizer_profiles SET "Status" = $3, "UpdatedAt" = $2 WHERE "UserId" = $1`, [userId, now, status]);
  },
};
