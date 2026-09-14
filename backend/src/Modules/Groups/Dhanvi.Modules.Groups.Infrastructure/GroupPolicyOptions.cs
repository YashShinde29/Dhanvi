using Dhanvi.Modules.Groups.Domain;
using Microsoft.Extensions.Configuration;

namespace Dhanvi.Modules.Groups.Infrastructure;

public static class GroupPolicyOptions
{
    public const string SectionName = "GroupPolicy";

    public static GroupMemberPolicy Resolve(IConfiguration configuration, string environmentName)
    {
        var development = environmentName.Equals("Development", StringComparison.OrdinalIgnoreCase)
            || environmentName.Equals("Test", StringComparison.OrdinalIgnoreCase)
            || environmentName.Equals("Testing", StringComparison.OrdinalIgnoreCase);
        var defaults = development ? GroupMemberPolicy.Development : GroupMemberPolicy.Production;
        var section = configuration.GetSection(SectionName);
        var minimum = section.GetValue<int?>("MinimumMembers") ?? defaults.MinimumMembers;
        var maximum = section.GetValue<int?>("MaximumMembers") ?? defaults.MaximumMembers;
        if (!development && (minimum != GroupMemberPolicy.Production.MinimumMembers || maximum != GroupMemberPolicy.Production.MaximumMembers))
            throw new InvalidOperationException("Outside Development/Test/Testing, GroupPolicy must remain 20–50 members.");
        return new GroupMemberPolicy(minimum, maximum);
    }
}
