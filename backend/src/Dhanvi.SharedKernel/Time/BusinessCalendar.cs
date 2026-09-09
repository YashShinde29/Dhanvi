namespace Dhanvi.SharedKernel.Time;

public static class BusinessCalendar
{
    public const string DefaultTimeZone = "Asia/Kolkata";
    public static DateOnly Today(DateTimeOffset utcNow, string timeZone = DefaultTimeZone) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(utcNow, TimeZoneInfo.FindSystemTimeZoneById(timeZone)).DateTime);
}
