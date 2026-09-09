using Dhanvi.Modules.Cycles.Domain;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.RandomDraws.Domain;
using Dhanvi.SharedKernel.Exceptions;
namespace Dhanvi.Modules.RandomDraws.Application;

public static class SelectionPolicy
{
    public static void AuthorizeOperator(SelectionContext state, SelectionActor actor)
    {
        GroupRules.Require(state.ActorActive && (state.Group.CreatorType == GroupCreatorType.Platform ? actor.IsAdmin : state.Group.CreatedByUserId == actor.UserId),
            "NOT_AUTHORIZED_TO_EXECUTE_SELECTION", "Only the owning approved organizer or platform administrator can execute selection.");
        GroupRules.Require(state.Group.CreatorType != GroupCreatorType.Organizer || state.OrganizerApproved, "ORGANIZER_NOT_APPROVED", "Organizer must still be approved.");
        BusinessRuleException.Require(state.Group.Status != GroupStatus.Suspended, "GROUP_SUSPENDED", "Selection is blocked while the group is suspended.");
        BusinessRuleException.Require(state.Group.Status == GroupStatus.Active, "GROUP_NOT_ACTIVE", "Only active groups can execute selection.");
    }
    public static void AuthorizeReader(SelectionContext state, SelectionActor actor) => GroupRules.Require(state.ActorActive && (actor.IsAdmin ||
        state.Group.CreatorType == GroupCreatorType.Organizer && state.Group.CreatedByUserId == actor.UserId ||
        state.Participants.Any(p => p.Membership.UserId == actor.UserId && p.Membership.Status is MembershipStatus.Active or MembershipStatus.Approved or MembershipStatus.Completed)),
        "MEMBERSHIP_REQUIRED", "Selection results are available only to group members, the organizer, and administrators.");
    public static IReadOnlyList<SelectionParticipant> Eligible(SelectionContext state)
    {
        var contributions = state.Contributions.Where(c => c.GroupId == state.Group.Id && c.CycleId == state.Cycle.Id && c.RecordedAmount == c.ExpectedAmount).Select(c => c.MembershipId).ToHashSet();
        return state.Participants.Where(p => p.UserActive && p.Membership.GroupId == state.Group.Id && p.Membership.Status == MembershipStatus.Active && !p.Membership.HasBeenSelectedForPayout &&
            p.Membership.SlotNumber is >= 1 && p.Membership.SlotNumber <= state.Group.MemberLimit && contributions.Contains(p.Membership.Id)).OrderBy(p => p.Membership.SlotNumber).ToArray();
    }
    public static void RequireReady(SelectionContext state)
    {
        BusinessRuleException.Require(state.Cycle.SelectionMethod != SelectionMethod.Auction, "AUCTION_SELECTION_NOT_SUPPORTED_HERE", "Use the auction endpoints for auction selection.");
        BusinessRuleException.Require(state.Cycle.SelectionMethod is SelectionMethod.Random or SelectionMethod.OrganizerReserved, "SELECTION_METHOD_NOT_SUPPORTED", "This selection method is unsupported.");
        RequireContributionsReady(state);
    }
    public static void RequireContributionsReady(SelectionContext state)
    {
        BusinessRuleException.Require(state.Cycle.Status == CycleStatus.ReadyForSelection && state.Cycle.CycleNumber == state.Group.CurrentCycleNumber && !state.Cycle.SelectionResultId.HasValue,
            "CYCLE_NOT_READY_FOR_SELECTION", "The current cycle must be ready for selection.");
        var c = state.Cycle; var obligations = state.Contributions;
        BusinessRuleException.Require(c.ExpectedMemberCount == state.Group.MemberLimit && c.ExpectedContributionPerMember == state.Group.MonthlyContribution && c.ExpectedPoolAmount == state.Group.GroupValue &&
            c.FullyRecordedMemberCount == c.ExpectedMemberCount && c.RecordedContributionAmount == c.ExpectedPoolAmount && obligations.Count == c.ExpectedMemberCount &&
            obligations.Select(o => o.MembershipId).Distinct().Count() == c.ExpectedMemberCount && obligations.All(o => o.GroupId == state.Group.Id && o.CycleId == c.Id && o.ExpectedAmount == c.ExpectedContributionPerMember && o.RecordedAmount == o.ExpectedAmount) && obligations.Sum(o => o.RecordedAmount) == c.ExpectedPoolAmount,
            "CYCLE_NOT_READY_FOR_SELECTION", "Every expected contribution and the cycle totals must still be fully recorded.");
    }
    public static SelectionParticipant ReservedOrganizer(SelectionContext state)
    {
        BusinessRuleException.Require(state.Group.CreatorType == GroupCreatorType.Organizer && state.Group.Rules.OrganizerFirstPayout && state.Group.Rules.OrganizerParticipates && state.Cycle.CycleNumber == 1,
            "INVALID_ORGANIZER_RESERVED_CYCLE", "Published organizer reservation is required and applies only to cycle 1.");
        var organizer = state.Participants.SingleOrDefault(p => p.Membership.UserId == state.Group.CreatedByUserId && p.Membership.GroupId == state.Group.Id)
            ?? throw new BusinessRuleException("ORGANIZER_MEMBERSHIP_NOT_FOUND", "The participating organizer membership was not found.");
        BusinessRuleException.Require(!organizer.Membership.HasBeenSelectedForPayout, "ORGANIZER_ALREADY_SELECTED", "The organizer already owns a payout right.");
        BusinessRuleException.Require(Eligible(state).Any(p => p.Membership.Id == organizer.Membership.Id), "ORGANIZER_MEMBERSHIP_NOT_ELIGIBLE", "Organizer membership must be active, valid, and fully recorded.");
        return organizer;
    }
}
