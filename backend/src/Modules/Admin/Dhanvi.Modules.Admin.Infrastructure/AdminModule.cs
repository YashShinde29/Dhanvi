using Dhanvi.Modules.Admin.Application;
using Microsoft.Extensions.DependencyInjection;
namespace Dhanvi.Modules.Admin.Infrastructure;

public static class AdminModule
{
    /// <summary>Registers the composing service. The per-module readers are registered by their own modules.</summary>
    public static IServiceCollection AddAdminModule(this IServiceCollection services)
    {
        services.AddScoped<IAdminOperationsService, AdminOperationsService>();
        return services;
    }
}
