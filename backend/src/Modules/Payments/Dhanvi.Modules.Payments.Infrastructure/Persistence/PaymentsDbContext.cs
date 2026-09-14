using Dhanvi.Modules.Payments.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
namespace Dhanvi.Modules.Payments.Infrastructure.Persistence;

public sealed class PaymentsDbContext(DbContextOptions<PaymentsDbContext> options) : DbContext(options)
{
    public DbSet<Payment> Payments => Set<Payment>();
    public DbSet<PaymentProviderEvent> Events => Set<PaymentProviderEvent>();
    public DbSet<PaymentHistory> History => Set<PaymentHistory>();
    public DbSet<PaymentRefund> Refunds => Set<PaymentRefund>();
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("payments");
        var p = modelBuilder.Entity<Payment>();
        p.ToTable("Payments", t => {
            t.HasCheckConstraint("CK_Payment_Money", "\"Amount\" > 0 AND \"Currency\" = 'INR' AND \"Environment\" = 'TEST' AND \"Provider\" = 'RAZORPAY'");
            t.HasCheckConstraint("CK_Payment_Settled", "\"SettledAt\" IS NULL OR (\"CapturedAt\" IS NOT NULL AND \"JournalId\" IS NOT NULL AND \"ProviderPaymentId\" IS NOT NULL)");
        });
        p.HasKey(x => x.Id); p.Property(x => x.Amount).HasPrecision(18, 2); p.Property(x => x.Version).IsConcurrencyToken();
        p.Property(x => x.Status).HasConversion<string>(); p.Property(x => x.ReconciliationStatus).HasConversion<string>();
        p.HasIndex(x => x.ProviderOrderId).IsUnique(); p.HasIndex(x => x.ProviderPaymentId).IsUnique(); p.HasIndex(x => x.Receipt).IsUnique();
        p.HasIndex(x => new { x.ContributionId, x.IdempotencyKey }).IsUnique();
        p.HasIndex(x => new { x.ContributionId, x.AttemptNumber }).IsUnique();
        p.HasIndex(x => x.ContributionId).IsUnique().HasFilter("\"RefundedAt\" IS NULL");
        p.HasIndex(x => x.UserId); p.HasIndex(x => x.GroupId); p.HasIndex(x => x.CycleId); p.HasIndex(x => x.MembershipId);
        p.HasIndex(x => x.Status); p.HasIndex(x => x.ReconciliationStatus);
        p.Property(x => x.ProviderOrderId).HasMaxLength(100); p.Property(x => x.ProviderPaymentId).HasMaxLength(100);
        p.Property(x => x.IdempotencyKey).HasMaxLength(200); p.Property(x => x.Receipt).HasMaxLength(40);
        var e = modelBuilder.Entity<PaymentProviderEvent>(); e.ToTable("PaymentProviderEvents"); e.HasKey(x => x.Id);
        e.Property(x => x.EventKey).HasMaxLength(200); e.Property(x => x.PayloadHash).HasMaxLength(64); e.HasIndex(x => new { x.Provider, x.EventKey }).IsUnique();
        e.HasOne<Payment>().WithMany().HasForeignKey(x => x.PaymentId).OnDelete(DeleteBehavior.Restrict);
        var h = modelBuilder.Entity<PaymentHistory>(); h.ToTable("PaymentHistory"); h.HasKey(x => x.Id); h.HasIndex(x => new { x.PaymentId, x.CreatedAt });
        h.HasOne<Payment>().WithMany().HasForeignKey(x => x.PaymentId).OnDelete(DeleteBehavior.Restrict);
        var r = modelBuilder.Entity<PaymentRefund>(); r.ToTable("PaymentRefunds"); r.HasKey(x => x.Id);
        r.Property(x => x.Amount).HasPrecision(18, 2); r.HasIndex(x => new { x.ProviderRefundId, x.Status }).IsUnique();
        r.HasOne<Payment>().WithMany().HasForeignKey(x => x.PaymentId).OnDelete(DeleteBehavior.Restrict);
    }
    private void Guard()
    {
        if (ChangeTracker.Entries().Any(e => e.State == EntityState.Deleted || e.State == EntityState.Modified &&
            e.Entity is PaymentProviderEvent or PaymentHistory or PaymentRefund))
            throw new InvalidOperationException("Payment history is append-only.");
    }
    public override int SaveChanges(bool acceptAllChangesOnSuccess) { Guard(); return base.SaveChanges(acceptAllChangesOnSuccess); }
    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    { Guard(); return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken); }
}
public sealed class PaymentsDbContextFactory : IDesignTimeDbContextFactory<PaymentsDbContext>
{
    public PaymentsDbContext CreateDbContext(string[] args) => new(new DbContextOptionsBuilder<PaymentsDbContext>()
        .UseNpgsql(System.Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection") ?? "Host=localhost;Database=dhanvi;Username=dhanvi;Password=dhanvi",
            n => n.MigrationsHistoryTable("__EFMigrationsHistory", "payments")).Options);
}
