namespace Dhanvi.Modules.Auctions.Application;

public static class AuctionBidIdempotency
{
    // Exactly 100 characters, matching the shared Prompt 4 receipt column.
    // All three GUIDs are preserved; N format removes only the hyphens.
    public static string Scope(Guid groupId, Guid cycleId, Guid actorId) => $"a:{groupId:N}:{cycleId:N}:{actorId:N}";
}
