namespace Dhanvi.Modules.Identity.Application.Abstractions;

public sealed record GroupUserInfo(Guid Id, string Name, string Email, string? Phone, bool Verified, DateTimeOffset MemberSince);
public interface IGroupUserDirectory
{
    Task<GroupUserInfo?> FindAsync(Guid userId, CancellationToken cancellationToken);
}
