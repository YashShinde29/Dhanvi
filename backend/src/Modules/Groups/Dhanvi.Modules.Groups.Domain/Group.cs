using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Dhanvi.SharedKernel.Exceptions;
using Dhanvi.SharedKernel.Time;

namespace Dhanvi.Modules.Groups.Domain;

public enum GroupType { Random, Auction }
public enum GroupCreatorType { Platform, Organizer }
public enum GroupStatus { Draft, Published, Recruiting, FullySubscribed, ReadyToStart, Active, Completing, Completed, Suspended, Cancelled }
public enum MembershipStatus { Applied, Approved, Active, Rejected, Withdrawn, Removed, Completed }
public enum SelectionMethod { OrganizerReserved, Random, Auction }
public enum AuctionFeePolicy { WinnerMemberShare }
public sealed record AuctionGroupRules(decimal MinimumDiscount, decimal MaximumDiscount, decimal BidIncrement, TimeOnly AuctionStartTime, TimeOnly AuctionEndTime, AuctionFeePolicy FeePolicy = AuctionFeePolicy.WinnerMemberShare);
public sealed record RandomGroupRules(string AlgorithmVersion = "UNASSIGNED", TimeOnly? DrawTime = null, string VerificationMethod = "NOT_IMPLEMENTED");
public sealed record GroupConfiguration(GroupType GroupType, decimal GroupValue, int MemberLimit, bool OrganizerParticipates,
    bool OrganizerFirstPayout, int ContributionDueDay, int SelectionDay, int PayoutDay, DateOnly StartDate,
    AuctionGroupRules? AuctionRules = null, RandomGroupRules? RandomRules = null);

public static class GroupRules
{
    public const int MinimumMembers = 20;
    public const int MaximumMembers = 50;
    public static decimal Contribution(decimal value, int members)
    {
        Require(members is >= MinimumMembers and <= MaximumMembers, "INVALID_MEMBER_LIMIT", "Member limit must be between 20 and 50.");
        Require(value > 0 && value <= 9999999999999999.99m && decimal.Round(value, 2) == value, "INVALID_GROUP_AMOUNT", "Group value must be positive with at most two decimal places.");
        Require(value * 100 % members == 0, "INVALID_CONTRIBUTION_PRECISION", "Group value divided by members must be exact to two decimal places.");
        return value / members;
    }
    public static void Require(bool condition, string code, string message)
    {
        if (!condition) throw new GroupBusinessException(code, message);
    }
    public static void Validate(GroupConfiguration rules, GroupCreatorType creatorType, DateOnly today)
    {
        Contribution(rules.GroupValue, rules.MemberLimit);
        Require(Enum.IsDefined(rules.GroupType), "INVALID_GROUP_TYPE", "Select Random or Auction.");
        Require(!rules.OrganizerFirstPayout || rules.OrganizerParticipates, "ORGANIZER_FIRST_PAYOUT_REQUIRES_MEMBERSHIP", "Organizer first payout requires participation.");
        Require(creatorType != GroupCreatorType.Platform || (!rules.OrganizerParticipates && !rules.OrganizerFirstPayout), "INVALID_PLATFORM_RULES", "Platform groups cannot use organizer participation rules.");
        Require(rules.StartDate > today, "INVALID_START_DATE", "Start date must be in the future.");
        Require(rules.ContributionDueDay >= 1 && rules.PayoutDay <= 28 && rules.ContributionDueDay <= rules.SelectionDay && rules.SelectionDay <= rules.PayoutDay,
            "INVALID_SCHEDULE", "Days must be between 1 and 28, in contribution, selection, payout order.");
        Require(rules.GroupType != GroupType.Random || rules.AuctionRules is null, "INVALID_AUCTION_RULES", "Random groups cannot have auction rules.");
        Require(rules.GroupType != GroupType.Auction || rules.RandomRules is null, "INVALID_RANDOM_RULES", "Auction groups cannot have random rules.");
        if (rules.AuctionRules is { } a)
        {
            Require(a.MinimumDiscount >= 0 && a.MaximumDiscount >= a.MinimumDiscount && a.MaximumDiscount < rules.GroupValue && a.BidIncrement > 0 && a.BidIncrement <= rules.GroupValue &&
                decimal.Round(a.MinimumDiscount, 2) == a.MinimumDiscount && decimal.Round(a.MaximumDiscount, 2) == a.MaximumDiscount && decimal.Round(a.BidIncrement, 2) == a.BidIncrement && a.AuctionStartTime < a.AuctionEndTime,
                "INVALID_AUCTION_RULES", "Discounts and increment must be valid currency amounts; auction end must follow start.");
            Require(a.FeePolicy == AuctionFeePolicy.WinnerMemberShare, "UNSUPPORTED_AUCTION_FEE_POLICY", "Only the proposed winner member share fee policy is supported.");
            Require(a.MaximumDiscount > 0 && a.MinimumDiscount * 100 % rules.MemberLimit == 0 && a.MaximumDiscount * 100 % rules.MemberLimit == 0 && a.BidIncrement * 100 % rules.MemberLimit == 0, "INVALID_AUCTION_ALLOCATION_PRECISION", "Auction limits and increment must divide into exact paise shares for every member position.");
        }
    }
}
public sealed class GroupBusinessException(string code, string message) : DhanviException(message)
{
    public string Code { get; } = code;
}

