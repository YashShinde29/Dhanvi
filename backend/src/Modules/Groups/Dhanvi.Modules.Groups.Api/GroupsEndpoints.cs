using Microsoft.AspNetCore.Routing;

namespace Dhanvi.Modules.Groups.Api;

public static class GroupsEndpoints
{
    public static IEndpointRouteBuilder MapGroupsEndpoints(this IEndpointRouteBuilder endpoints)
    {
        // Group endpoints will be added here and will delegate to Application use cases.
        return endpoints;
    }
}

