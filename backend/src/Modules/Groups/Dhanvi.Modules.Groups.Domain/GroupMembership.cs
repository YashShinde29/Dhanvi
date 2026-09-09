namespace Dhanvi.Modules.Groups.Domain;

public sealed class GroupMembership
{
    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid GroupId { get; private set; }
    public Guid UserId { get; private set; }
    public int? SlotNumber { get; private set; }
    public MembershipStatus Status { get; private set; } = MembershipStatus.Applied;
    public DateTimeOffset AppliedAt { get; private set; }
    public DateTimeOffset? ApprovedAt { get; private set; }
    public DateTimeOffset? RejectedAt { get; private set; }
    public string? RejectedReason { get; private set; }
    public Guid? TermsVersionId { get; private set; }
    public DateTimeOffset? TermsAcceptedAt { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }
    public bool HasReceivedPayout { get; private set; }
    public int? PayoutCycleNumber { get; private set; }
    public static GroupMembership Apply(Guid groupId, Guid userId, DateTimeOffset now) => new() { GroupId = groupId, UserId = userId, AppliedAt = now, UpdatedAt = now };
    public void Approve(int slot, DateTimeOffset now)
    {
        EnsurePending(); SlotNumber = slot; Status = MembershipStatus.Approved; ApprovedAt = now; UpdatedAt = now;
    }
    public void Reject(string reason, DateTimeOffset now)
    {
        EnsurePending(); GroupRules.Require(!string.IsNullOrWhiteSpace(reason) && reason.Length <= 1000, "REASON_REQUIRED", "Rejection reason is required, maximum 1000 characters.");
        Status = MembershipStatus.Rejected; RejectedReason = reason.Trim(); RejectedAt = now; UpdatedAt = now;
    }
    public GroupTermsAcceptance Accept(GroupRuleVersion version, DateTimeOffset now)
    {
        GroupRules.Require(Status == MembershipStatus.Approved && version.GroupId == GroupId, "MEMBERSHIP_NOT_APPROVED", "Only approved members can accept this group's rules.");
        GroupRules.Require(TermsVersionId != version.Id, "TERMS_ALREADY_ACCEPTED", "You have already accepted these rules.");
        TermsVersionId = version.Id; TermsAcceptedAt = now; UpdatedAt = now;
        return new GroupTermsAcceptance(Id, version.Id, now, version.RulesHash);
    }
    public void Activate(DateTimeOffset now)
    {
        GroupRules.Require(Status == MembershipStatus.Approved && TermsVersionId.HasValue && SlotNumber.HasValue, "MEMBERSHIP_NOT_READY", "Membership must be approved, slotted, and have accepted terms.");
        Status = MembershipStatus.Active; UpdatedAt = now;
    }
    private void EnsurePending() => GroupRules.Require(Status == MembershipStatus.Applied, "APPLICATION_ALREADY_REVIEWED", "Application has already been reviewed.");
}
public sealed class GroupTermsAcceptance(Guid membershipId, Guid groupRuleVersionId, DateTimeOffset acceptedAt, string rulesHash)
{
    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid MembershipId { get; private set; } = membershipId;
    public Guid GroupRuleVersionId { get; private set; } = groupRuleVersionId;
    public DateTimeOffset AcceptedAt { get; private set; } = acceptedAt;
    public string RulesHash { get; private set; } = rulesHash;
}
// Stored with the group transaction so audit events cannot be lost on rollback.
public sealed class GroupAuditEvent(Guid groupId, Guid actorUserId, string action, DateTimeOffset createdAt, Guid? subjectId = null)
{
    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid GroupId { get; private set; } = groupId;
    public Guid ActorUserId { get; private set; } = actorUserId;
    public string Action { get; private set; } = action;
    public Guid? SubjectId { get; private set; } = subjectId;
    public DateTimeOffset CreatedAt { get; private set; } = createdAt;
}
