/** Time source (IDateTimeProvider). Tests substitute a controllable clock. */
export interface Clock { now(): Date }
export const systemClock: Clock = { now: () => new Date() };

/** The authenticated caller as the .NET endpoints derived it: user id plus "is ADMIN or SUPER_ADMIN". */
export interface Actor { userId: string; isAdmin: boolean }

export interface Page<T> { items: T[]; page: number; pageSize: number; totalCount: number }

export const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);
