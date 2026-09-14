const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5000/api/v1";

// Public values are fixed at build time. Production always keeps the business minimum.
const productionMinimum = 20;
const developmentMinimum = Number(process.env.NEXT_PUBLIC_MIN_GROUP_MEMBERS ?? productionMinimum);
const minimumGroupMembers = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
  ? developmentMinimum
  : productionMinimum;
if (!Number.isInteger(minimumGroupMembers) || minimumGroupMembers < 2 || minimumGroupMembers > 50) {
  throw new Error("NEXT_PUBLIC_MIN_GROUP_MEMBERS must be an integer between 2 and 50.");
}

export const env = {
  minimumGroupMembers,
  maximumGroupMembers: 50,
  apiBaseUrl: configuredApiBaseUrl.replace(/\/$/, ""),
};
