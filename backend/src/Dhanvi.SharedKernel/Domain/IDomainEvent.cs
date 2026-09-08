namespace Dhanvi.SharedKernel.Domain;

public interface IDomainEvent
{
    DateTimeOffset OccurredAtUtc { get; }
}