public sealed class Group
{
    private Group() { }
    public Guid Id { get; private set; } = Guid.NewGuid();
    public string Name { get; private set; } = "";
    public string Description { get; private set; } = "";
    public GroupCreatorType CreatorType { get; private set; }
    public Guid CreatedByUserId { get; private set; }
    public GroupConfiguration Rules { get; private set; } = null!;
    public GroupType GroupType { get; private set; }
    public decimal GroupValue { get; private set; }
    public int MemberLimit { get; private set; }
    public decimal MonthlyContribution { get; private set; }
    public int DurationMonths { get; private set; }
    public GroupStatus Status { get; private set; } = GroupStatus.Draft;
    public int CurrentMemberCount { get; private set; }
    public bool RulesLocked { get; private set; }
    public int RulesVersion { get; private set; }
    public int Version { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }
    public DateTimeOffset? PublishedAt { get; private set; }
    public string GroupTimeZone { get; private set; } = BusinessCalendar.DefaultTimeZone;
    public DateTimeOffset? ActivatedAt { get; private set; }
    public int? CurrentCycleNumber { get; private set; }
    public string? StatusReason { get; private set; }
    public SelectionMethod FirstCycleSelectionMethod => Rules.OrganizerFirstPayout ? SelectionMethod.OrganizerReserved : Rules.GroupType == GroupType.Random ? SelectionMethod.Random : SelectionMethod.Auction;
    public static Group Create(string name, string description, GroupCreatorType creator, Guid userId, GroupConfiguration rules, bool organizerApproved, DateTimeOffset now)
    {
        GroupRules.Require(creator != GroupCreatorType.Organizer || organizerApproved, "ORGANIZER_NOT_APPROVED", "Only approved organizers may create groups.");
        var group = new Group { CreatorType = creator, CreatedByUserId = userId, CreatedAt = now };
        group.Update(name, description, rules, now);
        if (rules.OrganizerParticipates) { group.CurrentMemberCount = 1; group.RulesLocked = true; }
        return group;
    }
    public void Update(string name, string description, GroupConfiguration rules, DateTimeOffset now)
    {
        GroupRules.Require(Status == GroupStatus.Draft, "GROUP_NOT_EDITABLE", "Only drafts may be edited; published rules are immutable.");
        GroupRules.Require(!RulesLocked || Rules == rules, "GROUP_RULES_LOCKED", "Rules are locked after approval or terms acceptance.");
        GroupRules.Require(!string.IsNullOrWhiteSpace(name) && name.Length <= 200 && description is not null && description.Length <= 4000, "INVALID_GROUP_NAME", "Name is required (maximum 200 characters); description maximum is 4000.");
        GroupRules.Validate(rules, CreatorType, BusinessCalendar.Today(now, GroupTimeZone));
        Name = name.Trim(); Description = description!.Trim(); Rules = rules; GroupType = rules.GroupType; GroupValue = rules.GroupValue; MemberLimit = rules.MemberLimit;
        MonthlyContribution = GroupRules.Contribution(rules.GroupValue, rules.MemberLimit); DurationMonths = rules.MemberLimit; Touch(now);
    }
    public GroupRuleVersion Publish(bool organizerApproved, DateTimeOffset now)
    {
        GroupRules.Require(Status == GroupStatus.Draft, "INVALID_GROUP_TRANSITION", "Only drafts may be published.");
        CheckOrganizer(organizerApproved);
        GroupRules.Validate(Rules, CreatorType, BusinessCalendar.Today(now, GroupTimeZone));
        RulesVersion++; PublishedAt = now; Status = GroupStatus.Recruiting; Touch(now);
        return GroupRuleVersion.Create(this, now);
    }
    public void EnsureJoinable()
    {
        GroupRules.Require(Status == GroupStatus.Recruiting, "GROUP_NOT_JOINABLE", "Group is not recruiting.");
        GroupRules.Require(CurrentMemberCount < Rules.MemberLimit, "GROUP_FULL", "Group has no available positions.");
    }
    public int ApproveMember(DateTimeOffset now)
    {
        EnsureJoinable(); CurrentMemberCount++; RulesLocked = true;
        if (CurrentMemberCount == Rules.MemberLimit) Status = GroupStatus.FullySubscribed;
        Touch(now); return CurrentMemberCount;
    }
    public void LockRules(DateTimeOffset now) { RulesLocked = true; Touch(now); }
    public void ConfirmReady(bool allAccepted, int approvedCount, bool organizerApproved, DateTimeOffset now)
    {
        GroupRules.Require(Status == GroupStatus.FullySubscribed && CurrentMemberCount == Rules.MemberLimit && approvedCount == Rules.MemberLimit, "GROUP_NOT_FULLY_SUBSCRIBED", "Every position must be approved before readiness.");
        GroupRules.Require(allAccepted, "CURRENT_RULE_VERSION_REQUIRED", "Every approved member must accept the current rules.");
        GroupRules.Require(Rules.StartDate > BusinessCalendar.Today(now, GroupTimeZone), "INVALID_START_DATE", "Start date must be in the future.");
        CheckOrganizer(organizerApproved); Status = GroupStatus.ReadyToStart; Touch(now);
    }
    public void Activate(int approvedCount, bool allAccepted, bool organizerApproved, bool hasCycles, DateTimeOffset now)
    {
        GroupRules.Require(Status == GroupStatus.ReadyToStart, "GROUP_NOT_READY", "Only a ready-to-start group can activate.");
        GroupRules.Require(!hasCycles, "GROUP_ALREADY_HAS_CYCLES", "This group already has a cycle schedule.");
        GroupRules.Require(approvedCount == MemberLimit && CurrentMemberCount == MemberLimit, "GROUP_NOT_FULLY_SUBSCRIBED", "Activation requires exactly the configured approved members.");
        GroupRules.Require(allAccepted, "CURRENT_RULE_VERSION_REQUIRED", "Every member must have accepted the current published rules.");
        CheckOrganizer(organizerApproved);
        GroupRules.Require(Rules.StartDate >= BusinessCalendar.Today(now, GroupTimeZone), "INVALID_START_DATE", "Start date must be today or in the future in the group timezone.");
        GroupRules.Require(DurationMonths == MemberLimit && GroupValue == Rules.GroupValue && MemberLimit == Rules.MemberLimit && GroupType == Rules.GroupType &&
            MonthlyContribution == GroupRules.Contribution(GroupValue, MemberLimit) && MonthlyContribution * MemberLimit == GroupValue,
            "INVALID_EXPECTED_POOL", "Duration and expected contributions must exactly match the group's accepted rules.");
        Status = GroupStatus.Active; ActivatedAt = now; CurrentCycleNumber = 1; RulesLocked = true; Touch(now);
    }
    public void EnsureMemberRemovalAllowed() => GroupRules.Require(ActivatedAt is null, "ACTIVE_MEMBERSHIP_LOCKED", "Members cannot be removed after group activation.");
    public void Stop(bool cancel, string reason, DateTimeOffset now)
    {
        GroupRules.Require(Status is GroupStatus.Draft or GroupStatus.Recruiting or GroupStatus.FullySubscribed or GroupStatus.ReadyToStart || (!cancel && Status == GroupStatus.Active) || (cancel && Status == GroupStatus.Suspended && ActivatedAt is null), "INVALID_GROUP_TRANSITION", "This group cannot be suspended or cancelled.");
        GroupRules.Require(!string.IsNullOrWhiteSpace(reason) && reason.Length <= 1000, "REASON_REQUIRED", "A reason of at most 1000 characters is required.");
        StatusReason = reason.Trim(); Status = cancel ? GroupStatus.Cancelled : GroupStatus.Suspended; Touch(now);
    }
    private void CheckOrganizer(bool approved) => GroupRules.Require(CreatorType != GroupCreatorType.Organizer || approved, "ORGANIZER_NOT_APPROVED", "Organizer must still be approved.");
    private void Touch(DateTimeOffset now) { UpdatedAt = now; Version++; }
}

public sealed class GroupRuleVersion
{
    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid GroupId { get; private set; }
    public int VersionNumber { get; private set; }
    public string RulesSnapshot { get; private set; } = "";
    public string RulesHash { get; private set; } = "";
    public DateTimeOffset CreatedAt { get; private set; }
    public Guid CreatedByUserId { get; private set; }
    public static GroupRuleVersion Create(Group group, DateTimeOffset now)
    {
        var snapshot = JsonSerializer.Serialize(new { group.CreatorType, group.CreatedByUserId, group.Rules, group.MonthlyContribution, group.DurationMonths, group.FirstCycleSelectionMethod, group.GroupTimeZone,
            Terms = "Each member receives the main payout once and must continue contributing for the remaining cycles. Organizer-reserved cycle pays the full group value with zero discount. No money is collected by this implementation." });
        return new() { GroupId = group.Id, VersionNumber = group.RulesVersion, RulesSnapshot = snapshot, RulesHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(snapshot))), CreatedAt = now, CreatedByUserId = group.CreatedByUserId };
    }
}
