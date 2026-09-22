namespace Dhanvi.Modules.Auctions.Application;

public static class AuctionBidIdempotency
{
    // Exactly 100 characters, matching the shared Prompt 4 receipt column.
    // All three GUIDs are preserved; N format removes only the hyphens.
    public static string Scope(Guid groupId, Guid cycleId, Guid actorId) => $"a:{groupId:N}:{cycleId:N}:{actorId:N}";
    /// <summary>Reschedule receipts share the column width ("r:" prefix, 100 characters) but never collide with bid receipts.</summary>
    public static string RescheduleScope(Guid groupId, Guid cycleId, Guid actorId) => $"r:{groupId:N}:{cycleId:N}:{actorId:N}";
}
