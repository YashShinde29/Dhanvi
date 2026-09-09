using Dhanvi.Modules.Contributions.Domain;
using Dhanvi.Modules.Cycles.Domain;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.RandomDraws.Domain;
namespace Dhanvi.Modules.RandomDraws.Application;

public sealed record SelectionActor(Guid UserId, bool IsAdmin);
public sealed record SelectionParticipant(GroupMembership Membership, bool UserActive, string DisplayName);
public sealed record SelectionContext(Group Group, MonthlyCycle Cycle, IReadOnlyList<SelectionParticipant> Participants,
    IReadOnlyList<Contribution> Contributions, bool OrganizerApproved, bool ActorActive, SelectionResult? ExistingResult);
public sealed record SelectionMutation(SelectionResult Result, bool Created, IReadOnlyList<GroupAuditEvent> AuditEvents);
public interface ISelectionStore
{
    Task<SelectionContext> ReadAsync(Guid groupId, Guid cycleId, Guid actorId, CancellationToken ct);
    Task<SelectionContext> ExecuteLockedAsync(Guid groupId, Guid cycleId, Guid actorId, Func<SelectionContext, SelectionMutation> execute, CancellationToken ct);
    Task AddVerificationAuditAsync(GroupAuditEvent auditEvent, CancellationToken ct);
}
public interface ISecureRandomSource
{
    string SourceType { get; }
    byte[] CreateSeed();
}
public sealed record SelectionWinner(Guid MembershipId, int SlotNumber, string DisplayName);
public sealed record SelectionDetails(Guid Id, Guid GroupId, Guid CycleId, int CycleNumber, SelectionMethod SelectionMethod,
    SelectionWinner Winner, int EligibleMemberCount, DateTimeOffset ExecutedAt, string AlgorithmVersion, bool VerificationAvailable);
public sealed record SelectionPreview(int EligibleMemberCount, string AlgorithmVersion, SelectionMethod SelectionMethod);
public sealed record SelectionVerification(Guid SelectionResultId, bool Valid, string? FailureReason, RandomDrawProof Proof);
public interface ISelectionService
{
    Task<SelectionDetails> ExecuteAsync(Guid groupId, Guid cycleId, SelectionActor actor, CancellationToken ct);
    Task<SelectionDetails> GetAsync(Guid groupId, Guid cycleId, SelectionActor actor, CancellationToken ct);
    Task<SelectionPreview> PreviewAsync(Guid groupId, Guid cycleId, SelectionActor actor, CancellationToken ct);
    Task<SelectionVerification> VerifyAsync(Guid groupId, Guid cycleId, SelectionActor actor, CancellationToken ct);
}
