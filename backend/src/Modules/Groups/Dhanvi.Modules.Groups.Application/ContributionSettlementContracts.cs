using System.Data.Common;
namespace Dhanvi.Modules.Groups.Application;
public sealed record ContributionPaymentSource(Guid ContributionId, Guid GroupId, Guid CycleId, Guid MembershipId, Guid UserId,
    string GroupName, string MemberName, int CycleNumber, string TimeZone, decimal ExpectedAmount, decimal SettledAmount,
    string FinancialStatus, string CollectionMode, bool CanCollect, bool SelectionCompleted);
public interface IContributionSettlementService
{
    Task<ContributionPaymentSource> ReadLockedAsync(Guid contributionId, DbTransaction transaction, CancellationToken ct);
    Task SettleAsync(Guid contributionId, Guid paymentId, decimal amount, DbTransaction transaction, DateTimeOffset now, CancellationToken ct);
    Task ReverseAsync(Guid contributionId, Guid paymentId, DbTransaction transaction, DateTimeOffset now, CancellationToken ct);
}
