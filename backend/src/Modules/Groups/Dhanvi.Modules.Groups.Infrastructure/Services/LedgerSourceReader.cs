using System.Data.Common;
using System.Security.Cryptography;
using System.Text.Json;
using Dhanvi.Modules.Contributions.Domain;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.Groups.Infrastructure.Persistence;
using Dhanvi.Modules.Ledger.Application;
using Dhanvi.Modules.Ledger.Domain;
using Dhanvi.SharedKernel.Exceptions;
using Microsoft.EntityFrameworkCore;
namespace Dhanvi.Modules.Groups.Infrastructure.Services;

internal sealed class LedgerSourceReader(GroupsDbContext queries) : ILedgerSourceReader
{
    public async Task<IReadOnlyList<Guid>> MembershipsAsync(Guid userId, CancellationToken ct) =>
        await queries.Memberships.AsNoTracking().Where(m => m.UserId == userId).Select(m => m.Id).ToArrayAsync(ct);
    public Task<bool> GroupExistsAsync(Guid groupId, CancellationToken ct) => queries.Groups.AnyAsync(g => g.Id == groupId, ct);
    public async Task LockGroupAsync(Guid groupId, DbTransaction transaction, CancellationToken ct)
    {
        await using var db = Context(transaction); await db.Database.UseTransactionAsync(transaction, ct);
        _ = await db.Groups.FromSqlInterpolated($"SELECT * FROM groups.\"Groups\" WHERE \"Id\" = {groupId} FOR UPDATE").SingleOrDefaultAsync(ct) ?? throw new NotFoundException("Group not found.");
    }
    public async Task<LedgerSource> ReadLockedAsync(AccountingEventType type, Guid eventId, DbTransaction transaction, CancellationToken ct)
    {
        await using var db = Context(transaction); await db.Database.UseTransactionAsync(transaction, ct);
        if (type is AccountingEventType.ContributionRecorded or AccountingEventType.ContributionReversed)
        {
            var entry = await db.ContributionEntries.SingleOrDefaultAsync(e => e.Id == eventId, ct) ?? throw new NotFoundException("Contribution event not found.");
            BusinessRuleException.Require(entry.EntryType == (type == AccountingEventType.ContributionRecorded ? ContributionEntryType.Record : ContributionEntryType.Reversal), "INVALID_ACCOUNTING_SOURCE", "Contribution event type does not match.");
            var obligation = await db.Contributions.SingleAsync(c => c.Id == entry.ContributionId, ct);
            await LockGroupAsync(obligation.GroupId, transaction, ct);
            var group = await db.Groups.SingleAsync(g => g.Id == obligation.GroupId, ct);
            return Stamp(new(type, eventId, "Contributions", group.Id, obligation.CycleId, null, null, null, group.GroupValue, 0, 0, [], group.GroupTimeZone, entry.CreatedAt, ""));
        }
        BusinessRuleException.Require(type is AccountingEventType.RandomSelectionCompleted or AccountingEventType.OrganizerReservedSelectionCompleted or AccountingEventType.AuctionSelectionCompleted or AccountingEventType.AuctionMemberBenefitCalculated or AccountingEventType.PlatformFeeCalculated,
            "UNSUPPORTED_ACCOUNTING_EVENT", "No actual settlement source exists for this accounting event.");
        var selectionId = eventId;
        if (type is AccountingEventType.AuctionMemberBenefitCalculated or AccountingEventType.PlatformFeeCalculated)
            selectionId = (await db.AuctionResults.SingleOrDefaultAsync(r => r.Id == eventId, ct) ?? throw new NotFoundException("Auction result not found.")).SelectionResultId;
        var selection = await db.SelectionResults.SingleOrDefaultAsync(s => s.Id == selectionId, ct) ?? throw new NotFoundException("Finalized selection not found.");
        var expected = selection.SelectionMethod switch { SelectionMethod.Random => AccountingEventType.RandomSelectionCompleted, SelectionMethod.OrganizerReserved => AccountingEventType.OrganizerReservedSelectionCompleted, _ => AccountingEventType.AuctionSelectionCompleted };
        BusinessRuleException.Require(type == expected || expected == AccountingEventType.AuctionSelectionCompleted && type is AccountingEventType.AuctionMemberBenefitCalculated or AccountingEventType.PlatformFeeCalculated,
            "INVALID_ACCOUNTING_SOURCE", "Selection method does not match the accounting event.");
        await LockGroupAsync(selection.GroupId, transaction, ct);
        var sourceGroup = await db.Groups.SingleAsync(g => g.Id == selection.GroupId, ct);
        var cycle = await db.MonthlyCycles.SingleAsync(c => c.Id == selection.CycleId && c.GroupId == selection.GroupId, ct);
        BusinessRuleException.Require(cycle.SelectionResultId == selection.Id && cycle.SelectionCompletedAt.HasValue,
            "INVALID_ACCOUNTING_SOURCE", "Cycle has not finalized this selection.");
        if (expected != AccountingEventType.AuctionSelectionCompleted)
            return Stamp(new(expected, selection.Id, "RandomDraws", selection.GroupId, selection.CycleId, selection.WinnerMembershipId, selection.Id, null,
                cycle.ExpectedPoolAmount, cycle.ExpectedPoolAmount, 0, [], sourceGroup.GroupTimeZone, selection.ExecutedAt, ""));
        var result = await db.AuctionResults.Include(r => r.Allocations).SingleOrDefaultAsync(r => r.SelectionResultId == selection.Id, ct) ?? throw new NotFoundException("Finalized auction calculation not found.");
        BusinessRuleException.Require(result.CalculationVersion == "DHANVI_AUCTION_V1" && result.WinnerMembershipId == selection.WinnerMembershipId && result.GroupValue == cycle.ExpectedPoolAmount,
            "INVALID_ACCOUNTING_SOURCE", "Unsupported or inconsistent finalized auction calculation.");
        // Consume immutable Auctions outputs; the auction formula stays in Auctions.
        var benefits = result.Allocations.Where(a => a.MembershipId.HasValue).OrderBy(a => a.MembershipId).Select(a => new BenefitSource(a.MembershipId!.Value, a.Amount)).ToArray();
        return Stamp(new(expected, selection.Id, "Auctions", selection.GroupId, selection.CycleId, result.WinnerMembershipId, selection.Id, result.Id,
            result.GroupValue, result.WinnerPayout, result.PlatformFee, benefits, sourceGroup.GroupTimeZone, result.FinalizedAt, ""));
    }
    private static GroupsDbContext Context(DbTransaction tx) => new(new DbContextOptionsBuilder<GroupsDbContext>().UseNpgsql(tx.Connection!).Options);
    private static LedgerSource Stamp(LedgerSource source) => source with { Fingerprint = Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(source))) };
}
