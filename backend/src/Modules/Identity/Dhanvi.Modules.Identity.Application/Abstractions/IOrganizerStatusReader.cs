namespace Dhanvi.Modules.Identity.Application.Abstractions;

public interface IOrganizerStatusReader
{
    Task<string> GetStatusAsync(Guid userId, CancellationToken cancellationToken);
}

