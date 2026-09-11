using Dhanvi.SharedKernel.Exceptions;
namespace Dhanvi.Modules.Ledger.Domain;

public enum AccountType { Asset, Liability, Equity, Revenue, Expense }
public enum NormalBalance { Debit, Credit }
public sealed record AccountDefinition(string Code, string Name, AccountType Type);

public static class ChartOfAccounts
{
    public const string CashClearing = "1000", MemberReceivable = "1100", PlatformFeeReceivable = "1200",
        GroupPool = "2000", MemberPayout = "2100", MemberBenefit = "2200", DeferredPlatformFee = "2300", ServiceFeeRevenue = "4000";
    public static IReadOnlyList<AccountDefinition> SystemAccounts { get; } = Array.AsReadOnly(new[] {
        new AccountDefinition(CashClearing, "Cash clearing (future settlement)", AccountType.Asset),
        new(MemberReceivable, "Member receivable", AccountType.Asset),
        new(PlatformFeeReceivable, "Platform fee receivable", AccountType.Asset),
        new(GroupPool, "Group pool liability", AccountType.Liability),
        new(MemberPayout, "Member payout liability", AccountType.Liability),
        new(MemberBenefit, "Member auction benefit liability", AccountType.Liability),
        new(DeferredPlatformFee, "Deferred platform fee liability", AccountType.Liability),
        new(ServiceFeeRevenue, "Platform service fee revenue", AccountType.Revenue)
    });
    public static NormalBalance Normal(AccountType type) => type is AccountType.Asset or AccountType.Expense ? NormalBalance.Debit : NormalBalance.Credit;
    public static decimal Balance(NormalBalance normal, decimal debit, decimal credit) => normal == NormalBalance.Debit ? debit - credit : credit - debit;
}

public sealed class LedgerAccount
{
    private LedgerAccount() { }
    public Guid Id { get; private set; } = Guid.NewGuid();
    public string Code { get; private set; } = "";
    public string Name { get; private set; } = "";
    public AccountType AccountType { get; private set; }
    public NormalBalance NormalBalance { get; private set; }
    public bool IsSystem { get; private set; } = true;
    public bool IsActive { get; private set; } = true;
    public DateTimeOffset CreatedAt { get; private set; }
    public static LedgerAccount Create(AccountDefinition definition, DateTimeOffset now)
    {
        BusinessRuleException.Require(ChartOfAccounts.SystemAccounts.Contains(definition), "INVALID_LEDGER_ACCOUNT", "Use a defined system account.");
        return new() { Code = definition.Code, Name = definition.Name, AccountType = definition.Type, NormalBalance = ChartOfAccounts.Normal(definition.Type), CreatedAt = now.ToUniversalTime() };
    }
}
