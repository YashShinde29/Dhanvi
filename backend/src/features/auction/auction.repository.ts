import { snapshot, type Snapshot, updateChanged } from "../../infra/database/changes.js";
import type { Queryable, Row } from "../../infra/database/db.js";
import type { Auction, AuctionBid, AuctionResult, RescheduleReason } from "./auction.domain.js";

const mapAuction = (r: Row): Auction => ({
  id: r.Id as string, groupId: r.GroupId as string, cycleId: r.CycleId as string, cycleNumber: r.CycleNumber as number, status: r.Status as Auction["status"],
  startsAt: r.StartsAt as Date, endsAt: r.EndsAt as Date, groupValue: r.GroupValue as Auction["groupValue"], memberLimit: r.MemberLimit as number,
  minimumDiscount: r.MinimumDiscount as Auction["groupValue"], maximumDiscount: r.MaximumDiscount as Auction["groupValue"], bidIncrement: r.BidIncrement as Auction["groupValue"],
  feePolicy: r.FeePolicy as Auction["feePolicy"], currentHighestDiscount: r.CurrentHighestDiscount as Auction["groupValue"], currentWinningBidId: r.CurrentWinningBidId as string | null,
  currentWinningMembershipId: r.CurrentWinningMembershipId as string | null, lastBidSequence: r.LastBidSequence as number, openedAt: r.OpenedAt as Date | null,
  closedAt: r.ClosedAt as Date | null, winnerSelectedAt: r.WinnerSelectedAt as Date | null, createdAt: r.CreatedAt as Date, updatedAt: r.UpdatedAt as Date, version: r.Version as number,
  rescheduleCount: r.RescheduleCount as number, lastRescheduledAt: r.LastRescheduledAt as Date | null, originalStartsAt: r.OriginalStartsAt as Date, originalEndsAt: r.OriginalEndsAt as Date,
  previousStartsAt: r.PreviousStartsAt as Date | null, previousEndsAt: r.PreviousEndsAt as Date | null, latestReasonCode: r.LatestReasonCode as RescheduleReason | null,
  latestMemberMessage: r.LatestMemberMessage as string | null, closingPhase: (r.ClosingPhase as Auction["closingPhase"]) ?? null,
  closingPhaseEndsAt: (r.ClosingPhaseEndsAt as Date | null) ?? null, closingStartedAt: (r.ClosingStartedAt as Date | null) ?? null, closingVersion: (r.ClosingVersion as number) ?? 0,
});

const auctionColumns = (a: Auction) => ({
  Status: a.status, StartsAt: a.startsAt, EndsAt: a.endsAt, CurrentHighestDiscount: a.currentHighestDiscount, CurrentWinningBidId: a.currentWinningBidId,
  CurrentWinningMembershipId: a.currentWinningMembershipId, LastBidSequence: a.lastBidSequence, OpenedAt: a.openedAt, ClosedAt: a.closedAt, WinnerSelectedAt: a.winnerSelectedAt,
  UpdatedAt: a.updatedAt, Version: a.version, RescheduleCount: a.rescheduleCount, LastRescheduledAt: a.lastRescheduledAt, PreviousStartsAt: a.previousStartsAt,
  PreviousEndsAt: a.previousEndsAt, LatestReasonCode: a.latestReasonCode, LatestMemberMessage: a.latestMemberMessage, ClosingPhase: a.closingPhase,
  ClosingPhaseEndsAt: a.closingPhaseEndsAt, ClosingStartedAt: a.closingStartedAt, ClosingVersion: a.closingVersion,
});

const mapBid = (r: Row): AuctionBid => ({
  id: r.Id as string, auctionId: r.AuctionId as string, groupId: r.GroupId as string, cycleId: r.CycleId as string, membershipId: r.MembershipId as string,
  discountAmount: r.DiscountAmount as AuctionBid["discountAmount"], sequenceNumber: r.SequenceNumber as number, idempotencyKey: r.IdempotencyKey as string, submittedAt: r.SubmittedAt as Date,
});

