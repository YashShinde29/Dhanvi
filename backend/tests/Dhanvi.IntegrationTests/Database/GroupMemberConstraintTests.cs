using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.Groups.Infrastructure.Persistence;
using Dhanvi.Modules.Identity.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Dhanvi.IntegrationTests.Database;

public sealed class GroupMemberConstraintTests
{
    [Fact]
    public async Task NewMigrationWidensOnlyMemberRangesAndPreservesExistingGroups()
    {
        await using var postgres = new TestPostgres();
        await postgres.StartAsync();
        await using var identities = new IdentityDbContext(new DbContextOptionsBuilder<IdentityDbContext>()
            .UseNpgsql(postgres.GetConnectionString(), npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "identity")).Options);
        await identities.Database.MigrateAsync();
        var options = new DbContextOptionsBuilder<GroupsDbContext>().UseNpgsql(postgres.GetConnectionString(),
            npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "groups")).Options;
        await using var db = new GroupsDbContext(options);
        var migrator = db.GetService<IMigrator>();
        await migrator.MigrateAsync("20260914061232_PayoutCycleCompletion");
        var before = await Constraints(db);
        Assert.Equal(4, before.Count);
        Assert.All(before.Values, definition => Assert.Contains(">= 20", definition));
        var now = DateTimeOffset.UtcNow;
        var owner = Dhanvi.Modules.Identity.Domain.Users.User.Create("Policy", "Test", "policy@example.test", "POLICY@EXAMPLE.TEST", null, now);
        identities.Users.Add(owner); await identities.SaveChangesAsync();
        var production = Group.Create("Existing production", "", GroupCreatorType.Platform, owner.Id,
            new(GroupType.Random, 50000, 20, false, false, 1, 2, 2, DateOnly.FromDateTime(now.UtcDateTime).AddMonths(1)), false, now);
        db.Groups.Add(production); await db.SaveChangesAsync();
        await migrator.MigrateAsync();
        var after = await Constraints(db);
        Assert.All(before, constraint => Assert.Equal(constraint.Value.Replace(">= 20", ">= 2", StringComparison.Ordinal), after[constraint.Key]));
        Assert.Equal(20, (await db.Groups.AsNoTracking().SingleAsync()).MemberLimit);
        var small = Group.Create("Development", "", GroupCreatorType.Platform, owner.Id,
            production.Rules with { MemberLimit = 2 }, false, now, GroupMemberPolicy.Development);
        db.Groups.Add(small); await db.SaveChangesAsync();
        Assert.Equal(2, await db.Groups.CountAsync());
        foreach (var invalid in new[] { 1, 51 })
        {
            // Keep all money/duration invariants valid; only the safe member range must reject this SQL.
            var exception = await Assert.ThrowsAsync<Npgsql.PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync(
                $"UPDATE groups.\"Groups\" SET \"Rules\" = jsonb_set(jsonb_set(\"Rules\", '{{MemberLimit}}', to_jsonb({invalid})), '{{GroupValue}}', to_jsonb({invalid * 2500})), \"MemberLimit\" = {invalid}, \"GroupValue\" = {invalid * 2500}, \"DurationMonths\" = {invalid}, \"MonthlyContribution\" = 2500 WHERE \"Id\" = {small.Id}"));
            Assert.Equal("CK_Group_Rules", exception.ConstraintName);
        }
    }

    private static async Task<Dictionary<string, string>> Constraints(GroupsDbContext db)
    {
        await db.Database.OpenConnectionAsync();
        await using var command = db.Database.GetDbConnection().CreateCommand();
        command.CommandText = "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace = 'groups'::regnamespace AND conname IN ('CK_Group_Rules', 'CK_Cycle_Expected', 'CK_Auction_Rules', 'CK_AuctionResult_Money')";
        await using var reader = await command.ExecuteReaderAsync();
        var result = new Dictionary<string, string>();
        while (await reader.ReadAsync()) result.Add(reader.GetString(0), reader.GetString(1));
        return result;
    }
}
