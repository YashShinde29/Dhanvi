import type { RawEnv } from "./env.js";

export interface RazorpayConfig {
  enabled: boolean;
  environment: string;
  keyId: string;
  keySecret: string;
  webhookEnabled: boolean;
  webhookSecret: string;
  checkoutReturnBaseUrl: string;
  apiBaseUrl: string;
}

export type FakePayoutOutcome = "Success" | "Pending" | "Failed";
export type FeeRecognitionPolicy = "Deferred" | "OnFundedSelection";

export interface FinanceConfig {
  razorpay: RazorpayConfig;
  payouts: { provider: "FAKE"; fakeOutcome: FakePayoutOutcome };
  ledger: { feeRecognition: FeeRecognitionPolicy };
}

/** Port of RazorpayOptions.Valid(): TEST mode only, test key prefix, safe return URL, complete credentials when enabled. */
export function razorpayValid(o: RazorpayConfig): boolean {
  let returnUrlOk = true;
  if (o.checkoutReturnBaseUrl) {
    try {
      const url = new URL(o.checkoutReturnBaseUrl);
      const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      returnUrlOk = (url.protocol === "https:" || (url.protocol === "http:" && loopback)) && !url.username && !url.password && !url.hash;
    } catch {
      returnUrlOk = false;
    }
  }
  return o.environment === "TEST" && (!o.keyId || o.keyId.startsWith("rzp_test_")) && returnUrlOk &&
    (!o.enabled || (o.keyId.length > 9 && o.keySecret.trim().length > 0 && (!o.webhookEnabled || o.webhookSecret.trim().length > 0)));
}

const pascal = <T extends string>(value: string, allowed: readonly T[], name: string): T => {
  const match = allowed.find((a) => a.toLowerCase() === value.trim().toLowerCase());
  if (!match) throw new Error(`${name} must be one of ${allowed.join(", ")}.`);
  return match;
};

export function financeConfig(env: RawEnv): FinanceConfig {
  const razorpay: RazorpayConfig = {
    enabled: env.PAYMENTS_RAZORPAY_ENABLED,
    environment: env.RAZORPAY_ENVIRONMENT,
    keyId: env.RAZORPAY_KEY_ID,
    keySecret: env.RAZORPAY_KEY_SECRET,
    webhookEnabled: env.RAZORPAY_WEBHOOKS_ENABLED,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
    checkoutReturnBaseUrl: env.RAZORPAY_CHECKOUT_RETURN_BASE_URL,
    apiBaseUrl: env.RAZORPAY_API_BASE_URL.endsWith("/") ? env.RAZORPAY_API_BASE_URL : `${env.RAZORPAY_API_BASE_URL}/`,
  };
  if (!razorpayValid(razorpay)) throw new Error("Only complete Razorpay TEST credentials are accepted.");
  if (env.PAYOUTS_PROVIDER !== "FAKE") throw new Error("Only FAKE outgoing payouts are supported. Production payouts are disabled.");
  return {
    razorpay,
    payouts: { provider: "FAKE", fakeOutcome: pascal(env.PAYOUTS_FAKE_OUTCOME, ["Success", "Pending", "Failed"] as const, "PAYOUTS_FAKE_OUTCOME") },
    ledger: { feeRecognition: pascal(env.LEDGER_FEE_RECOGNITION, ["Deferred", "OnFundedSelection"] as const, "LEDGER_FEE_RECOGNITION") },
  };
}
