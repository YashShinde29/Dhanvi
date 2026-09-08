namespace Dhanvi.SharedKernel.Exceptions;

public sealed class RequestValidationException(IReadOnlyDictionary<string, string[]> errors)
    : DhanviException("One or more validation errors occurred.")
{
    public IReadOnlyDictionary<string, string[]> Errors { get; } = errors;
}

