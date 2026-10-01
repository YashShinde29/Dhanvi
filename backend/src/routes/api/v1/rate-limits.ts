/** Same windows as the .NET rate-limiter policies, partitioned by client IP. Rejections are 429 with no body. */
export const authenticationLimit = { rateLimit: { max: 10, timeWindow: 60_000 } };
export const passwordResetLimit = { rateLimit: { max: 5, timeWindow: 15 * 60_000 } };
