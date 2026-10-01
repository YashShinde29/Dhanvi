import type { GroupMemberPolicy } from "../../config/groups.js";
import { PRODUCTION_POLICY } from "../../config/groups.js";
import { sha256HexUpper } from "../../utils/crypto.js";
import { businessToday, compareDateOnly, type DateOnly, DEFAULT_TIME_ZONE } from "../../utils/dates.js";
import { netDecimal, netInt, type NetValue, serializeNet } from "../../utils/dotnet-json.js";
import { enumIndex } from "../../utils/enums.js";
import { requireGroup } from "../../utils/errors.js";
import { Decimal, dividesIntoPaise, isPaise, MAX_AMOUNT, toDecimal } from "../../utils/money.js";
import {
  AUCTION_FEE_POLICIES, COLLECTION_MODES, CREATOR_TYPES, GROUP_TYPES, SELECTION_METHODS,
  type CreatorType, type Group, type GroupConfiguration, type Membership, type RuleVersion, type SelectionMethod,
} from "./group.types.js";

/** GroupMemberPolicy.ValidateMemberCount */
export function validateMemberCount(count: number, policy: GroupMemberPolicy = PRODUCTION_POLICY): void {
  requireGroup(Number.isInteger(count) && count >= policy.minimumMembers && count <= policy.maximumMembers,
    "INVALID_MEMBER_LIMIT", `Member limit must be between ${policy.minimumMembers} and ${policy.maximumMembers}.`);
}

/** GroupRules.Contribution: exact paise division of the group value across members. */
export function contribution(value: Decimal, members: number, policy?: GroupMemberPolicy): Decimal {
  validateMemberCount(members, policy);
  requireGroup(value.gt(0) && value.lte(MAX_AMOUNT) && isPaise(value), "INVALID_GROUP_AMOUNT", "Group value must be positive with at most two decimal places.");
  requireGroup(dividesIntoPaise(value, members), "INVALID_CONTRIBUTION_PRECISION", "Group value divided by members must be exact to two decimal places.");
  return value.dividedBy(members);
}

/** GroupRules.Validate */
export function validateRules(rules: GroupConfiguration, creatorType: CreatorType, today: DateOnly, policy?: GroupMemberPolicy): void {
  contribution(rules.groupValue, rules.memberLimit, policy);
  requireGroup(rules.collectionMode !== "Razorpay" || creatorType === "Platform", "COLLECTION_MODE_NOT_ALLOWED", "Razorpay Test collection is available only for platform groups.");
  requireGroup(!rules.organizerFirstPayout || rules.organizerParticipates, "ORGANIZER_FIRST_PAYOUT_REQUIRES_MEMBERSHIP", "Organizer first payout requires participation.");
  requireGroup(creatorType !== "Platform" || (!rules.organizerParticipates && !rules.organizerFirstPayout), "INVALID_PLATFORM_RULES", "Platform groups cannot use organizer participation rules.");
  requireGroup(compareDateOnly(rules.startDate, today) > 0, "INVALID_START_DATE", "Start date must be in the future.");
  requireGroup(rules.contributionDueDay >= 1 && rules.payoutDay <= 28 && rules.contributionDueDay <= rules.selectionDay && rules.selectionDay <= rules.payoutDay,
    "INVALID_SCHEDULE", "Days must be between 1 and 28, in contribution, selection, payout order.");
  requireGroup(rules.groupType !== "Random" || rules.auctionRules === null, "INVALID_AUCTION_RULES", "Random groups cannot have auction rules.");
  requireGroup(rules.groupType !== "Auction" || rules.randomRules === null, "INVALID_RANDOM_RULES", "Auction groups cannot have random rules.");
  const a = rules.auctionRules;
  if (a) {
    requireGroup(a.minimumDiscount.gte(0) && a.maximumDiscount.gte(a.minimumDiscount) && a.maximumDiscount.lt(rules.groupValue) && a.bidIncrement.gt(0) && a.bidIncrement.lte(rules.groupValue) &&
      isPaise(a.minimumDiscount) && isPaise(a.maximumDiscount) && isPaise(a.bidIncrement) && a.auctionStartTime < a.auctionEndTime,
      "INVALID_AUCTION_RULES", "Discounts and increment must be valid currency amounts; auction end must follow start.");
    requireGroup(a.feePolicy === "WinnerMemberShare", "UNSUPPORTED_AUCTION_FEE_POLICY", "Only the proposed winner member share fee policy is supported.");
    requireGroup(a.maximumDiscount.gt(0) && dividesIntoPaise(a.minimumDiscount, rules.memberLimit) && dividesIntoPaise(a.maximumDiscount, rules.memberLimit) && dividesIntoPaise(a.bidIncrement, rules.memberLimit),
      "INVALID_AUCTION_ALLOCATION_PRECISION", "Auction limits and increment must divide into exact paise shares for every member position.");
  }
}

