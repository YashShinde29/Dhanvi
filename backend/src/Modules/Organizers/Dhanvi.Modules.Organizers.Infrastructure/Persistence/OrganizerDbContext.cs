using Dhanvi.Modules.Organizers.Domain;
using Microsoft.EntityFrameworkCore;

namespace Dhanvi.Modules.Organizers.Infrastructure.Persistence;

public sealed class OrganizerDbContext(DbContextOptions<OrganizerDbContext> options) : DbContext(options)
{
    public DbSet<OrganizerProfile> OrganizerProfiles => Set<OrganizerProfile>();
    public DbSet<OrganizerApplication> OrganizerApplications => Set<OrganizerApplication>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("organizers");
        modelBuilder.Entity<OrganizerProfile>(entity =>
        {
            entity.ToTable("organizer_profiles");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Status).HasConversion<string>().HasMaxLength(30).IsRequired();
            entity.HasIndex(item => item.UserId).IsUnique();
        });

        modelBuilder.Entity<OrganizerApplication>(entity =>
        {
            entity.ToTable("organizer_applications");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Status).HasConversion<string>().HasMaxLength(30).IsRequired();
            entity.Property(item => item.FullLegalName).HasMaxLength(200);
            entity.Property(item => item.Phone).HasMaxLength(32);
            entity.Property(item => item.Address).HasMaxLength(500).IsRequired();
            entity.Property(item => item.City).HasMaxLength(100).IsRequired();
            entity.Property(item => item.State).HasMaxLength(100).IsRequired();
            entity.Property(item => item.PostalCode).HasMaxLength(20).IsRequired();
            entity.Property(item => item.ReasonForBecomingOrganizer).HasMaxLength(1000).IsRequired();
            entity.Property(item => item.ExperienceDescription).HasMaxLength(2000);
            entity.Property(item => item.RejectionReason).HasMaxLength(1000);
            entity.Ignore(item => item.IsActive);
            entity.HasIndex(item => item.Status);
            entity.HasIndex(item => item.UserId);
            entity.HasIndex(item => new { item.UserId, item.Status });
        });
    }
}

