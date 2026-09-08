namespace Dhanvi.Modules.Audit.Domain;

public static class AuditActions
{
    public const string UserRegistered = "USER_REGISTERED";
    public const string UserLoginSuccess = "USER_LOGIN_SUCCESS";
    public const string PasswordChanged = "PASSWORD_CHANGED";
    public const string PasswordReset = "PASSWORD_RESET";
    public const string OrganizerApplicationSubmitted = "ORGANIZER_APPLICATION_SUBMITTED";
    public const string OrganizerApplicationApproved = "ORGANIZER_APPLICATION_APPROVED";
    public const string OrganizerApplicationRejected = "ORGANIZER_APPLICATION_REJECTED";
    public const string OrganizerSuspended = "ORGANIZER_SUSPENDED";
    public const string UserRoleAssigned = "USER_ROLE_ASSIGNED";
}

