using System.Net.Mail;
using Dhanvi.Modules.Audit.Application;
using Dhanvi.Modules.Audit.Domain;
using Dhanvi.Modules.Audit.Infrastructure.Persistence;
using Dhanvi.Modules.Identity.Application.Abstractions;
using Dhanvi.Modules.Identity.Application.Contracts;
using Dhanvi.Modules.Identity.Domain.Roles;
using Dhanvi.Modules.Identity.Domain.Tokens;
using Dhanvi.Modules.Identity.Domain.Users;
using Dhanvi.Modules.Identity.Infrastructure.Persistence;
using Dhanvi.Modules.Identity.Infrastructure.Security;
using Dhanvi.SharedKernel.Exceptions;
using Dhanvi.SharedKernel.Time;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Dhanvi.Modules.Identity.Infrastructure.Services;

internal sealed class IdentityService(
    IdentityDbContext dbContext,
    AuditDbContext auditDbContext,
    IAuditWriter auditWriter,
    IOrganizerStatusReader organizerStatusReader,
    IPasswordHasher<User> passwordHasher,
    PasswordRulesValidator passwordRules,
    TokenService tokenService,
    IEmailSender emailSender,
    IDateTimeProvider clock) : IIdentityService
{
    public async Task<RegisteredUserResponse> RegisterAsync(RegisterRequest request, string? ipAddress, string? correlationId, CancellationToken cancellationToken)
    {
        IdentityInputValidator.Validate(request, passwordRules);
        var normalizedEmail = NormalizeEmail(request.Email);
        if (await dbContext.Users.AnyAsync(user => user.NormalizedEmail == normalizedEmail, cancellationToken))
            throw new ConflictException("Email is already registered.");

        var userRole = await dbContext.Roles.SingleAsync(role => role.Name == RoleNames.User, cancellationToken);
        var now = clock.UtcNow;
        var user = User.Create(request.FirstName, request.LastName, request.Email, normalizedEmail, request.PhoneNumber, now);
        user.SetPasswordHash(passwordHasher.HashPassword(user, request.Password), now);
        user.AssignRole(userRole, now);

        await using var transaction = await BeginTransactionAsync(cancellationToken);
        dbContext.Users.Add(user);
        auditWriter.Add(user.Id, AuditActions.UserRegistered, nameof(User), user.Id.ToString(), now, correlationId);
        await SaveAllAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return new RegisteredUserResponse(user.Id, user.FirstName, user.LastName, user.Email, [RoleNames.User]);
    }

    public async Task<AuthenticationResponse> LoginAsync(LoginRequest request, string? ipAddress, string? correlationId, CancellationToken cancellationToken)
    {
        var normalizedEmail = NormalizeEmail(request.Email);
        var user = await UsersWithRoles().SingleOrDefaultAsync(item => item.NormalizedEmail == normalizedEmail, cancellationToken);
        if (user is null)
        {
            VerifyDummyPassword(request.Password);
            throw new AuthenticationFailedException();
        }

        var verification = passwordHasher.VerifyHashedPassword(user, user.PasswordHash, request.Password);
        if (verification == PasswordVerificationResult.Failed || !user.IsActive) throw new AuthenticationFailedException();

        var now = clock.UtcNow;
        if (verification == PasswordVerificationResult.SuccessRehashNeeded)
            user.SetPasswordHash(passwordHasher.HashPassword(user, request.Password), now);
        user.RecordSuccessfulLogin(now);

        await using var transaction = await BeginTransactionAsync(cancellationToken);
        var response = await IssueAuthenticationAsync(user, ipAddress, now, cancellationToken);
        auditWriter.Add(user.Id, AuditActions.UserLoginSuccess, nameof(User), user.Id.ToString(), now, correlationId);
        await SaveAllAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return response;
    }

    public async Task<AuthenticationResponse> RefreshAsync(string refreshToken, string? ipAddress, string? correlationId, CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        var tokenHash = TokenService.Hash(refreshToken);
        var storedToken = await dbContext.RefreshTokens.SingleOrDefaultAsync(item => item.TokenHash == tokenHash, cancellationToken);
        if (storedToken is null || storedToken.State(now) != RefreshTokenState.Active) throw new UnauthorizedAccessException("Invalid or expired refresh token.");

        var user = await UsersWithRoles().SingleAsync(item => item.Id == storedToken.UserId, cancellationToken);
        if (!user.IsActive) throw new UnauthorizedAccessException("The account is not active.");

        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        var replacementRaw = TokenService.CreateOpaqueToken();
        var replacement = RefreshToken.Create(user.Id, TokenService.Hash(replacementRaw), tokenService.RefreshTokenExpiresAt(now), now, ipAddress);
        storedToken.Revoke(now, ipAddress, replacement.Id);
        dbContext.RefreshTokens.Add(replacement);
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return await CreateAuthenticationResponseAsync(user, replacementRaw, now, cancellationToken);
    }

    public async Task LogoutAsync(string refreshToken, string? ipAddress, CancellationToken cancellationToken)
    {
        var storedToken = await dbContext.RefreshTokens.SingleOrDefaultAsync(item => item.TokenHash == TokenService.Hash(refreshToken), cancellationToken);
        if (storedToken is null) return;
        storedToken.Revoke(clock.UtcNow, ipAddress);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<CurrentUserResponse> GetCurrentUserAsync(Guid userId, CancellationToken cancellationToken)
    {
        var user = await UsersWithRoles().SingleOrDefaultAsync(item => item.Id == userId, cancellationToken)
            ?? throw new NotFoundException("User was not found.");
        return await MapCurrentUserAsync(user, cancellationToken);
    }

    public async Task<CurrentUserResponse> UpdateProfileAsync(Guid userId, UpdateProfileRequest request, CancellationToken cancellationToken)
    {
        IdentityInputValidator.Validate(request);
        var user = await UsersWithRoles().SingleOrDefaultAsync(item => item.Id == userId, cancellationToken)
            ?? throw new NotFoundException("User was not found.");
        user.UpdateProfile(request.FirstName, request.LastName, request.PhoneNumber, clock.UtcNow);
        await dbContext.SaveChangesAsync(cancellationToken);
        return await MapCurrentUserAsync(user, cancellationToken);
    }

    public async Task ChangePasswordAsync(Guid userId, ChangePasswordRequest request, string? correlationId, CancellationToken cancellationToken)
    {
        IdentityInputValidator.ValidatePassword(request.NewPassword, passwordRules);
        var user = await dbContext.Users.SingleOrDefaultAsync(item => item.Id == userId, cancellationToken)
            ?? throw new NotFoundException("User was not found.");
        if (passwordHasher.VerifyHashedPassword(user, user.PasswordHash, request.CurrentPassword) == PasswordVerificationResult.Failed)
            throw new RequestValidationException(new Dictionary<string, string[]> { ["currentPassword"] = ["Current password is incorrect."] });

        var now = clock.UtcNow;
        await using var transaction = await BeginTransactionAsync(cancellationToken);
        user.SetPasswordHash(passwordHasher.HashPassword(user, request.NewPassword), now);
        await RevokeAllTokensAsync(user.Id, now, cancellationToken);
        auditWriter.Add(user.Id, AuditActions.PasswordChanged, nameof(User), user.Id.ToString(), now, correlationId);
        await SaveAllAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task ForgotPasswordAsync(ForgotPasswordRequest request, CancellationToken cancellationToken)
    {
        if (!MailAddress.TryCreate(request.Email, out _)) return;
        var user = await dbContext.Users.SingleOrDefaultAsync(item => item.NormalizedEmail == NormalizeEmail(request.Email), cancellationToken);
        if (user is null || !user.IsActive) return;

        var now = clock.UtcNow;
        var rawToken = TokenService.CreateOpaqueToken();
        dbContext.PasswordResetTokens.Add(PasswordResetToken.Create(user.Id, TokenService.Hash(rawToken), tokenService.PasswordResetExpiresAt(now), now));
        await dbContext.SaveChangesAsync(cancellationToken);
        await emailSender.SendPasswordResetAsync(user.Email, rawToken, cancellationToken);
    }

    public async Task ResetPasswordAsync(ResetPasswordRequest request, string? correlationId, CancellationToken cancellationToken)
    {
        IdentityInputValidator.ValidatePassword(request.NewPassword, passwordRules);
        var now = clock.UtcNow;
        var resetToken = await dbContext.PasswordResetTokens.SingleOrDefaultAsync(item => item.TokenHash == TokenService.Hash(request.Token), cancellationToken);
        if (resetToken is null || !resetToken.CanUse(now))
            throw new RequestValidationException(new Dictionary<string, string[]> { ["token"] = ["Reset token is invalid or expired."] });
        var user = await dbContext.Users.SingleAsync(item => item.Id == resetToken.UserId, cancellationToken);

        await using var transaction = await BeginTransactionAsync(cancellationToken);
        resetToken.MarkUsed(now);
        user.SetPasswordHash(passwordHasher.HashPassword(user, request.NewPassword), now);
        await RevokeAllTokensAsync(user.Id, now, cancellationToken);
        auditWriter.Add(user.Id, AuditActions.PasswordReset, nameof(User), user.Id.ToString(), now, correlationId);
        await SaveAllAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    private IQueryable<User> UsersWithRoles() => dbContext.Users.Include(user => user.UserRoles).ThenInclude(userRole => userRole.Role);

    private async Task<AuthenticationResponse> IssueAuthenticationAsync(User user, string? ipAddress, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var rawRefreshToken = TokenService.CreateOpaqueToken();
        dbContext.RefreshTokens.Add(RefreshToken.Create(user.Id, TokenService.Hash(rawRefreshToken), tokenService.RefreshTokenExpiresAt(now), now, ipAddress));
        return await CreateAuthenticationResponseAsync(user, rawRefreshToken, now, cancellationToken);
    }

    private async Task<AuthenticationResponse> CreateAuthenticationResponseAsync(User user, string rawRefreshToken, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var roles = user.UserRoles.Select(item => item.Role.Name).Order(StringComparer.Ordinal).ToArray();
        var currentUser = new CurrentUserResponse(user.Id, user.FirstName, user.LastName, user.Email, user.PhoneNumber, user.EmailVerified, user.PhoneVerified, roles,
            await organizerStatusReader.GetStatusAsync(user.Id, cancellationToken), user.CreatedAt);
        return new AuthenticationResponse(tokenService.CreateAccessToken(user, roles, now), rawRefreshToken, tokenService.AccessTokenExpiresInSeconds, currentUser);
    }

    private async Task<CurrentUserResponse> MapCurrentUserAsync(User user, CancellationToken cancellationToken) =>
        new(user.Id, user.FirstName, user.LastName, user.Email, user.PhoneNumber, user.EmailVerified, user.PhoneVerified,
            user.UserRoles.Select(item => item.Role.Name).Order(StringComparer.Ordinal).ToArray(),
            await organizerStatusReader.GetStatusAsync(user.Id, cancellationToken), user.CreatedAt);

    private async Task RevokeAllTokensAsync(Guid userId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var tokens = await dbContext.RefreshTokens.Where(item => item.UserId == userId && item.RevokedAt == null).ToListAsync(cancellationToken);
        foreach (var token in tokens) token.Revoke(now, null);
    }

    private async Task<IDbContextTransaction> BeginTransactionAsync(CancellationToken cancellationToken)
    {
        var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        await auditDbContext.Database.UseTransactionAsync(transaction.GetDbTransaction(), cancellationToken);
        return transaction;
    }

    private async Task SaveAllAsync(CancellationToken cancellationToken)
    {
        await dbContext.SaveChangesAsync(cancellationToken);
        await auditWriter.SaveChangesAsync(cancellationToken);
    }

    private void VerifyDummyPassword(string suppliedPassword)
    {
        var dummy = User.Create("Dhanvi", "User", "unavailable@invalid.local", "UNAVAILABLE@INVALID.LOCAL", null, clock.UtcNow);
        var hash = passwordHasher.HashPassword(dummy, "DummyPassword@123");
        _ = passwordHasher.VerifyHashedPassword(dummy, hash, suppliedPassword);
    }

    private static string NormalizeEmail(string email) => email.Trim().ToUpperInvariant();
}

