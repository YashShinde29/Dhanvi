namespace Dhanvi.Modules.Organizers.Application;

public sealed record ApplyForOrganizerRequest(
    string? FullLegalName,
    string? Phone,
    string Address,
    string City,
    string State,
    string PostalCode,
    string ReasonForBecomingOrganizer,
    string? ExperienceDescription);

public sealed record RejectOrganizerApplicationRequest(string Reason);

public sealed record OrganizerApplicationSummary(
    Guid Id,
    Guid UserId,
    string Applicant,
    string Email,
    string? Phone,
    DateTimeOffset SubmittedAt,
    string Status);

public sealed record OrganizerApplicationDetails(
    Guid Id,
    DateTimeOffset SubmittedAt,
    DateTimeOffset? ReviewedAt,
    string? RejectionReason,
    string Address,
    string City,
    string State,
    string PostalCode,
    string ReasonForBecomingOrganizer,
    string? ExperienceDescription);

public sealed record OrganizerStatusResponse(string Status, OrganizerApplicationDetails? Application);
public sealed record PagedResponse<T>(IReadOnlyCollection<T> Items, int Page, int PageSize, int TotalCount);

