using Dhanvi.Modules.Audit.Application;
using Dhanvi.Modules.Audit.Domain;
using Dhanvi.Modules.Identity.Domain.Roles;
using Dhanvi.Modules.Identity.Domain.Users;
using Dhanvi.Modules.Identity.Infrastructure.Persistence;
using Dhanvi.SharedKernel.Time;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Dhanvi.Modules.Identity.Infrastructure;

public sealed class IdentitySeeder(
    IdentityDbContext dbContext,
    IPasswordHasher<User> passwordHasher,
    IAuditWriter auditWriter,
    IDateTimeProvider clock,
    IConfiguration configuration)
{
    public async Task SeedAsync(CancellationToken cancellationToken)
    {
        var rolesByName = await dbContext.Roles.ToDictionaryAsync(role => role.Name, StringComparer.Ordinal, cancellationToken);
        foreach (var roleName in RoleNames.All.Where(roleName => !rolesByName.ContainsKey(roleName)))
        {
            var role = Role.Create(roleName);
            dbContext.Roles.Add(role);
            rolesByName[roleName] = role;
        }
        await dbContext.SaveChangesAsync(cancellationToken);

        if (!bool.TryParse(configuration["DHANVI_SEED_ADMIN_ENABLED"], out var enabled) || !enabled) return;
        var email = configuration["DHANVI_SEED_ADMIN_EMAIL"];
        var password = configuration["DHANVI_SEED_ADMIN_PASSWORD"];
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
            throw new InvalidOperationException("Admin seeding is enabled but DHANVI_SEED_ADMIN_EMAIL or DHANVI_SEED_ADMIN_PASSWORD is missing.");

        var normalizedEmail = email.Trim().ToUpperInvariant();
        var user = await dbContext.Users.Include(item => item.UserRoles).SingleOrDefaultAsync(item => item.NormalizedEmail == normalizedEmail, cancellationToken);
        var now = clock.UtcNow;
        if (user is null)
        {
            user = User.Create("Dhanvi", "Administrator", email, normalizedEmail, null, now);
            user.SetPasswordHash(passwordHasher.HashPassword(user, password), now);
            dbContext.Users.Add(user);
            auditWriter.Add(user.Id, AuditActions.UserRegistered, nameof(User), user.Id.ToString(), now, null);
        }

        foreach (var roleName in new[] { RoleNames.User, RoleNames.SuperAdmin })
        {
            var role = rolesByName[roleName];
            if (user.UserRoles.Any(item => item.RoleId == role.Id)) continue;
            user.AssignRole(role, now);
            auditWriter.Add(user.Id, AuditActions.UserRoleAssigned, nameof(User), user.Id.ToString(), now, null);
        }
        await dbContext.SaveChangesAsync(cancellationToken);
        await auditWriter.SaveChangesAsync(cancellationToken);
    }
}

