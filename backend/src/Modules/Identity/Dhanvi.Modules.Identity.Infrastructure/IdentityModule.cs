using Dhanvi.Modules.Identity.Application.Abstractions;
using Dhanvi.Modules.Identity.Application.Configuration;
using Dhanvi.Modules.Identity.Domain.Users;
using Dhanvi.Modules.Identity.Infrastructure.Email;
using Dhanvi.Modules.Identity.Infrastructure.Persistence;
using Dhanvi.Modules.Identity.Infrastructure.Security;
using Dhanvi.Modules.Identity.Infrastructure.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql;

namespace Dhanvi.Modules.Identity.Infrastructure;

public static class IdentityModule
{
    public static IServiceCollection AddIdentityModule(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<JwtOptions>().Bind(configuration.GetSection(JwtOptions.SectionName))
            .Validate(options => options.SigningKey.Length >= 32, "Jwt:SigningKey must contain at least 32 characters.")
            .ValidateOnStart();
        services.Configure<PasswordPolicyOptions>(configuration.GetSection(PasswordPolicyOptions.SectionName));
        services.AddDbContext<IdentityDbContext>((provider, options) => options.UseNpgsql(
            provider.GetRequiredService<NpgsqlConnection>(),
            npgsql => npgsql.MigrationsHistoryTable("__ef_migrations_history", "identity")));
        services.AddScoped<IPasswordHasher<User>, PasswordHasher<User>>();
        services.AddScoped<PasswordRulesValidator>();
        services.AddScoped<TokenService>();
        services.TryAddScoped<IEmailSender, NullEmailSender>();
        services.AddScoped<IIdentityService, IdentityService>();
        services.AddScoped<IGroupUserDirectory, GroupUserDirectory>();
        services.AddScoped<IdentitySeeder>();
        return services;
    }
}
