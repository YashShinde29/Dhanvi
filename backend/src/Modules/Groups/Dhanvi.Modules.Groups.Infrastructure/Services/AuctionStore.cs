using System.Data;
using Dhanvi.Modules.Auctions.Application;
using Dhanvi.Modules.Groups.Infrastructure.Persistence;
using Dhanvi.Modules.RandomDraws.Application;
using Microsoft.EntityFrameworkCore;
namespace Dhanvi.Modules.Groups.Infrastructure.Services;

// All group mutations use this same group-row lock, including contributions and selection.
internal sealed class AuctionStore(GroupsDbContext db, ISelectionStore selectionStore) : IAuctionStore
{
    public Task<T> ReadAsync<T>(Guid groupId, Guid cycleId, Guid actorId, Func<AuctionContext, T> read, CancellationToken ct) => Run(groupId, cycleId, actorId, false, read, ct);
    public Task<T> ExecuteLockedAsync<T>(Guid groupId, Guid cycleId, Guid actorId, Func<AuctionContext, T> execute, CancellationToken ct) => Run(groupId, cycleId, actorId, true, execute, ct);
    private async Task<T> Run<T>(Guid groupId, Guid cycleId, Guid actorId, bool write, Func<AuctionContext, T> operation, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(write ? IsolationLevel.ReadCommitted : IsolationLevel.RepeatableRead, ct);
        if (write) await db.Groups.FromSqlInterpolated($"SELECT * FROM groups.\"Groups\" WHERE \"Id\" = {groupId} FOR UPDATE").SingleOrDefaultAsync(ct);
        var selection = await selectionStore.ReadAsync(groupId, cycleId, actorId, ct);
        var state = new AuctionContext(selection) {
            Auction = await db.Auctions.SingleOrDefaultAsync(a => a.GroupId == groupId && a.CycleId == cycleId, ct),
            Result = await db.AuctionResults.Include(r => r.Allocations).SingleOrDefaultAsync(r => r.GroupId == groupId && r.CycleId == cycleId, ct),
            Bids = await db.AuctionBids.Where(b => b.GroupId == groupId && b.CycleId == cycleId).ToListAsync(ct),
            Receipts = await db.IdempotencyRecords.Where(r => r.Scope == $"auction-bid:{groupId:D}:{cycleId:D}:{actorId:D}").ToListAsync(ct),
            Audit = await db.AuditEvents.Where(a => a.GroupId == groupId && a.CycleId == cycleId).ToListAsync(ct)
        };
        var result = operation(state);
        if (write)
        {
            if (state.Auction is not null && db.Entry(state.Auction).State == EntityState.Detached) db.Auctions.Add(state.Auction);
            if (state.NewSelection is not null) db.SelectionResults.Add(state.NewSelection);
            if (state.Result is not null && db.Entry(state.Result).State == EntityState.Detached) db.AuctionResults.Add(state.Result);
            db.AuctionBids.AddRange(state.Bids.Where(b => db.Entry(b).State == EntityState.Detached));
            db.IdempotencyRecords.AddRange(state.Receipts.Where(r => db.Entry(r).State == EntityState.Detached));
            db.AuditEvents.AddRange(state.Audit.Where(a => db.Entry(a).State == EntityState.Detached));
            await db.SaveChangesAsync(ct);
        }
        await tx.CommitAsync(ct); return result;
    }
}
