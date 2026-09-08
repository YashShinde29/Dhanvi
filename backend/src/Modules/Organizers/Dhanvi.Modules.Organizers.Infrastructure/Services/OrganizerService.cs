using Dhanvi.Modules.Audit.Application;
using Dhanvi.Modules.Audit.Domain;
using Dhanvi.Modules.Audit.Infrastructure.Persistence;
using Dhanvi.Modules.Identity.Domain.Roles;
using Dhanvi.Modules.Identity.Domain.Users;
using Dhanvi.Modules.Identity.Infrastructure.Persistence;
using Dhanvi.Modules.Organizers.Application;
using Dhanvi.Modules.Organizers.Domain;
using Dhanvi.Modules.Organizers.Infrastructure.Persistence;
using Dhanvi.SharedKernel.Exceptions;
using Dhanvi.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Dhanvi.Modules.Organizers.Infrastructure.Services;

internal sealed class OrganizerService(
    OrganizerDbContext dbContext,
    IdentityDbContext identityDbContext,
    AuditDbContext auditDbContext,
    IAuditWriter auditWriter,
    IDateTimeProvider clock) : IOrganizerService
{
    public async Task<OrganizerStatusResponse> ApplyAsync(Guid userId, ApplyForOrganizerRequest request, string? correlationId, CancellationToken cancellationToken)
    {
        ValidateApplication(request);
        var userExists = await identityDbContext.Users.AnyAsync(user => user.Id == userId && user.IsActive, cancellationToken);
        if (!userExists) throw new NotFoundException("User was not found.");
        if (await dbContext.OrganizerApplications.AnyAsync(item => item.UserId == userId &&
            (item.Status == OrganizerStatus.Pending || item.Status == OrganizerStatus.UnderReview), cancellationToken))
            throw new ConflictException("An active organizer application already exists.");

        var now = clock.UtcNow;
        var application = OrganizerApplication.Submit(userId, request.FullLegalName, request.Phone, request.Address, request.City,
            request.State, request.PostalCode, request.ReasonForBecomingOrganizer, request.ExperienceDescription, now);
        var profile = await dbContext.OrganizerProfiles.SingleOrDefaultAsync(item => item.UserId == userId, cancellationToken);
        if (profile is null)
        {
            profile = OrganizerProfile.CreateForApplication(userId, now);
            dbContext.OrganizerProfiles.Add(profile);
        }
        else
        {
            profile.MarkApplicationPending(now);
        }

        await using var transaction = await BeginTransactionAsync(includeIdentity: false, cancellationToken);
        dbContext.OrganizerApplications.Add(application);
        auditWriter.Add(userId, AuditActions.OrganizerApplicationSubmitted, nameof(OrganizerApplication), application.Id.ToString(), now, correlationId);
        await dbContext.SaveChangesAsync(cancellationToken);
        await auditWriter.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return MapStatus(profile, application);
    }

    public async Task<OrganizerStatusResponse> GetMyStatusAsync(Guid userId, CancellationToken cancellationToken)
    {
        var profile = await dbContext.OrganizerProfiles.SingleOrDefaultAsync(item => item.UserId == userId, cancellationToken);
        if (profile is null) return new OrganizerStatusResponse("NOT_APPLIED", null);
        var application = await dbContext.OrganizerApplications.Where(item => item.UserId == userId)
            .OrderByDescending(item => item.SubmittedAt).FirstOrDefaultAsync(cancellationToken);
        return MapStatus(profile, application);
    }

    public async Task<PagedResponse<OrganizerApplicationSummary>> GetApplicationsAsync(int page, int pageSize, string? status, string? search, CancellationToken cancellationToken)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);
        var query = dbContext.OrganizerApplications.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(status) && Enum.TryParse<OrganizerStatus>(status.Replace("_", string.Empty), true, out var parsedStatus))
            query = query.Where(item => item.Status == parsedStatus);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search.Trim()}%";
            var matchingUsers = await identityDbContext.Users.Where(user => EF.Functions.ILike(user.Email, pattern) ||
                EF.Functions.ILike(user.FirstName + " " + user.LastName, pattern)).Select(user => user.Id).ToListAsync(cancellationToken);
            query = query.Where(item => matchingUsers.Contains(item.UserId));
        }

        var total = await query.CountAsync(cancellationToken);
        var applications = await query.OrderByDescending(item => item.SubmittedAt).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(cancellationToken);
        var userIds = applications.Select(item => item.UserId).Distinct().ToArray();
        var users = await identityDbContext.Users.Where(user => userIds.Contains(user.Id)).ToDictionaryAsync(user => user.Id, cancellationToken);
        var items = applications.Select(item =>
        {
            var user = users[item.UserId];
            return new OrganizerApplicationSummary(item.Id, item.UserId, $"{user.FirstName} {user.LastName}", user.Email,
                item.Phone ?? user.PhoneNumber, item.SubmittedAt, StatusName(item.Status));
        }).ToArray();
        return new PagedResponse<OrganizerApplicationSummary>(items, page, pageSize, total);
    }

    public async Task ApproveAsync(Guid applicationId, Guid reviewerId, string? correlationId, CancellationToken cancellationToken)
    {
        var application = await dbContext.OrganizerApplications.SingleOrDefaultAsync(item => item.Id == applicationId, cancellationToken)
            ?? throw new NotFoundException("Organizer application was not found.");
        var profile = await dbContext.OrganizerProfiles.SingleAsync(item => item.UserId == application.UserId, cancellationToken);
        var user = await identityDbContext.Users.Include(item => item.UserRoles).ThenInclude(item => item.Role)
            .SingleAsync(item => item.Id == application.UserId, cancellationToken);
        var organizerRole = await identityDbContext.Roles.SingleAsync(item => item.Name == RoleNames.Organizer, cancellationToken);
        var now = clock.UtcNow;

        await using var transaction = await BeginTransactionAsync(includeIdentity: true, cancellationToken);
        application.Approve(reviewerId, now);
        profile.Approve(reviewerId, now);
        var alreadyOrganizer = user.UserRoles.Any(item => item.RoleId == organizerRole.Id);
        user.AssignRole(organizerRole, now);
        auditWriter.Add(reviewerId, AuditActions.OrganizerApplicationApproved, nameof(OrganizerApplication), application.Id.ToString(), now, correlationId);
        if (!alreadyOrganizer) auditWriter.Add(reviewerId, AuditActions.UserRoleAssigned, nameof(User), user.Id.ToString(), now, correlationId);
        await SaveAllAsync(includeIdentity: true, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task RejectAsync(Guid applicationId, Guid reviewerId, string reason, string? correlationId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(reason))
            throw new RequestValidationException(new Dictionary<string, string[]> { ["reason"] = ["Rejection reason is required."] });
        var application = await dbContext.OrganizerApplications.SingleOrDefaultAsync(item => item.Id == applicationId, cancellationToken)
            ?? throw new NotFoundException("Organizer application was not found.");
        var profile = await dbContext.OrganizerProfiles.SingleAsync(item => item.UserId == application.UserId, cancellationToken);
        var now = clock.UtcNow;

        await using var transaction = await BeginTransactionAsync(includeIdentity: false, cancellationToken);
        application.Reject(reviewerId, reason, now);
        profile.Reject(now);
        auditWriter.Add(reviewerId, AuditActions.OrganizerApplicationRejected, nameof(OrganizerApplication), application.Id.ToString(), now, correlationId);
        await SaveAllAsync(includeIdentity: false, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task SuspendAsync(Guid userId, Guid reviewerId, string? correlationId, CancellationToken cancellationToken)
    {
        var profile = await dbContext.OrganizerProfiles.SingleOrDefaultAsync(item => item.UserId == userId, cancellationToken)
            ?? throw new NotFoundException("Organizer profile was not found.");
        var now = clock.UtcNow;
        await using var transaction = await BeginTransactionAsync(includeIdentity: false, cancellationToken);
        profile.Suspend(now);
        auditWriter.Add(reviewerId, AuditActions.OrganizerSuspended, nameof(OrganizerProfile), profile.Id.ToString(), now, correlationId);
        await SaveAllAsync(includeIdentity: false, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public static string StatusName(OrganizerStatus status) => status == OrganizerStatus.UnderReview ? "UNDER_REVIEW" : status.ToString().ToUpperInvariant();

    private async Task<IDbContextTransaction> BeginTransactionAsync(bool includeIdentity, CancellationToken cancellationToken)
    {
        var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        if (includeIdentity) await identityDbContext.Database.UseTransactionAsync(transaction.GetDbTransaction(), cancellationToken);
        await auditDbContext.Database.UseTransactionAsync(transaction.GetDbTransaction(), cancellationToken);
        return transaction;
    }

    private async Task SaveAllAsync(bool includeIdentity, CancellationToken cancellationToken)
    {
        await dbContext.SaveChangesAsync(cancellationToken);
        if (includeIdentity) await identityDbContext.SaveChangesAsync(cancellationToken);
        await auditWriter.SaveChangesAsync(cancellationToken);
    }

    private static OrganizerStatusResponse MapStatus(OrganizerProfile profile, OrganizerApplication? application) =>
        new(StatusName(profile.Status), application is null ? null : new OrganizerApplicationDetails(application.Id, application.SubmittedAt,
            application.ReviewedAt, application.RejectionReason, application.Address, application.City, application.State, application.PostalCode,
            application.ReasonForBecomingOrganizer, application.ExperienceDescription));

    private static void ValidateApplication(ApplyForOrganizerRequest request)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(request.Address)) errors["address"] = ["Address is required."];
        if (string.IsNullOrWhiteSpace(request.City)) errors["city"] = ["City is required."];
        if (string.IsNullOrWhiteSpace(request.State)) errors["state"] = ["State is required."];
        if (string.IsNullOrWhiteSpace(request.PostalCode)) errors["postalCode"] = ["Postal code is required."];
        if (string.IsNullOrWhiteSpace(request.ReasonForBecomingOrganizer)) errors["reasonForBecomingOrganizer"] = ["A reason is required."];
        if (errors.Count > 0) throw new RequestValidationException(errors);
    }
}