export const firstCycleSelectionMethod = (rules: GroupConfiguration): SelectionMethod =>
  rules.organizerFirstPayout ? "OrganizerReserved" : rules.groupType === "Random" ? "Random" : "Auction";

const touch = (g: Group, now: Date) => { g.updatedAt = now; g.version += 1; };

function sameRules(a: GroupConfiguration, b: GroupConfiguration): boolean {
  return rulesToJson(a) === rulesToJson(b);
}

function checkOrganizer(g: Group, approved: boolean): void {
  requireGroup(g.creatorType !== "Organizer" || approved, "ORGANIZER_NOT_APPROVED", "Organizer must still be approved.");
}

/** Group.Update — drafts only; rules stay immutable once locked. Mutates and returns the group. */
export function updateGroup(g: Group, name: string, description: string, rules: GroupConfiguration, now: Date, policy?: GroupMemberPolicy): Group {
  requireGroup(g.status === "Draft", "GROUP_NOT_EDITABLE", "Only drafts may be edited; published rules are immutable.");
  requireGroup(!g.rulesLocked || sameRules(g.rules, rules), "GROUP_RULES_LOCKED", "Rules are locked after approval or terms acceptance.");
  requireGroup(!!name && name.trim().length > 0 && name.length <= 200 && description !== null && description !== undefined && description.length <= 4000,
    "INVALID_GROUP_NAME", "Name is required (maximum 200 characters); description maximum is 4000.");
  validateRules(rules, g.creatorType, businessToday(now, g.groupTimeZone), policy);
  g.name = name.trim(); g.description = description.trim(); g.rules = rules; g.groupType = rules.groupType; g.groupValue = rules.groupValue;
  g.memberLimit = rules.memberLimit; g.monthlyContribution = contribution(rules.groupValue, rules.memberLimit, policy); g.durationMonths = rules.memberLimit;
  touch(g, now);
  return g;
}

/** Group.Create */
export function createGroup(id: string, name: string, description: string, creator: CreatorType, userId: string, rules: GroupConfiguration,
  organizerApproved: boolean, now: Date, policy?: GroupMemberPolicy): Group {
  requireGroup(creator !== "Organizer" || organizerApproved, "ORGANIZER_NOT_APPROVED", "Only approved organizers may create groups.");
  const g: Group = {
    id, name: "", description: "", creatorType: creator, createdByUserId: userId, rules, groupType: rules.groupType, groupValue: rules.groupValue,
    memberLimit: rules.memberLimit, monthlyContribution: new Decimal(0), durationMonths: 0, status: "Draft", currentMemberCount: 0, rulesLocked: false,
    rulesVersion: 0, version: 0, createdAt: now, updatedAt: now, publishedAt: null, groupTimeZone: DEFAULT_TIME_ZONE, activatedAt: null,
    currentCycleNumber: null, completedAt: null, statusReason: null,
  };
  updateGroup(g, name, description, rules, now, policy);
  if (rules.organizerParticipates) { g.currentMemberCount = 1; g.rulesLocked = true; }
  return g;
}

/** Group.Publish — returns the immutable rule version to persist. */
export function publish(g: Group, organizerApproved: boolean, now: Date, policy?: GroupMemberPolicy): RuleVersion {
  requireGroup(g.status === "Draft", "INVALID_GROUP_TRANSITION", "Only drafts may be published.");
  checkOrganizer(g, organizerApproved);
  validateRules(g.rules, g.creatorType, businessToday(now, g.groupTimeZone), policy);
  g.rulesVersion += 1; g.publishedAt = now; g.status = "Recruiting"; touch(g, now);
  return createRuleVersion(g, now);
}

export function ensureJoinable(g: Group): void {
  requireGroup(g.status === "Recruiting", "GROUP_NOT_JOINABLE", "Group is not recruiting.");
  requireGroup(g.currentMemberCount < g.rules.memberLimit, "GROUP_FULL", "Group has no available positions.");
}

