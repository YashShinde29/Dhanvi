using Dhanvi.Modules.Audit.Domain;
using Microsoft.EntityFrameworkCore;

namespace Dhanvi.Modules.Audit.Infrastructure.Persistence;

public sealed class AuditDbContext(DbContextOptions<AuditDbContext> options) : DbContext(options)
{
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("audit");
        modelBuilder.Entity<AuditLog>(entity =>
        {
            entity.ToTable("audit_logs");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Action).HasMaxLength(100).IsRequired();
            entity.Property(item => item.EntityType).HasMaxLength(100).IsRequired();
            entity.Property(item => item.EntityId).HasMaxLength(100).IsRequired();
            entity.Property(item => item.CorrelationId).HasMaxLength(100);
            entity.HasIndex(item => item.Timestamp);
            entity.HasIndex(item => new { item.EntityType, item.EntityId });
        });
    }
}

