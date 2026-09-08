namespace Dhanvi.Modules.Identity.Application;

public static class AuthorizationPolicies
{
    public const string AuthenticatedUser = "AuthenticatedUser";
    public const string OrganizerOnly = "OrganizerOnly";
    public const string AdminOnly = "AdminOnly";
    public const string SuperAdminOnly = "SuperAdminOnly";
}

