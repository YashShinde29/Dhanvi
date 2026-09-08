using Microsoft.EntityFrameworkCore;
using Dhanvi.Modules.Identity.Domain.Roles;
using Dhanvi.Modules.Identity.Domain.Tokens;
using Dhanvi.Modules.Identity.Domain.Users;

namespace Dhanvi.Modules.Identity.Infrastructure.Persistence;

public sealed class IdentityDbContext(DbContextOptions<IdentityDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Role> Roles => Set<Role>();
    public DbSet<UserRole> UserRoles => Set<UserRole>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<PasswordResetToken> PasswordResetTokens => Set<PasswordResetToken>();
    public DbSet<EmailVerificationToken> EmailVerificationTokens => Set<EmailVerificationToken>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("identity");
        ConfigureUser(modelBuilder);
        ConfigureRole(modelBuilder);
        ConfigureTokens(modelBuilder);
    }

    private static void ConfigureUser(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.FirstName).HasMaxLength(100).IsRequired();
            entity.Property(item => item.LastName).HasMaxLength(100).IsRequired();
            entity.Property(item => item.Email).HasMaxLength(320).IsRequired();
            entity.Property(item => item.NormalizedEmail).HasMaxLength(320).IsRequired();
            entity.Property(item => item.PhoneNumber).HasMaxLength(32);
            entity.Property(item => item.PasswordHash).HasMaxLength(1000).IsRequired();
            entity.HasIndex(item => item.NormalizedEmail).IsUnique();
            entity.Ignore(item => item.DomainEvents);
            entity.HasMany(item => item.UserRoles).WithOne().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.Navigation(item => item.UserRoles).UsePropertyAccessMode(PropertyAccessMode.Field);
        });

        modelBuilder.Entity<UserRole>(entity =>
        {
            entity.ToTable("user_roles");
            entity.HasKey(item => new { item.UserId, item.RoleId });
            entity.HasOne(item => item.Role).WithMany().HasForeignKey(item => item.RoleId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(item => item.RoleId);
        });
    }

    private static void ConfigureRole(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Role>(entity =>
        {
            entity.ToTable("roles");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Name).HasMaxLength(50).IsRequired();
            entity.HasIndex(item => item.Name).IsUnique();
        });
    }

    private static void ConfigureTokens(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<RefreshToken>(entity =>
        {
            entity.ToTable("refresh_tokens");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.TokenHash).HasMaxLength(64).IsRequired();
            entity.Property(item => item.CreatedByIp).HasMaxLength(64);
            entity.Property(item => item.RevokedByIp).HasMaxLength(64);
            entity.HasIndex(item => item.TokenHash).IsUnique();
            entity.HasIndex(item => item.UserId);
            entity.HasOne<User>().WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<PasswordResetToken>(entity =>
        {
            entity.ToTable("password_reset_tokens");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.TokenHash).HasMaxLength(64).IsRequired();
            entity.HasIndex(item => item.TokenHash).IsUnique();
            entity.HasIndex(item => item.UserId);
            entity.HasOne<User>().WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<EmailVerificationToken>(entity =>
        {
            entity.ToTable("email_verification_tokens");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.TokenHash).HasMaxLength(64).IsRequired();
            entity.HasIndex(item => item.TokenHash).IsUnique();
            entity.HasIndex(item => item.UserId);
            entity.HasOne<User>().WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.Cascade);
        });
    }
}
