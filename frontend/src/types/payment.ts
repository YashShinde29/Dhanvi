export interface Payment {
  id: string; contributionId: string; groupId: string; groupName: string; cycleId: string; cycleNumber: number;
  membershipId: string; userId: string; memberName: string; amount: number; currency: string; provider: string; environment: string;
  providerOrderId: string | null; providerPaymentId: string | null; status: string; attemptNumber: number;
  reconciliationStatus: string; reconciliationMessage: string | null; lastReconciledAt: string | null;
  createdAt: string; capturedAt: string | null; settledAt: string | null; refundedAt: string | null;
  journalId: string | null; reversalJournalId: string | null; failureReason: string | null;
}
export interface PaymentDetails { payment: Payment; timeline: { id: string; action: string; message: string; createdAt: string }[];
  events: { id: string; eventType: string; processingStatus: string; receivedAt: string; payloadHash: string }[];
  refunds: { id: string; providerRefundId: string; amount: number; status: string; createdAt: string }[] }
export interface PaymentPage { items: Payment[]; totalCount: number; page: number; pageSize: number; captured: number; pending: number; failed: number; reconciliationRequired: number }
export interface PaymentEligibility { collectionMode: string; financiallySettledAmount: number; financialStatus: string; remainingAmount: number; canPay: boolean; reason: string | null; paymentId: string | null }
export interface Checkout { payment: Payment; keyId: string; amountInMinorUnits: number; checkoutAllowed: boolean }
export interface CheckoutResult { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }
