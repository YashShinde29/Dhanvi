using System.Globalization;
using System.Security.Claims;
using Dhanvi.Modules.Ledger.Application;
using Dhanvi.Modules.Ledger.Domain;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
namespace Dhanvi.Modules.Ledger.Api;

public static class LedgerEndpoints
{
    public static IEndpointRouteBuilder MapLedgerEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var admin = endpoints.MapGroup("/admin/ledger").RequireAuthorization("AdminOnly").WithTags("Ledger");
        admin.MapGet("/accounts", (ILedgerQueries q, CancellationToken ct) => q.AccountsAsync(ct));
        admin.MapGet("/journals", (HttpContext h, ILedgerQueries q, CancellationToken ct) => q.JournalsAsync(Filter(h), ct));
        admin.MapGet("/journals/{id:guid}", (Guid id, ILedgerQueries q, CancellationToken ct) => q.JournalAsync(id, ct));
        admin.MapGet("/trial-balance", (HttpContext h, ILedgerQueries q, CancellationToken ct) => q.TrialBalanceAsync(Filter(h), ct));
        admin.MapGet("/groups/{groupId:guid}", (Guid groupId, HttpContext h, ILedgerQueries q, CancellationToken ct) => q.JournalsAsync(Filter(h) with { GroupId = groupId }, ct));
        admin.MapGet("/groups/{groupId:guid}/balances", (Guid groupId, HttpContext h, ILedgerQueries q, CancellationToken ct) => q.TrialBalanceAsync(Filter(h) with { GroupId = groupId }, ct));
        admin.MapGet("/accounts/{code}/balance", async (string code, HttpContext h, ILedgerQueries q, CancellationToken ct) =>
        {
            var balances = await q.TrialBalanceAsync(Filter(h) with { Account = null }, ct);
            var account = balances.Accounts.SingleOrDefault(a => a.Code == code);
            return account is null ? Results.NotFound() : Results.Ok(account);
        });
        endpoints.MapGet("/me/ledger", (HttpContext h, ILedgerQueries q, CancellationToken ct) => q.MemberAsync(UserId(h.User), Filter(h), ct)).RequireAuthorization().WithTags("My ledger");
        return endpoints;
    }
    private static Guid UserId(ClaimsPrincipal user) => Guid.TryParse(user.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : throw new UnauthorizedAccessException();
    private static LedgerFilter Filter(HttpContext h)
    {
        var q = h.Request.Query;
        DateOnly? Date(string key) => string.IsNullOrEmpty(q[key]) ? null : DateOnly.TryParseExact(q[key], "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var value) ? value : throw new BadHttpRequestException("Invalid ledger date.");
        Guid? Id(string key) => string.IsNullOrEmpty(q[key]) ? null : Guid.TryParse(q[key], out var value) ? value : throw new BadHttpRequestException("Invalid ledger reference.");
        int Number(string key, int fallback) => string.IsNullOrEmpty(q[key]) ? fallback : int.TryParse(q[key], out var value) ? value : throw new BadHttpRequestException("Invalid page.");
        AccountingEventType? type = null;
        if (!string.IsNullOrEmpty(q["eventType"])) type = Enum.TryParse<AccountingEventType>(q["eventType"].ToString().Replace("_", "", StringComparison.Ordinal), true, out var value) && Enum.IsDefined(value) ? value : throw new BadHttpRequestException("Invalid event type.");
        return new(Date("from"), Date("to"), type, q["account"], Id("groupId"), Id("cycleId"), q["journalNumber"], Number("page", 1), Number("pageSize", 20));
    }
}
