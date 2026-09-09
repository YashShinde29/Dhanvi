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
        typeof(Dhanvi.Modules.Cycles.Domain.MonthlyCycle),
        typeof(Dhanvi.Modules.Contributions.Domain.Contribution),
        typeof(Dhanvi.Modules.RandomDraws.Domain.SelectionResult),
        typeof(AuditLog),
        typeof(IdentityModuleMarker),
        typeof(GroupsModuleMarker),
        typeof(OrganizerApplication),
    };
}
