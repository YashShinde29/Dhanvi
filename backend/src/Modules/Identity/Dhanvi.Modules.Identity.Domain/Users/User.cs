using Dhanvi.Modules.Identity.Domain.Roles;
using Dhanvi.SharedKernel.Domain;

namespace Dhanvi.Modules.Identity.Domain.Users;

public sealed class User : AggregateRoot<Guid>
{
    private readonly List<UserRole> _userRoles = [];

    private User() : base(Guid.Empty) { }

    private User(Guid id, string firstName, string lastName, string email, string normalizedEmail, string? phoneNumber, DateTimeOffset now)
        : base(id)
    {
        FirstName = firstName;
        LastName = lastName;
        Email = email;
        NormalizedEmail = normalizedEmail;
        PhoneNumber = phoneNumber;
        IsActive = true;
        CreatedAt = now;
        UpdatedAt = now;
    }

    public string FirstName { get; private set; } = string.Empty;
    public string LastName { get; private set; } = string.Empty;
    public string Email { get; private set; } = string.Empty;
    public string NormalizedEmail { get; private set; } = string.Empty;
    public string? PhoneNumber { get; private set; }
    public string PasswordHash { get; private set; } = string.Empty;
    public bool EmailVerified { get; private set; }
    public bool PhoneVerified { get; private set; }
    public bool IsActive { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }
    public DateTimeOffset? LastLoginAt { get; private set; }
    public IReadOnlyCollection<UserRole> UserRoles => _userRoles.AsReadOnly();

    public static User Create(string firstName, string lastName, string email, string normalizedEmail, string? phoneNumber, DateTimeOffset now) =>
        new(Guid.NewGuid(), firstName.Trim(), lastName.Trim(), email.Trim(), normalizedEmail, NormalizePhone(phoneNumber), now);

    public void SetPasswordHash(string passwordHash, DateTimeOffset now)
    {
        PasswordHash = passwordHash;
        UpdatedAt = now;
    }

    public void UpdateProfile(string firstName, string lastName, string? phoneNumber, DateTimeOffset now)
    {
        FirstName = firstName.Trim();
        LastName = lastName.Trim();
        PhoneNumber = NormalizePhone(phoneNumber);
        UpdatedAt = now;
    }

    public void RecordSuccessfulLogin(DateTimeOffset now)
    {
        LastLoginAt = now;
        UpdatedAt = now;
    }

    public void AssignRole(Role role, DateTimeOffset now)
    {
        if (_userRoles.Any(item => item.RoleId == role.Id)) return;
        _userRoles.Add(UserRole.Create(Id, role.Id, now));
    }

    private static string? NormalizePhone(string? phoneNumber) => string.IsNullOrWhiteSpace(phoneNumber) ? null : phoneNumber.Trim();
}