export const auctionRepository = {
  async forCycle(db: Queryable, groupId: string, cycleId: string, lock = false): Promise<Auction | null> {
    const r = await db.maybeOne(`SELECT * FROM groups."Auctions" WHERE "GroupId" = $1 AND "CycleId" = $2${lock ? " FOR UPDATE" : ""}`, [groupId, cycleId]);
    return r && mapAuction(r);
  },
  async byId(db: Queryable, id: string): Promise<Auction | null> {
    const r = await db.maybeOne(`SELECT * FROM groups."Auctions" WHERE "Id" = $1`, [id]);
    return r && mapAuction(r);
  },
  snapshot: (a: Auction): Snapshot => snapshot(auctionColumns(a)),
  async insert(db: Queryable, a: Auction): Promise<void> {
    await db.execute(`INSERT INTO groups."Auctions" ("Id","GroupId","CycleId","CycleNumber","Status","StartsAt","EndsAt","GroupValue","MemberLimit","MinimumDiscount","MaximumDiscount",
      "BidIncrement","FeePolicy","CurrentHighestDiscount","CurrentWinningBidId","CurrentWinningMembershipId","LastBidSequence","OpenedAt","ClosedAt","WinnerSelectedAt","CreatedAt",
      "UpdatedAt","Version","LastRescheduledAt","LatestMemberMessage","LatestReasonCode","OriginalEndsAt","OriginalStartsAt","PreviousEndsAt","PreviousStartsAt","RescheduleCount",
      "ClosingPhase","ClosingPhaseEndsAt","ClosingStartedAt","ClosingVersion")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)`,
      [a.id, a.groupId, a.cycleId, a.cycleNumber, a.status, a.startsAt, a.endsAt, a.groupValue.toFixed(), a.memberLimit, a.minimumDiscount.toFixed(), a.maximumDiscount.toFixed(),
        a.bidIncrement.toFixed(), a.feePolicy, a.currentHighestDiscount.toFixed(), a.currentWinningBidId, a.currentWinningMembershipId, a.lastBidSequence, a.openedAt, a.closedAt,
        a.winnerSelectedAt, a.createdAt, a.updatedAt, a.version, a.lastRescheduledAt, a.latestMemberMessage, a.latestReasonCode, a.originalEndsAt, a.originalStartsAt, a.previousEndsAt,
        a.previousStartsAt, a.rescheduleCount, a.closingPhase, a.closingPhaseEndsAt, a.closingStartedAt, a.closingVersion]);
  },
  async save(db: Queryable, a: Auction, before: Snapshot): Promise<void> {
    await updateChanged(db, `groups."Auctions"`, a.id, before, auctionColumns(a));
  },
  async bids(db: Queryable, groupId: string, cycleId: string): Promise<AuctionBid[]> {
    return (await db.query(`SELECT * FROM groups."AuctionBids" WHERE "GroupId" = $1 AND "CycleId" = $2 ORDER BY "SequenceNumber"`, [groupId, cycleId])).map(mapBid);
  },
  async insertBid(db: Queryable, b: AuctionBid): Promise<void> {
    await db.execute(`INSERT INTO groups."AuctionBids" ("Id","AuctionId","GroupId","CycleId","MembershipId","DiscountAmount","SequenceNumber","IdempotencyKey","SubmittedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [b.id, b.auctionId, b.groupId, b.cycleId, b.membershipId, b.discountAmount.toFixed(), b.sequenceNumber, b.idempotencyKey, b.submittedAt]);
  },
  async result(db: Queryable, groupId: string, cycleId: string): Promise<AuctionResult | null> {
    const r = await db.maybeOne<Row>(`SELECT * FROM groups."AuctionResults" WHERE "GroupId" = $1 AND "CycleId" = $2`, [groupId, cycleId]);
    if (!r) return null;
    const allocations = await db.query<Row>(`SELECT * FROM groups."AuctionBenefitAllocations" WHERE "AuctionResultId" = $1 ORDER BY "AllocationType" DESC, "MembershipId", "Id"`, [r.Id]);
    return {
      id: r.Id as string, auctionId: r.AuctionId as string, groupId: r.GroupId as string, cycleId: r.CycleId as string, selectionResultId: r.SelectionResultId as string,
      winningBidId: r.WinningBidId as string, winnerMembershipId: r.WinnerMembershipId as string, groupValue: r.GroupValue as AuctionResult["groupValue"], memberLimit: r.MemberLimit as number,
      winningDiscount: r.WinningDiscount as AuctionResult["groupValue"], winnerPayout: r.WinnerPayout as AuctionResult["groupValue"], grossMemberShare: r.GrossMemberShare as AuctionResult["groupValue"],
      platformFee: r.PlatformFee as AuctionResult["groupValue"], memberBenefitPool: r.MemberBenefitPool as AuctionResult["groupValue"], feePolicy: r.FeePolicy as AuctionResult["feePolicy"],
      calculationVersion: r.CalculationVersion as string, finalizedAt: r.FinalizedAt as Date, finalizedByUserId: r.FinalizedByUserId as string,
      allocations: allocations.map((x) => ({ id: x.Id as string, membershipId: x.MembershipId as string | null, allocationType: x.AllocationType as "MemberBenefit" | "PlatformFee",
        amount: x.Amount as AuctionResult["groupValue"], createdAt: x.CreatedAt as Date })),
    };
  },
  async insertResult(db: Queryable, r: AuctionResult): Promise<void> {
    await db.execute(`INSERT INTO groups."AuctionResults" ("Id","AuctionId","GroupId","CycleId","SelectionResultId","WinningBidId","WinnerMembershipId","GroupValue","MemberLimit",
      "WinningDiscount","WinnerPayout","GrossMemberShare","PlatformFee","MemberBenefitPool","FeePolicy","CalculationVersion","FinalizedAt","FinalizedByUserId")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [r.id, r.auctionId, r.groupId, r.cycleId, r.selectionResultId, r.winningBidId, r.winnerMembershipId, r.groupValue.toFixed(), r.memberLimit, r.winningDiscount.toFixed(),
        r.winnerPayout.toFixed(), r.grossMemberShare.toFixed(), r.platformFee.toFixed(), r.memberBenefitPool.toFixed(), r.feePolicy, r.calculationVersion, r.finalizedAt, r.finalizedByUserId]);
    for (const a of r.allocations)
      await db.execute(`INSERT INTO groups."AuctionBenefitAllocations" ("Id","AuctionResultId","GroupId","MembershipId","AllocationType","Amount","CreatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [a.id, r.id, r.groupId, a.membershipId, a.allocationType, a.amount.toFixed(), a.createdAt]);
  },
  async insertScheduleChange(db: Queryable, c: { id: string; auctionId: string; groupId: string; cycleId: string; changeSequence: number; previousStartsAt: Date; previousEndsAt: Date;
    newStartsAt: Date; newEndsAt: Date; reasonCode: RescheduleReason; reasonText: string | null; memberMessage: string | null; changedByUserId: string; changedByRole: "ADMIN" | "ORGANIZER"; changedAt: Date }): Promise<void> {
    await db.execute(`INSERT INTO groups."AuctionScheduleChanges" ("Id","AuctionId","GroupId","CycleId","ChangeSequence","PreviousStartsAt","PreviousEndsAt","NewStartsAt","NewEndsAt",
      "ReasonCode","ReasonText","MemberMessage","ChangedByUserId","ChangedByRole","ChangedAt","CreatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)`,
      [c.id, c.auctionId, c.groupId, c.cycleId, c.changeSequence, c.previousStartsAt, c.previousEndsAt, c.newStartsAt, c.newEndsAt, c.reasonCode, c.reasonText, c.memberMessage,
        c.changedByUserId, c.changedByRole, c.changedAt]);
  },
  async auditFor(db: Queryable, groupId: string, cycleId: string) {
    return db.query<{ Action: string; CreatedAt: Date; SubjectId: string | null }>(
      `SELECT "Action","CreatedAt","SubjectId" FROM groups."GroupAuditEvents" WHERE "GroupId" = $1 AND "CycleId" = $2 AND "AlgorithmVersion" = 'DHANVI_AUCTION_V1' ORDER BY "CreatedAt", "Id"`, [groupId, cycleId]);
  },
};
