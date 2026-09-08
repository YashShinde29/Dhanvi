using Dhanvi.SharedKernel.Domain;
using Dhanvi.SharedKernel.Exceptions;

namespace Dhanvi.Modules.Organizers.Domain;

public sealed class OrganizerApplication : Entity<Guid>
{
    private OrganizerApplication() : base(Guid.Empty) { }

    private OrganizerApplication(Guid id, Guid userId, string? fullLegalName, string? phone, string address, string city, string state,
        string postalCode, string reason, string? experience, DateTimeOffset submittedAt) : base(id)
    {
        UserId = userId;
        FullLegalName = fullLegalName;
        Phone = phone;
        Address = address;
        City = city;
        State = state;
        PostalCode = postalCode;
        ReasonForBecomingOrganizer = reason;
        ExperienceDescription = experience;
        Status = OrganizerStatus.Pending;
        SubmittedAt = submittedAt;
    }

    public Guid UserId { get; private set; }
    public OrganizerStatus Status { get; private set; }
    public string? FullLegalName { get; private set; }
    public string? Phone { get; private set; }
    public string Address { get; private set; } = string.Empty;
    public string City { get; private set; } = string.Empty;
    public string State { get; private set; } = string.Empty;
    public string PostalCode { get; private set; } = string.Empty;
    public string ReasonForBecomingOrganizer { get; private set; } = string.Empty;
    public string? ExperienceDescription { get; private set; }
    public DateTimeOffset SubmittedAt { get; private set; }
    public DateTimeOffset? ReviewedAt { get; private set; }
    public Guid? ReviewedByUserId { get; private set; }
    public string? RejectionReason { get; private set; }

    public bool IsActive => Status is OrganizerStatus.Pending or OrganizerStatus.UnderReview;

    public static OrganizerApplication Submit(Guid userId, string? fullLegalName, string? phone, string address, string city, string state,
        string postalCode, string reason, string? experience, DateTimeOffset now) =>
        new(Guid.NewGuid(), userId, Clean(fullLegalName), Clean(phone), address.Trim(), city.Trim(), state.Trim(), postalCode.Trim(), reason.Trim(), Clean(experience), now);

    public void Approve(Guid reviewerId, DateTimeOffset now)
    {
        EnsureReviewable();
        Status = OrganizerStatus.Approved;
        ReviewedByUserId = reviewerId;
        ReviewedAt = now;
        RejectionReason = null;
    }

    public void Reject(Guid reviewerId, string reason, DateTimeOffset now)
    {
        EnsureReviewable();
        Status = OrganizerStatus.Rejected;
        ReviewedByUserId = reviewerId;
        ReviewedAt = now;
        RejectionReason = reason.Trim();
    }

    private void EnsureReviewable()
    {
        if (!IsActive) throw new ConflictException("Only pending or under-review applications can be reviewed.");
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

