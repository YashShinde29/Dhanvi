using Dhanvi.SharedKernel.Domain;

namespace Dhanvi.Modules.Organizers.Domain;

public sealed class OrganizerProfile : Entity<Guid>
{
    private OrganizerProfile() : base(Guid.Empty) { }
    private OrganizerProfile(Guid id, Guid userId, OrganizerStatus status, DateTimeOffset now) : base(id) =>
        (UserId, Status, CreatedAt, UpdatedAt) = (userId, status, now, now);

    public Guid UserId { get; private set; }
    public OrganizerStatus Status { get; private set; }
    public DateTimeOffset? ApprovedAt { get; private set; }
    public Guid? ApprovedByUserId { get; private set; }
    public DateTimeOffset? SuspendedAt { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }

    public static OrganizerProfile CreateForApplication(Guid userId, DateTimeOffset now) => new(Guid.NewGuid(), userId, OrganizerStatus.Pending, now);

    public void MarkApplicationPending(DateTimeOffset now)
    {
        Status = OrganizerStatus.Pending;
        UpdatedAt = now;
    }

    public void Approve(Guid reviewerId, DateTimeOffset now)
    {
        Status = OrganizerStatus.Approved;
        ApprovedAt = now;
        ApprovedByUserId = reviewerId;
        SuspendedAt = null;
        UpdatedAt = now;
    }

    public void Reject(DateTimeOffset now)
    {
        Status = OrganizerStatus.Rejected;
        UpdatedAt = now;
    }

    public void Suspend(DateTimeOffset now)
    {
        Status = OrganizerStatus.Suspended;
        SuspendedAt = now;
        UpdatedAt = now;
    }
}

