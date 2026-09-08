using System.Net.Mail;
using System.Text.RegularExpressions;
using Dhanvi.Modules.Identity.Application.Contracts;
using Dhanvi.Modules.Identity.Infrastructure.Security;
using Dhanvi.SharedKernel.Exceptions;

namespace Dhanvi.Modules.Identity.Infrastructure.Services;

internal static partial class IdentityInputValidator
{
    [GeneratedRegex(@"^\+?[0-9 ()-]{7,20}$", RegexOptions.CultureInvariant)]
    private static partial Regex PhonePattern();

    public static void Validate(RegisterRequest request, PasswordRulesValidator passwords)
    {
        var errors = CommonProfileErrors(request.FirstName, request.LastName, request.PhoneNumber);
        if (!MailAddress.TryCreate(request.Email, out _)) errors["email"] = ["A valid email is required."];
        var passwordErrors = passwords.Validate(request.Password);
        if (passwordErrors.Length > 0) errors["password"] = passwordErrors;
        ThrowIfAny(errors);
    }

    public static void Validate(UpdateProfileRequest request) => ThrowIfAny(CommonProfileErrors(request.FirstName, request.LastName, request.PhoneNumber));

    public static void ValidatePassword(string password, PasswordRulesValidator passwords)
    {
        var errors = passwords.Validate(password);
        if (errors.Length > 0) throw new RequestValidationException(new Dictionary<string, string[]> { ["newPassword"] = errors });
    }

    private static Dictionary<string, string[]> CommonProfileErrors(string firstName, string lastName, string? phone)
    {
        var errors = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(firstName)) errors["firstName"] = ["First name is required."];
        if (string.IsNullOrWhiteSpace(lastName)) errors["lastName"] = ["Last name is required."];
        if (!string.IsNullOrWhiteSpace(phone) && !PhonePattern().IsMatch(phone)) errors["phoneNumber"] = ["Phone number format is invalid."];
        return errors;
    }

    private static void ThrowIfAny(Dictionary<string, string[]> errors)
    {
        if (errors.Count > 0) throw new RequestValidationException(errors);
    }
}
