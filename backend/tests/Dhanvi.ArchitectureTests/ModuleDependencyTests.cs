using Dhanvi.Modules.Audit.Domain;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.Identity.Domain;
using Dhanvi.Modules.Organizers.Domain;

namespace Dhanvi.ArchitectureTests;

public sealed class ModuleDependencyTests
{
    [Theory]
    [MemberData(nameof(DomainAssemblies))]
    public void DomainDoesNotReferenceInfrastructure(Type moduleMarker)
    {
        var references = moduleMarker.Assembly.GetReferencedAssemblies().Select(name => name.Name ?? string.Empty);

        Assert.DoesNotContain(references, name => name.Contains("Infrastructure", StringComparison.Ordinal));
        Assert.DoesNotContain(references, name => name.StartsWith("Microsoft.AspNetCore", StringComparison.Ordinal));
    }

    public static TheoryData<Type> DomainAssemblies => new()
    {
        typeof(Dhanvi.Modules.Ledger.Domain.JournalEntry),
        typeof(Dhanvi.Modules.Cycles.Domain.MonthlyCycle),
        typeof(Dhanvi.Modules.Contributions.Domain.Contribution),
        typeof(Dhanvi.Modules.RandomDraws.Domain.SelectionResult),
        typeof(Dhanvi.Modules.Auctions.Domain.Auction), typeof(AuditLog),
        typeof(IdentityModuleMarker),
        typeof(GroupsModuleMarker),
        typeof(OrganizerApplication),
    };

    [Fact]
    public void LedgerApiDependsOnApplicationContractsAndHasNoPostingRouteHandler()
    {
        var api = typeof(Dhanvi.Modules.Ledger.Api.LedgerEndpoints).Assembly;
        Assert.Contains(api.GetReferencedAssemblies(), a => a.Name == "Dhanvi.Modules.Ledger.Application");
        Assert.DoesNotContain(api.GetReferencedAssemblies(), a => a.Name!.Contains("Infrastructure", StringComparison.Ordinal));
        var methods = api.GetTypes().SelectMany(t => t.GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static));
        Assert.DoesNotContain(methods.SelectMany(m => m.GetParameters()), p => p.ParameterType == typeof(Dhanvi.Modules.Ledger.Application.ILedgerPostingService));
    }
    [Fact]
    public void BusinessModulesUseLedgerApplicationWithoutLedgerInfrastructureOrAccountingEntities()
    {
        var assembly = typeof(Dhanvi.Modules.Groups.Infrastructure.Persistence.GroupsDbContext).Assembly;
        Assert.DoesNotContain(assembly.GetReferencedAssemblies(), a => a.Name == "Dhanvi.Modules.Ledger.Infrastructure");
        Assert.Contains(assembly.GetReferencedAssemblies(), a => a.Name == "Dhanvi.Modules.Ledger.Application");
        var sets = typeof(Dhanvi.Modules.Groups.Infrastructure.Persistence.GroupsDbContext).GetProperties().Select(p => p.PropertyType);
        Assert.DoesNotContain(sets, t => t.IsGenericType && t.GetGenericArguments().Any(a => a == typeof(Dhanvi.Modules.Ledger.Domain.JournalLine) || a == typeof(Dhanvi.Modules.Ledger.Domain.JournalEntry)));
        var ledger = typeof(Dhanvi.Modules.Ledger.Application.LedgerPostingRules).Assembly;
        Assert.DoesNotContain(ledger.GetReferencedAssemblies(), a => a.Name!.Contains("Auctions", StringComparison.Ordinal) || a.Name!.Contains("RandomDraws", StringComparison.Ordinal));
    }
}
