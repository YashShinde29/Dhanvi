using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.Groups.Infrastructure;
using Microsoft.Extensions.Configuration;

namespace Dhanvi.IntegrationTests.Api;

public sealed class GroupPolicyConfigurationTests
{
    [Theory]
    [InlineData("Development", 2)] [InlineData("Test", 2)] [InlineData("Testing", 2)]
    [InlineData("Production", 20)] [InlineData("Staging", 20)]
    public void EnvironmentDefaults(string environment, int minimum)
    {
        var policy = GroupPolicyOptions.Resolve(new ConfigurationBuilder().Build(), environment);
        Assert.Equal(minimum, policy.MinimumMembers);
        Assert.Equal(50, policy.MaximumMembers);
    }

    [Theory]
    [InlineData("Production", 2, 50)] [InlineData("Staging", 2, 50)]
    [InlineData("Production", 20, 51)]
    public void ProductionCannotBeConfiguredWithDevelopmentLimits(string environment, int minimum, int maximum)
    {
        Assert.Throws<InvalidOperationException>(() => GroupPolicyOptions.Resolve(Configuration(minimum, maximum), environment));
    }

    [Theory] [InlineData(1, 50)] [InlineData(2, 51)] [InlineData(51, 50)]
    public void DevelopmentCannotExceedDatabaseSafeRange(int minimum, int maximum) =>
        Assert.Throws<ArgumentOutOfRangeException>(() => GroupPolicyOptions.Resolve(Configuration(minimum, maximum), "Development"));

    [Fact]
    public void DevelopmentConfigurationMapsToPureDomainPolicy() =>
        Assert.Equal(GroupMemberPolicy.Development, GroupPolicyOptions.Resolve(Configuration(2, 50), "Development"));

    private static IConfiguration Configuration(int minimum, int maximum) => new ConfigurationBuilder().AddInMemoryCollection(
        new Dictionary<string, string?> { ["GroupPolicy:MinimumMembers"] = minimum.ToString(System.Globalization.CultureInfo.InvariantCulture), ["GroupPolicy:MaximumMembers"] = maximum.ToString(System.Globalization.CultureInfo.InvariantCulture) }).Build();
}
