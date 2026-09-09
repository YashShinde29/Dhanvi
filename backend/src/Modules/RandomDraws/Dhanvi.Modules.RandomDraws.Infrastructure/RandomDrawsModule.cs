using System.Security.Cryptography;
using Dhanvi.Modules.RandomDraws.Application;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
namespace Dhanvi.Modules.RandomDraws.Infrastructure;

public sealed class CryptographicRandomSource : ISecureRandomSource
{
    public string SourceType => "DOTNET_RANDOM_NUMBER_GENERATOR";
    public byte[] CreateSeed() { var seed = new byte[32]; RandomNumberGenerator.Fill(seed); return seed; }
}
public static class RandomDrawsModule
{
    public static IServiceCollection AddRandomDrawsModule(this IServiceCollection services)
    {
        services.TryAddSingleton<ISecureRandomSource, CryptographicRandomSource>(); services.AddScoped<ISelectionService, SelectionService>(); return services;
    }
}
