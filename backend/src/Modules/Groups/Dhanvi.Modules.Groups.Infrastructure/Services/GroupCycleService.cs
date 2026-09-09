using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Dhanvi.Modules.Contributions.Domain;
using Dhanvi.Modules.Cycles.Domain;
using Dhanvi.Modules.Groups.Application;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.Groups.Infrastructure.Persistence;
using Dhanvi.Modules.Identity.Application.Abstractions;
using Dhanvi.SharedKernel.Domain;
using Dhanvi.SharedKernel.Exceptions;
using Dhanvi.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;
namespace Dhanvi.Modules.Groups.Infrastructure.Services;

internal sealed partial class GroupCycleService(GroupsDbContext db, IOrganizerStatusReader organizers, IGroupUserDirectory users, IDateTimeProvider clock)
    : IGroupCycleService, IContributionRecordingService
{
    public async Task<IReadOnlyList<CycleDetails>> ActivateAsync(Guid groupId, GroupActor actor, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var group = await Locked(groupId, ct); await Manage(group, actor, ct);
        var existing = await db.MonthlyCycles.Where(c => c.GroupId == groupId).OrderBy(c => c.CycleNumber).ToListAsync(ct);
        if (group.Status == GroupStatus.Active)
        {
            BusinessRuleException.Require(existing.Count == group.DurationMonths && await db.Contributions.CountAsync(c => c.GroupId == groupId, ct) == group.MemberLimit * group.DurationMonths,
                "INCOMPLETE_ACTIVATION", "The persisted schedule is inconsistent; administrative investigation is required.");
            await tx.CommitAsync(ct); return existing.Select(c => MapCycle(c, group.GroupTimeZone)).ToArray();
        }
        var members = await db.Memberships.Where(m => m.GroupId == groupId && m.Status == MembershipStatus.Approved).ToListAsync(ct);
        var rules = await db.RuleVersions.SingleOrDefaultAsync(r => r.GroupId == groupId && r.VersionNumber == group.RulesVersion, ct);
        var accepted = rules is null ? 0 : await db.TermsAcceptances.CountAsync(a => a.GroupRuleVersionId == rules.Id && a.RulesHash == rules.RulesHash && db.Memberships.Any(m => m.Id == a.MembershipId && m.GroupId == groupId && m.Status == MembershipStatus.Approved), ct);
        var allAccepted = rules is not null && accepted == members.Count && members.All(m => m.TermsVersionId == rules.Id && m.TermsAcceptedAt.HasValue && m.SlotNumber is >= 1 && m.SlotNumber <= group.MemberLimit);
        var now = clock.UtcNow;
        group.Activate(members.Count, allAccepted, await Approved(group, ct), existing.Count != 0, now);
        var cycles = CycleSchedule.Generate(group, now);
        db.MonthlyCycles.AddRange(cycles);
        foreach (var member in members)
        {
            member.Activate(now);
            foreach (var cycle in cycles) db.Contributions.Add(Contribution.Expect(groupId, cycle.Id, member.Id, group.MonthlyContribution, cycle.ContributionDueDate, now));
        }
        Audit(groupId, actor, "GROUP_ACTIVATED", now); Audit(groupId, actor, "MONTHLY_CYCLES_CREATED", now); Audit(groupId, actor, "CONTRIBUTIONS_CREATED", now);
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return cycles.Select(c => MapCycle(c, group.GroupTimeZone)).ToArray();
    }
    public Task<ContributionOperationResult> RecordAsync(Guid groupId, Guid cycleId, Guid contributionId, GroupActor actor, string key, RecordContributionRequest request, CancellationToken ct) =>
        Operate(groupId, cycleId, contributionId, actor, key, request, null, ct);
    public Task<ContributionOperationResult> ReverseAsync(Guid groupId, Guid cycleId, Guid contributionId, GroupActor actor, string key, ReverseContributionRequest request, CancellationToken ct) =>
        Operate(groupId, cycleId, contributionId, actor, key, null, request, ct);

    private async Task<ContributionOperationResult> Operate(Guid groupId, Guid cycleId, Guid contributionId, GroupActor actor, string key, RecordContributionRequest? record, ReverseContributionRequest? reversal, CancellationToken ct)
    {
        BusinessRuleException.Require(!string.IsNullOrWhiteSpace(key) && key.Length <= 200, "IDEMPOTENCY_KEY_REQUIRED", "Send a non-empty Idempotency-Key header, maximum 200 characters.");
        key = key.Trim();
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { groupId, cycleId, contributionId, actor.UserId, record, reversal }))));
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var group = await Locked(groupId, ct); await Manage(group, actor, ct);
        BusinessRuleException.Require(group.Status == GroupStatus.Active, "GROUP_NOT_ACTIVE", "Only active groups accept contribution recording or reversals.");
        var cycle = await db.MonthlyCycles.SingleOrDefaultAsync(c => c.Id == cycleId && c.GroupId == groupId, ct) ?? throw new NotFoundException("Cycle not found in this group.");
        var contribution = await db.Contributions.SingleOrDefaultAsync(c => c.Id == contributionId && c.CycleId == cycleId && c.GroupId == groupId, ct) ?? throw new NotFoundException("Contribution not found in this cycle.");
        var scope = $"group:{groupId:D}";
        var receipt = await db.IdempotencyRecords.SingleOrDefaultAsync(r => r.Scope == scope && r.Key == key, ct);
        if (receipt is not null)
        {
            receipt.ValidateReplay(hash);
            var result = await db.ContributionEntries.SingleAsync(e => e.Id == receipt.ResultId && e.ContributionId == contributionId, ct);
            await tx.CommitAsync(ct); return new(MapEntry(result), true);
        }
        var now = clock.UtcNow; var today = BusinessCalendar.Today(now, group.GroupTimeZone); ContributionEntry entry;
        if (record is not null)
        {
            cycle.EnsureRecordingOpen();
            BusinessRuleException.Require(!await db.ContributionEntries.AnyAsync(e => e.ContributionId == contributionId && e.EntryType == ContributionEntryType.Record && e.Reference == (record.Reference ?? "").Trim(), ct),
                "REFERENCE_ALREADY_USED", "This manual reference already exists for the contribution. Retry with its original idempotency key or use a new reference.");
            entry = contribution.Record(record.Amount, record.Reference, record.Note, key, actor.UserId, today, now);
            Audit(groupId, actor, contribution.RecordedAmount == contribution.ExpectedAmount ? "CONTRIBUTION_RECORDED" : "CONTRIBUTION_PARTIALLY_RECORDED", now, contributionId);
        }
        else
        {
            cycle.EnsureReversalAllowed();
            var original = await db.ContributionEntries.SingleOrDefaultAsync(e => e.Id == reversal!.EntryId && e.ContributionId == contributionId, ct) ?? throw new NotFoundException("Original contribution entry not found.");
            var alreadyReversed = await db.ContributionEntries.AnyAsync(e => e.ReversesEntryId == original.Id, ct);
            entry = contribution.Reverse(original, reversal!.Reason, key, actor.UserId, alreadyReversed, today, now);
            Audit(groupId, actor, "CONTRIBUTION_REVERSED", now, contributionId);
        }
        db.ContributionEntries.Add(entry); db.IdempotencyRecords.Add(new(scope, key, hash, entry.Id, now));
        // Tracking returns the changed contribution instance alongside the unchanged obligations.
        var all = await db.Contributions.Where(c => c.CycleId == cycleId).ToListAsync(ct);
        var wasReady = cycle.Status == CycleStatus.ReadyForSelection;
        if (cycle.Recalculate(all.Sum(c => c.RecordedAmount), all.Count(c => c.RecordedAmount == c.ExpectedAmount), all.Count, now))
        {
            Audit(groupId, actor, "CYCLE_CONTRIBUTIONS_COMPLETED", now, cycleId); Audit(groupId, actor, "CYCLE_READY_FOR_SELECTION", now, cycleId);
        }
        else if (wasReady) Audit(groupId, actor, "CYCLE_REOPENED_AFTER_REVERSAL", now, cycleId);
        if (contribution.Status == ContributionStatus.Overdue) Audit(groupId, actor, "CONTRIBUTION_MARKED_OVERDUE", now, contributionId);
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return new(MapEntry(entry), false);
    }
    public async Task<int> MarkOverdueAsync(Guid groupId, GroupActor actor, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var group = await Locked(groupId, ct); await Manage(group, actor, ct);
        BusinessRuleException.Require(group.Status == GroupStatus.Active, "GROUP_NOT_ACTIVE", "Only active groups can mark contributions overdue.");
        var now = clock.UtcNow; var today = BusinessCalendar.Today(now, group.GroupTimeZone);
        var contributions = await db.Contributions.Where(c => c.GroupId == groupId && c.DueDate < today && c.RecordedAmount < c.ExpectedAmount && c.Status != ContributionStatus.Overdue &&
            db.MonthlyCycles.Any(cycle => cycle.Id == c.CycleId && cycle.Status == CycleStatus.CollectingContributions)).ToListAsync(ct);
        var changed = 0;
        foreach (var contribution in contributions)
            if (contribution.MarkOverdue(today, now)) { changed++; Audit(groupId, actor, "CONTRIBUTION_MARKED_OVERDUE", now, contribution.Id); }
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return changed;
    }
    private async Task<Group> Locked(Guid id, CancellationToken ct) => await db.Groups.FromSqlInterpolated($"SELECT * FROM groups.\"Groups\" WHERE \"Id\" = {id} FOR UPDATE").SingleOrDefaultAsync(ct) ?? throw new NotFoundException("Group not found.");
    private async Task<bool> Approved(Group group, CancellationToken ct) => group.CreatorType == GroupCreatorType.Platform || await organizers.GetStatusAsync(group.CreatedByUserId, ct) == "APPROVED";
    private async Task Manage(Group group, GroupActor actor, CancellationToken ct)
    {
        if (await users.FindAsync(actor.UserId, ct) is null) throw new UnauthorizedAccessException();
        GroupRules.Require(group.CreatorType == GroupCreatorType.Platform ? actor.IsAdmin : group.CreatedByUserId == actor.UserId, "NOT_GROUP_OWNER", "Only the group's approved organizer or platform administrator may operate this group.");
        GroupRules.Require(await Approved(group, ct), "ORGANIZER_NOT_APPROVED", "Organizer must still be approved.");
    }
    private void Audit(Guid groupId, GroupActor actor, string action, DateTimeOffset now, Guid? subjectId = null) => db.AuditEvents.Add(new(groupId, actor.UserId, action, now, subjectId));
    private static ContributionEntryDetails MapEntry(ContributionEntry e) => new(e.Id, e.EntryType, e.Amount, e.Reference, e.Note, e.RecordedByUserId, e.CreatedAt, e.ReversesEntryId);
    private static CycleDetails MapCycle(MonthlyCycle c, string timeZone) => new(c.Id, c.GroupId, c.CycleNumber, c.SelectionMethod, c.Status, c.ContributionDueDate, c.SelectionDate, c.PayoutDate, timeZone,
        c.ExpectedMemberCount, c.ExpectedContributionPerMember, c.ExpectedPoolAmount, c.RecordedContributionAmount, c.FullyRecordedMemberCount, c.ExpectedMemberCount - c.FullyRecordedMemberCount,
        c.StartedAt, c.ContributionsCompletedAt, c.ReadyForSelectionAt);
}
