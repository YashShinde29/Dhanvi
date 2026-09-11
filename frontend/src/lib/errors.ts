import { ApiError } from "@/services/api-client";

/** Backend business codes → friendly, action-oriented copy. */
const codeMessages: Record<string, string> = {
  GROUP_FULL: "This group is already full.",
  ALREADY_APPLIED: "Your application has already been submitted.",
  GROUP_NOT_JOINABLE: "This group is not accepting applications right now.",
  GROUP_NOT_EDITABLE: "This group can no longer be edited.",
  GROUP_RULES_LOCKED: "Core group rules are locked once a member has been approved.",
  GROUP_NOT_ACTIVE: "This group is not active.",
  GROUP_NOT_READY: "The group is not ready for this step yet.",
  GROUP_NOT_FULLY_SUBSCRIBED: "All member positions must be filled first.",
  GROUP_SUSPENDED: "This group is suspended. Operations are paused.",
  INVALID_GROUP_TRANSITION: "This action is not available for the group's current status.",
  NOT_GROUP_OWNER: "You don't have permission to manage this group.",
  ORGANIZER_NOT_APPROVED: "An approved organizer account is required for this action.",
  MEMBERSHIP_REQUIRED: "Only group members can access this.",
  MEMBERSHIP_NOT_APPROVED: "Your membership has not been approved yet.",
  MEMBERSHIP_NOT_READY: "Please accept the current group rules first.",
  MEMBERSHIP_NOT_ELIGIBLE: "Your membership is not eligible for this action.",
  APPLICATION_ALREADY_REVIEWED: "This application has already been reviewed.",
  TERMS_ALREADY_ACCEPTED: "You have already accepted these group rules.",
  CURRENT_RULE_VERSION_REQUIRED: "The group rules were updated. Please review the latest version.",
  REASON_REQUIRED: "Please provide a reason.",
  INVALID_GROUP_AMOUNT: "Enter a valid group value.",
  INVALID_MEMBER_LIMIT: "Member count must be between 20 and 50.",
  INVALID_START_DATE: "Choose a start date in the future.",
  INVALID_SCHEDULE: "Check the contribution, selection and payout days.",
  INVALID_AUCTION_RULES: "Check the auction configuration values.",
  INVALID_GROUP_NAME: "Enter a valid group name.",
  ORGANIZER_FIRST_PAYOUT_REQUIRES_MEMBERSHIP: "Organizer first payout requires the organizer to participate as a member.",
  GROUP_ALREADY_HAS_CYCLES: "This group has already been activated.",
  CYCLE_NOT_READY_FOR_SELECTION: "All required contributions must be recorded before selection.",
  SELECTION_ALREADY_COMPLETED: "Selection for this cycle has already been completed.",
  NO_ELIGIBLE_MEMBERS: "No eligible members are available for this selection.",
  NOT_AUTHORIZED_TO_EXECUTE_SELECTION: "You don't have permission to run this selection.",
  NOT_AUTHORIZED_TO_MANAGE_AUCTION: "You don't have permission to manage this auction.",
  AUCTION_NOT_OPEN: "This auction is not open for bids.",
  AUCTION_CLOSED: "This auction has closed.",
  AUCTION_OUTSIDE_WINDOW: "The auction can only be operated within its scheduled window.",
  AUCTION_ALREADY_EXISTS: "An auction already exists for this cycle.",
  AUCTION_HAS_NO_BIDS: "No bids have been placed yet.",
  AUCTION_NOT_FOUND: "No auction is available for this cycle yet.",
  AUCTION_RESULT_NOT_FOUND: "The auction result is not available yet.",
  AUCTION_RESULT_ALREADY_EXISTS: "This auction has already been finalized.",
  CYCLE_NOT_AUCTION: "This cycle does not use auction selection.",
  MEMBER_NOT_ELIGIBLE_TO_BID: "You are not eligible to bid in this auction.",
  MEMBER_ALREADY_SELECTED_FOR_PAYOUT: "Members who already received a payout turn cannot bid.",
  MEMBER_ALREADY_SELECTED: "This member has already received a payout turn.",
  DISCOUNT_BELOW_MINIMUM: "Your discount is below the minimum allowed for this auction.",
  DISCOUNT_ABOVE_MAXIMUM: "Your discount is above the maximum allowed for this auction.",
  BID_INCREMENT_NOT_MET: "Your discount must exceed the current highest bid by the required increment.",
  INVALID_DISCOUNT: "Enter a valid discount amount.",
  INVALID_CONTRIBUTION_PRECISION: "Amounts may have at most two decimal places.",
  REFERENCE_ALREADY_USED: "This reference has already been used for another record.",
  IDEMPOTENCY_KEY_REQUIRED: "Please retry the operation.",
  SELECTION_METHOD_NOT_SUPPORTED: "This selection method is not supported here.",
  RANDOM_VERIFICATION_NOT_APPLICABLE: "Verification is only available for random draws.",
};

const statusMessages: Record<number, string> = {
  400: "Some of the information provided is not valid.",
  401: "Please sign in to continue.",
  403: "You don't have permission to do this.",
  404: "We couldn't find what you were looking for.",
  409: "This action conflicts with the current state. Please refresh and try again.",
  429: "Too many requests. Please wait a moment and try again.",
  500: "Something went wrong on our side. Please try again.",
  503: "The service is temporarily unavailable. Please try again shortly.",
};

const looksTechnical = (text: string) => /exception|sql|stack|status \d{3}|failed with status|npgsql|system\./i.test(text);

/** Turn any thrown value into a user-safe sentence. */
export function friendlyError(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error instanceof ApiError) {
    if (error.code && codeMessages[error.code]) return codeMessages[error.code];
    const fieldMessage = Object.values(error.errors).flat()[0];
    if (fieldMessage) return fieldMessage;
    if (error.status === 401 || error.status === 403 || error.status >= 500) return statusMessages[error.status] ?? fallback;
    if (error.message && !looksTechnical(error.message)) return error.message;
    return statusMessages[error.status] ?? fallback;
  }
  if (error instanceof TypeError) return "We couldn't reach Dhanvi. Check your connection and try again.";
  if (error instanceof Error && error.message && !looksTechnical(error.message)) return error.message;
  return fallback;
}

/** Field-level backend validation errors keyed by camelCase field name. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  const result: Record<string, string> = {};
  for (const [key, messages] of Object.entries(error.errors)) {
    const field = key.charAt(0).toLowerCase() + key.slice(1);
    if (messages[0]) result[field] = messages[0];
  }
  return result;
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
export function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}
