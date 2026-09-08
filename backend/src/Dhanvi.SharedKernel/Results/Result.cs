namespace Dhanvi.SharedKernel.Results;

public class Result
{
    protected Result(bool isSuccess, ResultError error)
    {
        if (isSuccess == (error != ResultError.None)) throw new ArgumentException("A result's success state and error must agree.", nameof(error));
        IsSuccess = isSuccess;
        Error = error;
    }

    public bool IsSuccess { get; }
    public bool IsFailure => !IsSuccess;
    public ResultError Error { get; }

    public static Result Success() => new(true, ResultError.None);
    public static Result Failure(ResultError error) => new(false, error);
    public static Result<T> Success<T>(T value) => new(value);
    public static Result<T> Failure<T>(ResultError error) => new(error);
}

public sealed class Result<T> : Result
{
    private readonly T? _value;

    internal Result(T value) : base(true, ResultError.None) => _value = value;
    internal Result(ResultError error) : base(false, error) { }

    public T Value => IsSuccess ? _value! : throw new InvalidOperationException("A failed result has no value.");
}
