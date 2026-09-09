namespace Dhanvi.SharedKernel.Exceptions;

public sealed class BusinessRuleException(string code, string message) : DhanviException(message)
{
    public string Code { get; } = code;
    public static void Require(bool condition, string code, string message)
    {
        if (!condition) throw new BusinessRuleException(code, message);
    }
}
