import { z } from "zod";
import { Decimal } from "../../utils/money.js";
import { zDateOnly, zDecimal, zEnum, zTimeOnly } from "../../utils/schema.js";
import { AUCTION_FEE_POLICIES, COLLECTION_MODES, GROUP_TYPES, type GroupConfiguration } from "./group.types.js";

/**
 * SaveGroupRequest. Missing value-type fields default exactly as System.Text.Json left them (0 / false / first enum
 * member / default DateOnly), so the domain returns the same business error codes the .NET API did.
 */
const int = () => z.number().int().nullish().transform((v) => v ?? 0);
const bool = () => z.boolean().nullish().transform((v) => v ?? false);

export const auctionRulesBody = z.object({
  minimumDiscount: zDecimal(), maximumDiscount: zDecimal(), bidIncrement: zDecimal(), auctionStartTime: zTimeOnly(), auctionEndTime: zTimeOnly(),
  feePolicy: zEnum(AUCTION_FEE_POLICIES).nullish().transform((v) => v ?? "WinnerMemberShare"),
});
export const randomRulesBody = z.object({ algorithmVersion: z.string().nullish(), drawTime: zTimeOnly().nullish(), verificationMethod: z.string().nullish() });

export const saveGroupBody = z.object({
  name: z.string().nullish().transform((v) => v ?? ""),
  description: z.string().nullish(),
  groupType: zEnum(GROUP_TYPES).nullish().transform((v) => v ?? "Random"),
  groupValue: zDecimal().nullish(),
  memberLimit: int(), organizerParticipates: bool(), organizerFirstPayout: bool(), contributionDueDay: int(), selectionDay: int(), payoutDay: int(),
  startDate: zDateOnly().nullish().transform((v) => v ?? "0001-01-01"),
  auctionRules: auctionRulesBody.nullish(),
  randomRules: randomRulesBody.nullish(),
  collectionMode: zEnum(COLLECTION_MODES).nullish().transform((v) => v ?? "ManualTracking"),
}).transform((b) => ({
  name: b.name,
  description: b.description as string,
  rules: {
    groupType: b.groupType, groupValue: b.groupValue ?? new Decimal(0), memberLimit: b.memberLimit, organizerParticipates: b.organizerParticipates,
    organizerFirstPayout: b.organizerFirstPayout, contributionDueDay: b.contributionDueDay, selectionDay: b.selectionDay, payoutDay: b.payoutDay, startDate: b.startDate,
    auctionRules: b.auctionRules ?? null,
    randomRules: b.randomRules ? { algorithmVersion: b.randomRules.algorithmVersion ?? "UNASSIGNED", drawTime: b.randomRules.drawTime ?? null, verificationMethod: b.randomRules.verificationMethod ?? "NOT_IMPLEMENTED" } : null,
    collectionMode: b.collectionMode,
  } as GroupConfiguration,
}));

export const reasonBody = z.object({ reason: z.string().nullish().transform((v) => v ?? "") });
export const acceptTermsBody = z.object({ groupRuleVersionId: z.string().nullish(), rulesHash: z.string().nullish() });
