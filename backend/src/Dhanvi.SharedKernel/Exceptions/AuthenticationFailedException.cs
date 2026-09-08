namespace Dhanvi.SharedKernel.Exceptions;

public sealed class AuthenticationFailedException : DhanviException
{
    public AuthenticationFailedException() : base("Invalid email or password.") { }
}

