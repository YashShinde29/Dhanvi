using Dhanvi.SharedKernel.Domain;

namespace Dhanvi.Modules.Identity.Domain.Roles;

public sealed class Role : Entity<Guid>
{
    private Role() : base(Guid.Empty) { }
    private Role(Guid id, string name) : base(id) => Name = name;

    public string Name { get; private set; } = string.Empty;

    public static Role Create(string name) => new(Guid.NewGuid(), name.Trim().ToUpperInvariant());
}

