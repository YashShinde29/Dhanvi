using Dhanvi.Modules.Identity.Application.Configuration;
using Microsoft.Extensions.Options;

namespace Dhanvi.Modules.Identity.Infrastructure.Security;

public sealed class PasswordRulesValidator(IOptions<PasswordPolicyOptions> options)
{
    private readonly PasswordPolicyOptions _options = options.Value;

    public string[] Validate(string password)
    {
        var errors = new List<string>();
        if (password.Length < _options.MinimumLength) errors.Add($"Password must contain at least {_options.MinimumLength} characters.");
        if (_options.RequireUppercase && !password.Any(char.IsUpper)) errors.Add("Password must contain an uppercase letter.");
        if (_options.RequireLowercase && !password.Any(char.IsLower)) errors.Add("Password must contain a lowercase letter.");
        if (_options.RequireDigit && !password.Any(char.IsDigit)) errors.Add("Password must contain a number.");
        if (_options.RequireSpecialCharacter && password.All(char.IsLetterOrDigit)) errors.Add("Password must contain a special character.");
        return [.. errors];
    }
}

