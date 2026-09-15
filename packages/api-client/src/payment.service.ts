import { apiClient } from "./api-client";
import type { Checkout, CheckoutResult, Payment, PaymentDetails, PaymentEligibility, PaymentPage } from "@dhanvi/types";
export const paymentService = {
  eligibility: (id: string) => apiClient<PaymentEligibility>(`contributions/${id}/payment-eligibility`),
  create: (id: string, key: string) => apiClient<Checkout>(`contributions/${id}/payments`, { method: "POST", headers: { "Idempotency-Key": key }, body: "{}" }),
  verify: (id: string, result: CheckoutResult) => apiClient<Payment>(`payments/${id}/verify`, { method: "POST", body: JSON.stringify({
    razorpayOrderId: result.razorpay_order_id, razorpayPaymentId: result.razorpay_payment_id, razorpaySignature: result.razorpay_signature,
  }) }),
  list: (admin: boolean, page: number) => apiClient<PaymentPage>(`${admin ? "admin/" : ""}payments?page=${page}&pageSize=20`),
  details: (id: string, admin = false) => apiClient<PaymentDetails>(`${admin ? "admin/" : ""}payments/${id}`),
  refresh: (id: string, admin = false) => apiClient<Payment>(`${admin ? "admin/" : ""}payments/${id}/${admin ? "reconcile" : "refresh"}`, { method: "POST", body: "{}" }),
};
