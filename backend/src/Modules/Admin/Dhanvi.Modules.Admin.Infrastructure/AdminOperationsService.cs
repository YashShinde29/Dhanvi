using Dhanvi.Modules.Admin.Application;
using Dhanvi.SharedKernel.Exceptions;
using Dhanvi.SharedKernel.Time;
namespace Dhanvi.Modules.Admin.Infrastructure;

/// <summary>
/// Composes the module readers into the Admin Control Center views. It only joins and labels; the readers own the data
/// and the business modules own the rules. Issues are derived from persisted states so the frontend can present
/// "what is blocking this group and who must act" without re-deriving it on every screen.
/// </summary>
internal sealed class AdminOperationsService(IGroupOperationsReader groups, IPaymentOperationsReader payments, IPayoutOperationsReader payouts, IOrganizerOperationsReader organizers, IDateTimeProvider clock) : IAdminOperationsService
{
    public async Task<AdminOperationsOverview> OverviewAsync(CancellationToken ct) =>
        new(await groups.OverviewAsync(ct), await payments.OverviewAsync(ct), await payouts.OverviewAsync(ct), await organizers.OverviewAsync(ct), clock.UtcNow);

    public async Task<AdminGroupOperationsPage> GroupsAsync(AdminGroupOperationsFilter filter, CancellationToken ct)
    {
        var page = await groups.ListAsync(filter, ct);
        return page with { Items = await Enrich(page.Items, ct) };
    }

    public async Task<AdminGroupOperationsSummary> GroupAsync(Guid groupId, CancellationToken ct)
    {
        var row = await groups.GroupAsync(groupId, ct) ?? throw new NotFoundException("Group not found.");
        row = (await Enrich([row], ct))[0];
        var cycles = await groups.CyclesAsync(groupId, ct);
        var outstanding = row.CurrentCycle is { } current ? await groups.OutstandingContributionsAsync(groupId, current.Id, ct) : [];
        var groupPayouts = await payouts.GroupPayoutsAsync(groupId, ct);
        var paymentIssues = await payments.IssuesAsync(groupId, ct);
        var activity = (await groups.ActivityAsync(groupId, 60, ct)).Concat(await payouts.ActivityAsync(groupId, 40, ct))
            .OrderByDescending(a => a.At).ThenBy(a => a.Source).Take(80).ToArray();
        return new(row, cycles, outstanding, groupPayouts, paymentIssues, Issues(row, outstanding, groupPayouts, paymentIssues), activity);
    }

    private async Task<IReadOnlyList<AdminGroupOperationsRow>> Enrich(IReadOnlyList<AdminGroupOperationsRow> rows, CancellationToken ct)
    {
        if (rows.Count == 0) return rows;
        var ids = rows.Select(r => r.Id).ToArray();
        var paymentCounts = await payments.CountsByGroupAsync(ids, ct);
        var payoutCounts = await payouts.CountsByGroupAsync(ids, ct);
        return rows.Select(r => r with { Payments = paymentCounts.GetValueOrDefault(r.Id, AdminPaymentCounts.Empty), Payouts = payoutCounts.GetValueOrDefault(r.Id, AdminPayoutCounts.Empty) }).ToArray();
    }

    /// <summary>Blocking conditions for one group. Each names the party that must act; none of them is an action by itself.</summary>
    private List<AdminGroupIssue> Issues(AdminGroupOperationsRow g, IReadOnlyList<AdminOutstandingContribution> outstanding, IReadOnlyList<AdminPayoutSnapshot> payouts, IReadOnlyList<AdminPaymentSnapshot> paymentIssues)
    {
        var issues = new List<AdminGroupIssue>();
        var today = BusinessCalendar.Today(clock.UtcNow);
        if (g.Status == "SUSPENDED") issues.Add(new("GROUP_SUSPENDED", "Group suspended", g.StatusReason ?? "Contributions, selections and bids are paused.", "ADMIN", g.LastActivityAt, "GROUP", g.Id));
        foreach (var p in paymentIssues.Where(p => p.Status == "RECONCILIATION_REQUIRED"))
            issues.Add(new("PAYMENT_RECONCILIATION", $"Payment reconciliation mismatch · cycle {p.CycleNumber}", p.ReconciliationMessage ?? $"{p.MemberName}'s payment does not match provider data.", "FINANCE", p.CreatedAt, "PAYMENT", p.Id));
        foreach (var p in payouts.Where(p => p.Status == "RECONCILIATION_REQUIRED"))
            issues.Add(new("PAYOUT_RECONCILIATION", $"Payout reconciliation mismatch · cycle {p.CycleNumber}", $"{p.MemberName}'s payout does not match provider data. Settlement and retries are blocked.", "FINANCE", p.CreatedAt, "PAYOUT", p.Id));
        foreach (var p in payouts.Where(p => p.Status == "FAILED"))
            issues.Add(new("PAYOUT_FAILED", $"Payout failed · cycle {p.CycleNumber}", $"The transfer to {p.MemberName} failed and can be retried.", "FINANCE", p.CreatedAt, "PAYOUT", p.Id));
        foreach (var p in payouts.Where(p => p.Status == "PENDING_BENEFICIARY"))
            issues.Add(new("MISSING_BENEFICIARY", $"Missing payout account · cycle {p.CycleNumber}", $"{p.MemberName} has not added a payout bank account.", "USER", p.CreatedAt, "PAYOUT", p.Id));
        if (g.CurrentCycle is { } c)
        {
            if (c.AuctionStatus == "CLOSED_NO_BIDS") issues.Add(new("AUCTION_NO_BIDS", $"Auction closed without bids · cycle {c.CycleNumber}", "No winner or payout right was assigned. The cycle needs review.", g.CreatorType == "PLATFORM" ? "ADMIN" : "ORGANIZER", c.AuctionEndsAt, "CYCLE", c.Id));
            // Outstanding contributions are normal while collecting; they become an issue once the due date has passed.
            var overdue = outstanding.Where(o => o.Status == "OVERDUE" || o.DueDate < today).ToList();
            if (c.Status == "COLLECTING_CONTRIBUTIONS" && overdue.Count > 0)
                issues.Add(new("OUTSTANDING_CONTRIBUTIONS", $"{overdue.Count} contribution{(overdue.Count == 1 ? "" : "s")} overdue · cycle {c.CycleNumber}",
                    string.Join(", ", overdue.Take(5).Select(o => o.SlotNumber is { } s ? $"#{s} {o.MemberName}" : o.MemberName)) + (overdue.Count > 5 ? $" and {overdue.Count - 5} more" : ""),
                    c.CollectionMode == "RAZORPAY" ? "USER" : g.CreatorType == "PLATFORM" ? "ADMIN" : "ORGANIZER", new DateTimeOffset(c.ContributionDueDate.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero), "CYCLE", c.Id));
        }
        return issues;
    }
}