/** Group.ApproveMember — returns the slot number assigned to the approved membership. */
export function approveMember(g: Group, now: Date): number {
  ensureJoinable(g);
  g.currentMemberCount += 1; g.rulesLocked = true;
  if (g.currentMemberCount === g.rules.memberLimit) g.status = "FullySubscribed";
  touch(g, now);
  return g.currentMemberCount;
}

export function lockRules(g: Group, now: Date): void { g.rulesLocked = true; touch(g, now); }

export function confirmReady(g: Group, allAccepted: boolean, approvedCount: number, organizerApproved: boolean, now: Date): void {
  requireGroup(g.status === "FullySubscribed" && g.currentMemberCount === g.rules.memberLimit && approvedCount === g.rules.memberLimit,
    "GROUP_NOT_FULLY_SUBSCRIBED", "Every position must be approved before readiness.");
  requireGroup(allAccepted, "CURRENT_RULE_VERSION_REQUIRED", "Every approved member must accept the current rules.");
  requireGroup(compareDateOnly(g.rules.startDate, businessToday(now, g.groupTimeZone)) > 0, "INVALID_START_DATE", "Start date must be in the future.");
  checkOrganizer(g, organizerApproved);
  g.status = "ReadyToStart"; touch(g, now);
}

export function activate(g: Group, approvedCount: number, allAccepted: boolean, organizerApproved: boolean, hasCycles: boolean, now: Date, policy?: GroupMemberPolicy): void {
  requireGroup(g.status === "ReadyToStart", "GROUP_NOT_READY", "Only a ready-to-start group can activate.");
  requireGroup(!hasCycles, "GROUP_ALREADY_HAS_CYCLES", "This group already has a cycle schedule.");
  requireGroup(approvedCount === g.memberLimit && g.currentMemberCount === g.memberLimit, "GROUP_NOT_FULLY_SUBSCRIBED", "Activation requires exactly the configured approved members.");
  requireGroup(allAccepted, "CURRENT_RULE_VERSION_REQUIRED", "Every member must have accepted the current published rules.");
  checkOrganizer(g, organizerApproved);
  requireGroup(compareDateOnly(g.rules.startDate, businessToday(now, g.groupTimeZone)) >= 0, "INVALID_START_DATE", "Start date must be today or in the future in the group timezone.");
  requireGroup(g.durationMonths === g.memberLimit && g.groupValue.eq(g.rules.groupValue) && g.memberLimit === g.rules.memberLimit && g.groupType === g.rules.groupType &&
    g.monthlyContribution.eq(contribution(g.groupValue, g.memberLimit, policy)) && g.monthlyContribution.times(g.memberLimit).eq(g.groupValue),
    "INVALID_EXPECTED_POOL", "Duration and expected contributions must exactly match the group's accepted rules.");
  g.status = "Active"; g.activatedAt = now; g.currentCycleNumber = 1; g.rulesLocked = true; touch(g, now);
}

/** Group.Stop — suspend or cancel with a mandatory reason. */
export function stop(g: Group, cancel: boolean, reason: string, now: Date): void {
  requireGroup(["Draft", "Recruiting", "FullySubscribed", "ReadyToStart"].includes(g.status) || (!cancel && g.status === "Active") || (cancel && g.status === "Suspended" && g.activatedAt === null),
    "INVALID_GROUP_TRANSITION", "This group cannot be suspended or cancelled.");
  requireGroup(!!reason && reason.trim().length > 0 && reason.length <= 1000, "REASON_REQUIRED", "A reason of at most 1000 characters is required.");
  g.statusReason = reason.trim(); g.status = cancel ? "Cancelled" : "Suspended"; touch(g, now);
}

export function advanceCycle(g: Group, number: number, now: Date): void {
  requireGroup(g.status === "Active" && g.currentCycleNumber !== null && number === g.currentCycleNumber + 1 && number <= g.durationMonths,
    "NEXT_CYCLE_NOT_ALLOWED", "Next cycle must follow the current active group cycle.");
  g.currentCycleNumber = number; touch(g, now);
}

export function complete(g: Group, now: Date): void {
  requireGroup(g.status === "Active" && g.currentCycleNumber === g.durationMonths, "NEXT_CYCLE_NOT_ALLOWED", "Only the final active cycle can complete the group.");
  g.status = "Completed"; g.completedAt = now; touch(g, now);
}

