using Dhanvi.Modules.Payouts.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
namespace Dhanvi.Modules.Payouts.Infrastructure.Persistence;
public sealed class PayoutsDbContext(DbContextOptions<PayoutsDbContext> options) : DbContext(options)
{
    public DbSet<PayoutBeneficiary> Beneficiaries => Set<PayoutBeneficiary>();
    public DbSet<PayoutObligation> Obligations => Set<PayoutObligation>();
    public DbSet<PayoutAttempt> Attempts => Set<PayoutAttempt>();
    public DbSet<PayoutProviderEvent> Events => Set<PayoutProviderEvent>();
    public DbSet<PayoutHistory> History => Set<PayoutHistory>();
    public DbSet<FakeProviderPayout> FakePayouts => Set<FakeProviderPayout>();
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var m = modelBuilder;
        m.HasDefaultSchema("payouts");
        var b = m.Entity<PayoutBeneficiary>(); b.ToTable("PayoutBeneficiaries"); b.HasKey(x => x.Id);
        b.HasIndex(x => new { x.UserId, x.CreatedAt }); b.HasIndex(x => x.ProviderFundAccountId).IsUnique(); b.Property(x => x.Status).HasConversion<string>();
        b.Property(x => x.MaskedAccountNumber).HasMaxLength(8); b.Property(x => x.Ifsc).HasMaxLength(11);
        var p = m.Entity<PayoutObligation>(); p.ToTable("PayoutObligations", t => {
            t.HasCheckConstraint("CK_Payout_Money", "\"Amount\" > 0 AND \"Currency\" = 'INR'");
            t.HasCheckConstraint("CK_Payout_Settled", "(\"Status\" = 'Succeeded') = (\"SettledAt\" IS NOT NULL AND \"SettlementJournalId\" IS NOT NULL)");
            t.HasCheckConstraint("CK_Payout_Recipient", "(\"PayoutType\" = 'PlatformFeeSettlement' AND \"UserId\" IS NULL AND \"MembershipId\" IS NULL) OR (\"PayoutType\" IN ('WinnerPayout','MemberAuctionBenefit') AND \"UserId\" IS NOT NULL AND \"MembershipId\" IS NOT NULL)");
        }); p.HasKey(x => x.Id); p.Property(x => x.Status).HasConversion<string>(); p.Property(x => x.PayoutType).HasConversion<string>(); p.Property(x => x.Version).IsConcurrencyToken();
        p.HasIndex(x => new { x.CycleId, x.PayoutType, x.SourceId }).IsUnique();
        p.HasIndex(x => new { x.CycleId, x.PayoutType }).IsUnique().HasFilter("\"PayoutType\" IN ('WinnerPayout','PlatformFeeSettlement')");
        p.HasIndex(x => new { x.CycleId, x.MembershipId }).IsUnique().HasFilter("\"PayoutType\" = 'MemberAuctionBenefit'");
        p.HasIndex(x => x.UserId); p.HasIndex(x => x.GroupId); p.HasIndex(x => x.Status);
        p.HasOne<PayoutBeneficiary>().WithMany().HasForeignKey(x => x.BeneficiaryId).OnDelete(DeleteBehavior.Restrict);
        var a = m.Entity<PayoutAttempt>(); a.ToTable("PayoutAttempts", t => t.HasCheckConstraint("CK_Attempt_Money", "\"Amount\" > 0 AND \"Currency\" = 'INR' AND \"Provider\" = 'FAKE'")); a.HasKey(x => x.Id);
        a.HasIndex(x => new { x.PayoutObligationId, x.AttemptNumber }).IsUnique(); a.HasIndex(x => new { x.PayoutObligationId, x.RequestKey }).IsUnique();
        a.HasIndex(x => x.ProviderPayoutId).IsUnique(); a.HasIndex(x => x.IdempotencyKey).IsUnique();
        a.HasOne<PayoutObligation>().WithMany().HasForeignKey(x => x.PayoutObligationId).OnDelete(DeleteBehavior.Restrict);
        a.HasOne<PayoutBeneficiary>().WithMany().HasForeignKey(x => x.BeneficiaryId).OnDelete(DeleteBehavior.Restrict);
        var e = m.Entity<PayoutProviderEvent>(); e.ToTable("PayoutProviderEvents"); e.HasKey(x => x.Id); e.Property(x => x.Status).HasConversion<string>();
        e.HasIndex(x => new { x.Provider, x.ProviderEventId }).IsUnique(); e.Property(x => x.PayloadHash).HasMaxLength(64);
        e.HasOne<PayoutAttempt>().WithMany().HasForeignKey(x => x.PayoutAttemptId).OnDelete(DeleteBehavior.Restrict);
        e.HasOne<PayoutObligation>().WithMany().HasForeignKey(x => x.PayoutObligationId).OnDelete(DeleteBehavior.Restrict);
        var h = m.Entity<PayoutHistory>(); h.ToTable("PayoutReconciliationHistory"); h.HasKey(x => x.Id); h.HasIndex(x => new { x.PayoutObligationId, x.CreatedAt });
        h.HasOne<PayoutObligation>().WithMany().HasForeignKey(x => x.PayoutObligationId).OnDelete(DeleteBehavior.Restrict);
        var f = m.Entity<FakeProviderPayout>(); f.ToTable("FakeProviderPayouts"); f.HasKey(x => x.Id); f.HasIndex(x => x.IdempotencyKey).IsUnique(); f.Property(x => x.Status).HasConversion<string>();
        foreach (var entity in m.Model.GetEntityTypes()) foreach (var property in entity.GetProperties().Where(p => p.ClrType == typeof(decimal))) { property.SetPrecision(18); property.SetScale(2); }
    }
    private void Guard()
    {
        if (ChangeTracker.Entries().Any(e => e.State == EntityState.Deleted || e.State == EntityState.Modified && e.Entity is PayoutBeneficiary or PayoutAttempt or PayoutProviderEvent or PayoutHistory))
            throw new InvalidOperationException("Payout destinations, intents and observations are append-only.");
    }
    public override int SaveChanges(bool acceptAllChangesOnSuccess) { Guard(); return base.SaveChanges(acceptAllChangesOnSuccess); }
    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default) { Guard(); return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken); }
}
public sealed class PayoutsDbContextFactory : IDesignTimeDbContextFactory<PayoutsDbContext>
{
    public PayoutsDbContext CreateDbContext(string[] args) => new(new DbContextOptionsBuilder<PayoutsDbContext>()
        .UseNpgsql(Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection") ?? "Host=localhost;Database=dhanvi;Username=dhanvi;Password=dhanvi",
            n => n.MigrationsHistoryTable("__EFMigrationsHistory", "payouts")).Options);
}
