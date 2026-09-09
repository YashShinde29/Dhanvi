using Dhanvi.Modules.Cycles.Domain;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.RandomDraws.Domain;
using Dhanvi.SharedKernel.Exceptions;
using Dhanvi.SharedKernel.Time;
namespace Dhanvi.Modules.RandomDraws.Application;

public sealed class SelectionService(ISelectionStore store, ISecureRandomSource random, IDateTimeProvider clock) : ISelectionService
{
    public async Task<SelectionDetails> ExecuteAsync(Guid groupId, Guid cycleId, SelectionActor actor, CancellationToken ct)
    {
        var state = await store.ExecuteLockedAsync(groupId, cycleId, actor.UserId, current =>
        {
            SelectionPolicy.AuthorizeOperator(current, actor);
            if (current.ExistingResult is { } existing)
            {
                BusinessRuleException.Require(current.Cycle.Status == CycleStatus.SelectionCompleted && current.Cycle.SelectionResultId == existing.Id,
                    "SELECTION_ALREADY_COMPLETED", "The cycle's persisted selection references are inconsistent.");
                return new(existing, false, []);
            }
            SelectionPolicy.RequireReady(current);
            var now = clock.UtcNow; SelectionResult result; SelectionParticipant winner;
            if (current.Cycle.SelectionMethod == SelectionMethod.OrganizerReserved)
            {
                winner = SelectionPolicy.ReservedOrganizer(current);
                result = SelectionResult.Reserved(groupId, cycleId, current.Cycle.CycleNumber, new(winner.Membership.Id, winner.Membership.SlotNumber!.Value), winner.Membership.UserId, actor.UserId, now);
            }
            else
            {
                var eligible = SelectionPolicy.Eligible(current);
                BusinessRuleException.Require(eligible.Count > 0, "NO_ELIGIBLE_MEMBERS", "No eligible membership remains for this draw.");
                // Canonicalize and validate before acquiring entropy. Neither seed nor winner is client input.
                var snapshot = RandomDrawV1.CanonicalMembers(eligible.Select(p => new EligibleMember(p.Membership.Id, p.Membership.SlotNumber!.Value)));
                var proof = RandomDrawV1.Draw(groupId, cycleId, current.Cycle.CycleNumber, snapshot, random.CreateSeed());
                winner = eligible.Single(p => p.Membership.Id == proof.WinnerMembershipId);
                result = SelectionResult.Random(proof, winner.Membership.UserId, actor.UserId, now, random.SourceType);
            }
            winner.Membership.SelectForPayout(current.Cycle.CycleNumber, now); current.Cycle.CompleteSelection(result.Id, now);
            var actions = new[] { result.SelectionMethod == SelectionMethod.Random ? "RANDOM_DRAW_EXECUTED" : "ORGANIZER_RESERVED_SELECTION_EXECUTED", "SELECTION_RESULT_CREATED", "MEMBER_SELECTED_FOR_PAYOUT", "CYCLE_SELECTION_COMPLETED" };
            return new(result, true, actions.Select(action => Audit(result, actor, action, now)).ToArray());
        }, ct);
        return Map(state, state.ExistingResult!);
    }
    public async Task<SelectionDetails> GetAsync(Guid groupId, Guid cycleId, SelectionActor actor, CancellationToken ct)
    {
        var state = await store.ReadAsync(groupId, cycleId, actor.UserId, ct); SelectionPolicy.AuthorizeReader(state, actor);
        return Map(state, state.ExistingResult ?? throw new NotFoundException("Selection has not been completed."));
    }
    public async Task<SelectionPreview> PreviewAsync(Guid groupId, Guid cycleId, SelectionActor actor, CancellationToken ct)
    {
        var state = await store.ReadAsync(groupId, cycleId, actor.UserId, ct); SelectionPolicy.AuthorizeOperator(state, actor); SelectionPolicy.RequireReady(state);
        if (state.Cycle.SelectionMethod == SelectionMethod.OrganizerReserved) { SelectionPolicy.ReservedOrganizer(state); return new(1, "ORGANIZER_RESERVED_V1", SelectionMethod.OrganizerReserved); }
        var count = SelectionPolicy.Eligible(state).Count; BusinessRuleException.Require(count > 0, "NO_ELIGIBLE_MEMBERS", "No eligible members remain."); return new(count, RandomDrawV1.AlgorithmVersion, SelectionMethod.Random);
    }
    public async Task<SelectionVerification> VerifyAsync(Guid groupId, Guid cycleId, SelectionActor actor, CancellationToken ct)
    {
        var state = await store.ReadAsync(groupId, cycleId, actor.UserId, ct); SelectionPolicy.AuthorizeReader(state, actor);
        var result = state.ExistingResult ?? throw new NotFoundException("Selection has not been completed."); var proof = result.Proof(); var verification = RandomDrawVerifier.Verify(proof);
        if (verification.Valid) await store.AddVerificationAuditAsync(Audit(result, actor, "RANDOM_DRAW_VERIFIED", clock.UtcNow), ct);
        return new(result.Id, verification.Valid, verification.FailureReason, proof);
    }
    private static SelectionDetails Map(SelectionContext state, SelectionResult result) => new(result.Id, result.GroupId, result.CycleId, result.CycleNumber, result.SelectionMethod,
        new(result.WinnerMembershipId, result.WinnerSlotNumber, state.Participants.SingleOrDefault(p => p.Membership.Id == result.WinnerMembershipId)?.DisplayName ?? "Unavailable member"), result.EligibleMemberCount, result.ExecutedAt, result.AlgorithmVersion, result.SelectionMethod == SelectionMethod.Random);
    private static GroupAuditEvent Audit(SelectionResult result, SelectionActor actor, string action, DateTimeOffset now) =>
        new(result.GroupId, actor.UserId, action, now, result.Id, result.CycleId, result.Id, result.WinnerMembershipId, result.AlgorithmVersion);
}
