using Dhanvi.Modules.Groups.Application;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.Groups.Infrastructure.Persistence;
using Dhanvi.Modules.Identity.Application.Abstractions;
using Dhanvi.SharedKernel.Exceptions;
using Dhanvi.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;
namespace Dhanvi.Modules.Groups.Infrastructure.Services;

internal sealed class GroupService(GroupsDbContext db, IOrganizerStatusReader organizers, IGroupUserDirectory users, IDateTimeProvider clock) : IGroupService
{
    private static readonly GroupStatus[] PublicStatuses = [GroupStatus.Published, GroupStatus.Recruiting, GroupStatus.FullySubscribed, GroupStatus.ReadyToStart];
    public async Task<GroupDetails> CreateAsync(GroupActor actor, GroupCreatorType creator, SaveGroupRequest request, CancellationToken ct)
    {
        GroupRules.Require(creator != GroupCreatorType.Platform || actor.IsAdmin, "NOT_GROUP_OWNER", "Platform permission is required.");
        await EnsureUser(actor, ct);
        var approved = creator == GroupCreatorType.Organizer && await Approved(actor.UserId, ct);
        var g = Group.Create(request.Name, request.Description, creator, actor.UserId, request.Configuration(), approved, clock.UtcNow);
        db.Groups.Add(g); Audit(g, actor, "GROUP_CREATED");
        if (g.Rules.OrganizerParticipates)
        {
            var member = GroupMembership.Apply(g.Id, actor.UserId, clock.UtcNow); member.Approve(1, clock.UtcNow);
            db.Memberships.Add(member); Audit(g, actor, "ORGANIZER_ADDED_AS_MEMBER");
        }
        await db.SaveChangesAsync(ct); return await Map(g, actor, true, ct);
    }
    public async Task<GroupDetails> UpdateAsync(Guid id, GroupActor actor, SaveGroupRequest request, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var g = await Locked(id, ct); await Manage(g, actor, ct);
        // Participation cannot be introduced by edit: membership creation is atomic with group creation.
        GroupRules.Require(g.Rules.OrganizerParticipates == request.OrganizerParticipates, "GROUP_RULES_LOCKED", "Choose organizer participation when creating the group.");
        g.Update(request.Name, request.Description, request.Configuration(), clock.UtcNow); Audit(g, actor, "GROUP_UPDATED");
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return await Map(g, actor, true, ct);
    }
    public async Task<GroupPage> BrowseAsync(GroupFilter filter, GroupActor? actor, string scope, CancellationToken ct)
    {
        var q = db.Groups.AsNoTracking();
        if (scope == "admin") GroupRules.Require(actor?.IsAdmin == true, "NOT_GROUP_OWNER", "Admin permission required.");
        else if (scope == "organizer")
        {
            GroupRules.Require(actor is not null && await Approved(actor.UserId, ct), "ORGANIZER_NOT_APPROVED", "Approved organizer required.");
            q = q.Where(g => g.CreatorType == GroupCreatorType.Organizer && g.CreatedByUserId == actor!.UserId);
        }
        else if (scope == "mine")
        {
            if (actor is null) throw new UnauthorizedAccessException();
            q = q.Where(g => db.Memberships.Any(m => m.GroupId == g.Id && m.UserId == actor.UserId));
            q = filter.Section switch
            {
                "APPLICATIONS" => q.Where(g => db.Memberships.Any(m => m.GroupId == g.Id && m.UserId == actor.UserId && (m.Status == MembershipStatus.Applied || m.Status == MembershipStatus.Rejected))),
                "UPCOMING" => q.Where(g => (g.Status == GroupStatus.Draft || g.Status == GroupStatus.Recruiting || g.Status == GroupStatus.FullySubscribed) && db.Memberships.Any(m => m.GroupId == g.Id && m.UserId == actor.UserId && m.Status == MembershipStatus.Approved)),
                "READY_TO_START" => q.Where(g => g.Status == GroupStatus.ReadyToStart),
                "ACTIVE" => q.Where(g => g.Status == GroupStatus.Active),
                "COMPLETED" => q.Where(g => g.Status == GroupStatus.Completed),
                _ => q,
            };
        }
        else q = q.Where(g => PublicStatuses.Contains(g.Status));
        if (filter.GroupType.HasValue) q = q.Where(g => g.GroupType == filter.GroupType);
        if (filter.CreatorType.HasValue) q = q.Where(g => g.CreatorType == filter.CreatorType);
        if (filter.Status.HasValue) q = q.Where(g => g.Status == filter.Status);
        if (filter.MinGroupValue.HasValue) q = q.Where(g => g.GroupValue >= filter.MinGroupValue);
        if (filter.MaxGroupValue.HasValue) q = q.Where(g => g.GroupValue <= filter.MaxGroupValue);
        if (filter.MemberLimit.HasValue) q = q.Where(g => g.MemberLimit == filter.MemberLimit);
        if (filter.OrganizerId.HasValue) q = q.Where(g => g.CreatorType == GroupCreatorType.Organizer && g.CreatedByUserId == filter.OrganizerId);
        if (!string.IsNullOrWhiteSpace(filter.Search)) q = q.Where(g => EF.Functions.ILike(g.Name, $"%{filter.Search.Trim()}%"));
        var total = await q.CountAsync(ct); var page = Math.Clamp(filter.Page, 1, 100000); var size = Math.Clamp(filter.PageSize, 1, 100);
        q = filter.Sort switch { "value_asc" => q.OrderBy(g => g.GroupValue).ThenBy(g => g.Id), "value_desc" => q.OrderByDescending(g => g.GroupValue).ThenBy(g => g.Id), _ => q.OrderByDescending(g => g.CreatedAt).ThenBy(g => g.Id) };
        var result = new List<GroupDetails>();
        foreach (var g in await q.Skip((page - 1) * size).Take(size).ToListAsync(ct)) result.Add(await Map(g, actor, scope is "admin" or "organizer", ct));
        return new(result, page, size, total);
    }
    public async Task<GroupDetails> DetailsAsync(Guid id, GroupActor? actor, bool management, CancellationToken ct)
    {
        var g = await db.Groups.AsNoTracking().SingleOrDefaultAsync(g => g.Id == id, ct) ?? throw new NotFoundException("Group not found.");
        var owner = actor is not null && (actor.IsAdmin || g.CreatorType == GroupCreatorType.Organizer && g.CreatedByUserId == actor.UserId);
        if (management && !owner) throw new GroupBusinessException("NOT_GROUP_OWNER", "This group belongs to another creator.");
        if (!PublicStatuses.Contains(g.Status) && !owner && (actor is null || !await db.Memberships.AnyAsync(m => m.GroupId == id && m.UserId == actor.UserId, ct))) throw new NotFoundException("Group not found.");
        return await Map(g, actor, management, ct);
    }
    public async Task ExecuteAsync(Guid id, GroupActor actor, string operation, Guid? membershipId, Guid? termsVersionId, string? rulesHash, string? reason, CancellationToken ct)
    {
        await EnsureUser(actor, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var g = await Locked(id, ct); var now = clock.UtcNow;
        if (operation is not ("apply" or "accept-terms")) await Manage(g, actor, ct, operation is "suspend" or "cancel");
        switch (operation)
        {
            case "publish":
                var version = g.Publish(await Approved(g.CreatedByUserId, ct), now); db.RuleVersions.Add(version);
                Audit(g, actor, "GROUP_PUBLISHED"); Audit(g, actor, "GROUP_RULE_VERSION_CREATED"); break;
            case "apply":
                g.EnsureJoinable();
                GroupRules.Require(!await db.Memberships.AnyAsync(m => m.GroupId == id && m.UserId == actor.UserId, ct), "ALREADY_APPLIED", "You already have an application or membership in this group.");
                db.Memberships.Add(GroupMembership.Apply(id, actor.UserId, now)); Audit(g, actor, "GROUP_APPLICATION_SUBMITTED"); break;
            case "approve":
            case "reject":
                var member = await db.Memberships.SingleOrDefaultAsync(m => m.Id == membershipId && m.GroupId == id, ct) ?? throw new NotFoundException("Application not found.");
                GroupRules.Require(member.Status == MembershipStatus.Applied, "APPLICATION_ALREADY_REVIEWED", "Application already reviewed.");
                if (operation == "approve")
                {
                    member.Approve(g.ApproveMember(now), now); Audit(g, actor, "GROUP_APPLICATION_APPROVED");
                    if (g.Status == GroupStatus.FullySubscribed) Audit(g, actor, "GROUP_FULLY_SUBSCRIBED");
                }
                else
                {
                    GroupRules.Require(g.Status is GroupStatus.Recruiting or GroupStatus.FullySubscribed, "GROUP_NOT_JOINABLE", "Applications cannot be reviewed in this state.");
                    member.Reject(reason ?? "", now); Audit(g, actor, "GROUP_APPLICATION_REJECTED");
                }
                break;
            case "accept-terms":
                GroupRules.Require(g.Status is GroupStatus.Recruiting or GroupStatus.FullySubscribed, "GROUP_NOT_JOINABLE", "Terms cannot be accepted in this state.");
                var current = await db.RuleVersions.SingleAsync(r => r.GroupId == id && r.VersionNumber == g.RulesVersion, ct);
                GroupRules.Require(current.Id == termsVersionId && current.RulesHash == rulesHash, "CURRENT_RULE_VERSION_REQUIRED", "Review and accept the current version and hash.");
                var own = await db.Memberships.SingleOrDefaultAsync(m => m.GroupId == id && m.UserId == actor.UserId, ct) ?? throw new NotFoundException("Membership not found.");
                db.TermsAcceptances.Add(own.Accept(current, now)); g.LockRules(now); Audit(g, actor, "GROUP_TERMS_ACCEPTED"); break;
            case "confirm-ready":
                var members = await db.Memberships.Where(m => m.GroupId == id && m.Status == MembershipStatus.Approved).ToListAsync(ct);
                var rules = await db.RuleVersions.SingleOrDefaultAsync(r => r.GroupId == id && r.VersionNumber == g.RulesVersion, ct);
                g.ConfirmReady(rules is not null && members.All(m => m.TermsVersionId == rules.Id && m.TermsAcceptedAt.HasValue), members.Count, await Approved(g.CreatedByUserId, ct), now);
                Audit(g, actor, "GROUP_READY_TO_START"); break;
            case "suspend": case "cancel":
                var wasActive = g.Status == GroupStatus.Active;
                g.Stop(operation == "cancel", reason ?? "", now);
                if (wasActive) Audit(g, actor, "GROUP_SUSPENDED_DURING_ACTIVE_CYCLE"); Audit(g, actor, operation == "cancel" ? "GROUP_CANCELLED" : "GROUP_SUSPENDED"); break;
            default: throw new InvalidOperationException("Unknown group operation.");
        }
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
    public async Task<IReadOnlyList<MemberDetails>> MembersAsync(Guid id, GroupActor actor, CancellationToken ct)
    {
        var g = await db.Groups.SingleOrDefaultAsync(g => g.Id == id, ct) ?? throw new NotFoundException("Group not found."); if (!actor.IsAdmin) await Manage(g, actor, ct);
        var result = new List<MemberDetails>();
        foreach (var m in await db.Memberships.AsNoTracking().Where(m => m.GroupId == id).OrderBy(m => m.AppliedAt).ToListAsync(ct)) result.Add(await MapMember(m, true, ct));
        return result;
    }
    public async Task<OrganizerContact> ContactAsync(Guid id, GroupActor actor, CancellationToken ct)
    {
        var g = await db.Groups.SingleOrDefaultAsync(g => g.Id == id, ct) ?? throw new NotFoundException("Group not found.");
        GroupRules.Require(g.CreatorType == GroupCreatorType.Organizer && g.Status != GroupStatus.Cancelled && await db.Memberships.AnyAsync(m => m.GroupId == id && m.UserId == actor.UserId && (m.Status == MembershipStatus.Approved || m.Status == MembershipStatus.Active), ct), "MEMBERSHIP_REQUIRED", "Organizer contact is available only to approved current members.");
        var user = await users.FindAsync(g.CreatedByUserId, ct) ?? throw new NotFoundException("Organizer unavailable."); return new(user.Name, user.Phone, user.Email);
    }
    private async Task<Group> Locked(Guid id, CancellationToken ct) => await db.Groups.FromSqlInterpolated($"SELECT * FROM groups.\"Groups\" WHERE \"Id\" = {id} FOR UPDATE").SingleOrDefaultAsync(ct) ?? throw new NotFoundException("Group not found.");
    private async Task<bool> Approved(Guid userId, CancellationToken ct) => await organizers.GetStatusAsync(userId, ct) == "APPROVED";
    private async Task EnsureUser(GroupActor actor, CancellationToken ct) { if (await users.FindAsync(actor.UserId, ct) is null) throw new UnauthorizedAccessException(); }
    private async Task Manage(Group g, GroupActor actor, CancellationToken ct, bool moderation = false)
    {
        if (actor.IsAdmin && (g.CreatorType == GroupCreatorType.Platform || moderation)) return;
        GroupRules.Require(g.CreatorType == GroupCreatorType.Organizer && g.CreatedByUserId == actor.UserId, "NOT_GROUP_OWNER", "You cannot manage another creator's group.");
        GroupRules.Require(await Approved(actor.UserId, ct), "ORGANIZER_NOT_APPROVED", "Organizer must be approved.");
    }
    private void Audit(Group g, GroupActor actor, string action) => db.AuditEvents.Add(new(g.Id, actor.UserId, action, clock.UtcNow));
    private async Task<MemberDetails> MapMember(GroupMembership m, bool email, CancellationToken ct)
    {
        var u = await users.FindAsync(m.UserId, ct);
        return new(m.Id, m.UserId, u?.Name ?? "Unavailable user", email ? u?.Email : null, m.SlotNumber, m.Status, m.AppliedAt, m.ApprovedAt, m.TermsVersionId, m.TermsAcceptedAt, m.RejectedReason, m.HasBeenSelectedForPayout, m.PayoutCycleNumber);
    }
    private async Task<GroupDetails> Map(Group g, GroupActor? actor, bool management, CancellationToken ct)
    {
        PublicOrganizer? organizer = null;
        if (g.CreatorType == GroupCreatorType.Organizer && await users.FindAsync(g.CreatedByUserId, ct) is { } user)
            organizer = new(user.Name, user.Verified, await organizers.GetStatusAsync(user.Id, ct), user.MemberSince);
        var version = await db.RuleVersions.AsNoTracking().SingleOrDefaultAsync(v => v.GroupId == g.Id && v.VersionNumber == g.RulesVersion, ct);
        var own = actor is null ? null : await db.Memberships.AsNoTracking().SingleOrDefaultAsync(m => m.GroupId == g.Id && m.UserId == actor.UserId, ct);
        var r = g.Rules;
        return new(g.Id, g.Name, g.Description, r.GroupType, g.CreatorType, r.GroupValue, r.MemberLimit, g.CurrentMemberCount, r.MemberLimit - g.CurrentMemberCount, g.MonthlyContribution, g.DurationMonths,
            r.OrganizerParticipates, r.OrganizerFirstPayout, g.FirstCycleSelectionMethod, r.ContributionDueDay, r.SelectionDay, r.PayoutDay, r.StartDate, g.Status, g.RulesVersion, g.RulesLocked, organizer, version is null ? null : new PublishedGroupRules(version.Id, version.VersionNumber, version.RulesSnapshot, version.RulesHash),
            own is null ? null : await MapMember(own, false, ct), management ? await db.Memberships.CountAsync(m => m.GroupId == g.Id && m.Status == MembershipStatus.Applied, ct) : 0, r.AuctionRules, r.RandomRules, management ? g.StatusReason : null, g.GroupTimeZone, g.ActivatedAt, g.CurrentCycleNumber);
    }
}