// ---- Memberships ---------------------------------------------------------------------------------------------

export function newMembership(id: string, groupId: string, userId: string, now: Date): Membership {
  return { id, groupId, userId, slotNumber: null, status: "Applied", appliedAt: now, approvedAt: null, rejectedAt: null, rejectedReason: null,
    termsVersionId: null, termsAcceptedAt: null, updatedAt: now, hasBeenSelectedForPayout: false, payoutCycleNumber: null };
}

const ensurePending = (m: Membership) => requireGroup(m.status === "Applied", "APPLICATION_ALREADY_REVIEWED", "Application has already been reviewed.");

export function approveMembership(m: Membership, slot: number, now: Date): void {
  ensurePending(m); m.slotNumber = slot; m.status = "Approved"; m.approvedAt = now; m.updatedAt = now;
}

export function rejectMembership(m: Membership, reason: string, now: Date): void {
  ensurePending(m);
  requireGroup(!!reason && reason.trim().length > 0 && reason.length <= 1000, "REASON_REQUIRED", "Rejection reason is required, maximum 1000 characters.");
  m.status = "Rejected"; m.rejectedReason = reason.trim(); m.rejectedAt = now; m.updatedAt = now;
}

/** GroupMembership.Accept — returns the terms acceptance to persist. */
export function acceptTerms(m: Membership, version: RuleVersion, now: Date): { membershipId: string; groupRuleVersionId: string; acceptedAt: Date; rulesHash: string } {
  requireGroup(m.status === "Approved" && version.groupId === m.groupId, "MEMBERSHIP_NOT_APPROVED", "Only approved members can accept this group's rules.");
  requireGroup(m.termsVersionId !== version.id, "TERMS_ALREADY_ACCEPTED", "You have already accepted these rules.");
  m.termsVersionId = version.id; m.termsAcceptedAt = now; m.updatedAt = now;
  return { membershipId: m.id, groupRuleVersionId: version.id, acceptedAt: now, rulesHash: version.rulesHash };
}

/** GroupMembership.SelectForPayout — a payout right is granted once per member. */
export function selectForPayout(m: Membership, cycleNumber: number, now: Date): void {
  requireGroup(m.status === "Active" && m.slotNumber !== null, "MEMBERSHIP_NOT_ELIGIBLE", "An active slotted membership is required.");
  requireGroup(!m.hasBeenSelectedForPayout, "MEMBER_ALREADY_SELECTED", "This member already owns a main payout right.");
  requireGroup(cycleNumber >= 1 && cycleNumber <= 50, "INVALID_CYCLE_NUMBER", "Invalid cycle number.");
  m.hasBeenSelectedForPayout = true; m.payoutCycleNumber = cycleNumber; m.updatedAt = now;
}

export function activateMembership(m: Membership, now: Date): void {
  requireGroup(m.status === "Approved" && m.termsVersionId !== null && m.slotNumber !== null, "MEMBERSHIP_NOT_READY", "Membership must be approved, slotted, and have accepted terms.");
  m.status = "Active"; m.updatedAt = now;
}

// ---- Rules (jsonb) and rule versions --------------------------------------------------------------------------

const netTime = (t: string) => t; // TimeOnly already normalized to "HH:mm:ss"

/** The Rules jsonb exactly as EF wrote it: default System.Text.Json (PascalCase, enums as ordinals). */
export function rulesNetValue(r: GroupConfiguration): NetValue {
  return {
    GroupType: netInt(enumIndex(r.groupType, GROUP_TYPES)),
    GroupValue: netDecimal(r.groupValue.toFixed()),
    MemberLimit: netInt(r.memberLimit),
    OrganizerParticipates: r.organizerParticipates,
    OrganizerFirstPayout: r.organizerFirstPayout,
    ContributionDueDay: netInt(r.contributionDueDay),
    SelectionDay: netInt(r.selectionDay),
    PayoutDay: netInt(r.payoutDay),
    StartDate: r.startDate,
    AuctionRules: r.auctionRules && {
      MinimumDiscount: netDecimal(r.auctionRules.minimumDiscount.toFixed()),
      MaximumDiscount: netDecimal(r.auctionRules.maximumDiscount.toFixed()),
      BidIncrement: netDecimal(r.auctionRules.bidIncrement.toFixed()),
      AuctionStartTime: netTime(r.auctionRules.auctionStartTime),
      AuctionEndTime: netTime(r.auctionRules.auctionEndTime),
      FeePolicy: netInt(enumIndex(r.auctionRules.feePolicy, AUCTION_FEE_POLICIES)),
    },
    RandomRules: r.randomRules && { AlgorithmVersion: r.randomRules.algorithmVersion, DrawTime: r.randomRules.drawTime, VerificationMethod: r.randomRules.verificationMethod },
    CollectionMode: netInt(enumIndex(r.collectionMode, COLLECTION_MODES)),
  };
}

