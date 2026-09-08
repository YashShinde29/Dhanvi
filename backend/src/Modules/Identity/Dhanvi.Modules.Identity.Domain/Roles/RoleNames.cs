namespace Dhanvi.Modules.Identity.Domain.Roles;

public static class RoleNames
{
    public const string User = "USER";
    public const string Organizer = "ORGANIZER";
    public const string Admin = "ADMIN";
    public const string SuperAdmin = "SUPER_ADMIN";

    public static readonly IReadOnlyCollection<string> All = [User, Organizer, Admin, SuperAdmin];
}

