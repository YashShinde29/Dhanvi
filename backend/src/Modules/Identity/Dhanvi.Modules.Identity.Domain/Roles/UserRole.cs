namespace Dhanvi.Modules.Identity.Domain.Roles;

public sealed class UserRole
{
    private UserRole() { }
    private UserRole(Guid userId, Guid roleId, DateTimeOffset assignedAt) => (UserId, RoleId, AssignedAt) = (userId, roleId, assignedAt);

    public Guid UserId { get; private set; }
    public Guid RoleId { get; private set; }
    public DateTimeOffset AssignedAt { get; private set; }
    public Role Role { get; private set; } = null!;

    public static UserRole Create(Guid userId, Guid roleId, DateTimeOffset assignedAt) => new(userId, roleId, assignedAt);
}