export const rulesToJson = (r: GroupConfiguration): string => serializeNet(rulesNetValue(r));

/** Reads the Rules jsonb written by either stack. */
export function rulesFromJson(raw: unknown): GroupConfiguration {
  const o = raw as Record<string, unknown>;
  const dec = (v: unknown) => { const d = toDecimal(v); if (!d) throw new Error("Invalid decimal in group rules."); return d; };
  const ordinal = <T extends string>(v: unknown, names: readonly T[]): T => {
    if (typeof v === "number" && names[v]) return names[v] as T;
    if (typeof v === "string") { const found = names.find((n) => n.toLowerCase() === v.toLowerCase()); if (found) return found; }
    throw new Error("Invalid enum in group rules.");
  };
  const a = o.AuctionRules as Record<string, unknown> | null | undefined;
  const r = o.RandomRules as Record<string, unknown> | null | undefined;
  return {
    groupType: ordinal(o.GroupType, GROUP_TYPES),
    groupValue: dec(o.GroupValue),
    memberLimit: Number(o.MemberLimit),
    organizerParticipates: o.OrganizerParticipates === true,
    organizerFirstPayout: o.OrganizerFirstPayout === true,
    contributionDueDay: Number(o.ContributionDueDay),
    selectionDay: Number(o.SelectionDay),
    payoutDay: Number(o.PayoutDay),
    startDate: String(o.StartDate),
    auctionRules: a ? {
      minimumDiscount: dec(a.MinimumDiscount), maximumDiscount: dec(a.MaximumDiscount), bidIncrement: dec(a.BidIncrement),
      auctionStartTime: String(a.AuctionStartTime), auctionEndTime: String(a.AuctionEndTime),
      feePolicy: a.FeePolicy === undefined ? "WinnerMemberShare" : ordinal(a.FeePolicy, AUCTION_FEE_POLICIES),
    } : null,
    randomRules: r ? { algorithmVersion: String(r.AlgorithmVersion ?? "UNASSIGNED"), drawTime: (r.DrawTime as string | null) ?? null, verificationMethod: String(r.VerificationMethod ?? "NOT_IMPLEMENTED") } : null,
    collectionMode: o.CollectionMode === undefined ? "ManualTracking" : ordinal(o.CollectionMode, COLLECTION_MODES),
  };
}

const RAZORPAY_TERMS = "Razorpay TEST MODE only. Gateway capture is required for contribution readiness. Each member receives a payout right once and must continue contributing. Payout transfers are not implemented.";
const MANUAL_TERMS = "Each member receives the main payout once and must continue contributing for the remaining cycles. Organizer-reserved cycle pays the full group value with zero discount. Manual contribution tracking only.";

/** GroupRuleVersion.Create — immutable snapshot of what members accept, with its SHA-256 (uppercase hex). */
export function createRuleVersion(g: Group, now: Date, id: string = crypto.randomUUID()): RuleVersion {
  const snapshot = serializeNet({
    CreatorType: netInt(enumIndex(g.creatorType, CREATOR_TYPES)),
    CreatedByUserId: g.createdByUserId.toLowerCase(),
    Rules: rulesNetValue(g.rules),
    MonthlyContribution: netDecimal(g.monthlyContribution.toFixed(2)),
    DurationMonths: netInt(g.durationMonths),
    FirstCycleSelectionMethod: netInt(enumIndex(firstCycleSelectionMethod(g.rules), SELECTION_METHODS)),
    GroupTimeZone: g.groupTimeZone,
    Terms: g.rules.collectionMode === "Razorpay" ? RAZORPAY_TERMS : MANUAL_TERMS,
  });
  return { id, groupId: g.id, versionNumber: g.rulesVersion, rulesSnapshot: snapshot, rulesHash: sha256HexUpper(snapshot), createdAt: now, createdByUserId: g.createdByUserId };
}
