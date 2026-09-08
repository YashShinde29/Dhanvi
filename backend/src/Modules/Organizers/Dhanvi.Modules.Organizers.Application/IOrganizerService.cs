namespace Dhanvi.Modules.Organizers.Application;

public interface IOrganizerService
{
    Task<OrganizerStatusResponse> ApplyAsync(Guid userId, ApplyForOrganizerRequest request, string? correlationId, CancellationToken cancellationToken);
    Task<OrganizerStatusResponse> GetMyStatusAsync(Guid userId, CancellationToken cancellationToken);
    Task<PagedResponse<OrganizerApplicationSummary>> GetApplicationsAsync(int page, int pageSize, string? status, string? search, CancellationToken cancellationToken);
    Task ApproveAsync(Guid applicationId, Guid reviewerId, string? correlationId, CancellationToken cancellationToken);
    Task RejectAsync(Guid applicationId, Guid reviewerId, string reason, string? correlationId, CancellationToken cancellationToken);
    Task SuspendAsync(Guid userId, Guid reviewerId, string? correlationId, CancellationToken cancellationToken);
}

