/**
 * The database stores EF enum names (PascalCase: "ReadyForSelection"); the HTTP API speaks SNAKE_CASE_UPPER
 * ("READY_FOR_SELECTION") exactly as JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseUpper) did.
 */
export function snakeUpper(pascal: string): string {
  return pascal
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toUpperCase();
}

const canonical = (value: string) => value.replace(/_/g, "").toLowerCase();

/**
 * Resolves client input (SNAKE_CASE_UPPER, PascalCase, any case) to the stored PascalCase name, like the .NET
 * converter / Enum.TryParse(value.Replace("_", ""), ignoreCase: true). Returns null when unknown.
 */
export function parseEnum<T extends string>(value: unknown, names: readonly T[]): T | null {
  if (typeof value !== "string" || value.trim() === "" || /^\d+$/.test(value.trim())) return null;
  const wanted = canonical(value.trim());
  return names.find((n) => canonical(n) === wanted) ?? null;
}

export const enumIndex = <T extends string>(value: T, names: readonly T[]): number => {
  const index = names.indexOf(value);
  if (index < 0) throw new Error(`Unknown enum value ${value}`);
  return index;
};
