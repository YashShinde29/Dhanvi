namespace Dhanvi.SharedKernel.Results;

public sealed record ResultError(string Code, string Description)
{
    public static readonly ResultError None = new(string.Empty, string.Empty);
}
