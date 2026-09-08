namespace Dhanvi.SharedKernel.Time;

public interface IDateTimeProvider
{
    DateTimeOffset UtcNow { get; }
}

