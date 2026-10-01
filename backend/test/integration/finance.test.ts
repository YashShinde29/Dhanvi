import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activeGroup, type ActiveGroup, NOW } from "../support/fixtures.js";
import { as, createHarness, expectOk, type Harness, type TestUser } from "../support/harness.js";

let h: Harness;
beforeAll(async () => { h = await createHarness({ now: NOW }); });
afterAll(async () => { await h.close(); });

async function razorpayGroup(members = 2): Promise<ActiveGroup & { cycleId: string }> {
  h.clock.set(NOW);
  const g = await activeGroup(h, { members, groupValue: 20000, collectionMode: "RAZORPAY" });
  return { ...g, cycleId: g.cycles[0]!.id as string };
}
async function contributionOf(g: ActiveGroup & { cycleId: string }, member: TestUser) {
  const rows = expectOk(await as(h, member)("GET", `groups/${g.groupId}/my-contributions`));
  return rows.find((r: { cycleId: string }) => r.cycleId === g.cycleId);
}
async function pay(g: ActiveGroup & { cycleId: string }, member: TestUser) {
  const c = await contributionOf(g, member);
  const checkout = expectOk(await as(h, member)("POST", `contributions/${c.id}/payments`, undefined, { "idempotency-key": `pay-${c.id}` }));
  const result = h.razorpay.capture(checkout.payment.providerOrderId);
  const verified = expectOk(await as(h, member)("POST", `payments/${checkout.payment.id}/verify`, result));
  return { contribution: c, checkout, result, verified };
}
const journals = (eventType: string, eventId: string) =>
  h.db.query<{ Id: string }>(`SELECT "Id" FROM ledger."JournalEntries" WHERE "EventType" = $1 AND "EventId" = $2`, [eventType, eventId]);

describe("Razorpay TEST payments", () => {
  it("creates an order idempotently, captures on verified signature, settles the contribution and posts Dr 1010 / Cr 2000 once", async () => {
    const g = await razorpayGroup();
    const member = g.members[0]!;
    const c = await contributionOf(g, member);
    expect(expectOk(await as(h, member)("GET", `contributions/${c.id}/payment-eligibility`))).toMatchObject({ collectionMode: "RAZORPAY", canPay: true, remainingAmount: 10000 });
    expect((await as(h, g.members[1]!)("POST", `contributions/${c.id}/payments`, undefined, { "idempotency-key": "x" })).statusCode).toBe(403);
    const checkout = expectOk(await as(h, member)("POST", `contributions/${c.id}/payments`, undefined, { "idempotency-key": "order-1" }));
    expect(checkout).toMatchObject({ keyId: "rzp_test_harness01", amountInMinorUnits: 1000000, checkoutAllowed: true, payment: { status: "PENDING", amount: 10000 } });
    expect(expectOk(await as(h, member)("POST", `contributions/${c.id}/payments`, undefined, { "idempotency-key": "order-1" })).payment.id).toBe(checkout.payment.id);
    expect(h.razorpay.orders.size).toBe(1);
    const result = h.razorpay.capture(checkout.payment.providerOrderId);
    expect((await as(h, member)("POST", `payments/${checkout.payment.id}/verify`, { ...result, razorpaySignature: "0".repeat(64) })).json().code).toBe("INVALID_PAYMENT_SIGNATURE");
    const verified = expectOk(await as(h, member)("POST", `payments/${checkout.payment.id}/verify`, result));
    expect(verified).toMatchObject({ status: "CAPTURED", reconciliationStatus: "MATCHED" });
    expect(verified.journalId).toBeTruthy();
    // Verify again and deliver the provider webhook: still exactly one capture journal.
    expectOk(await as(h, member)("POST", `payments/${checkout.payment.id}/verify`, result));
    const hook = h.razorpay.webhook("payment.captured", result.razorpayPaymentId);
    const first = await h.app.inject({ method: "POST", url: "/api/v1/payments/webhooks/razorpay", payload: hook.body, headers: { "content-type": "application/json", "x-razorpay-signature": hook.signature, "x-razorpay-event-id": "evt_1" } });
    expect(first.statusCode).toBe(200);
    const again = await h.app.inject({ method: "POST", url: "/api/v1/payments/webhooks/razorpay", payload: hook.body, headers: { "content-type": "application/json", "x-razorpay-signature": hook.signature, "x-razorpay-event-id": "evt_1" } });
    expect(again.json()).toEqual({ received: true });
    expect(await journals("PaymentCaptured", checkout.payment.id)).toHaveLength(1);
    const lines = await h.db.query<{ Code: string; DebitAmount: { toFixed(n: number): string }; CreditAmount: { toFixed(n: number): string } }>(
      `SELECT a."Code", l."DebitAmount", l."CreditAmount" FROM ledger."JournalLines" l JOIN ledger."LedgerAccounts" a ON a."Id" = l."AccountId" WHERE l."JournalEntryId" = $1 ORDER BY a."Code"`, [verified.journalId]);
    expect(lines.map((l) => [l.Code, l.DebitAmount.toFixed(2), l.CreditAmount.toFixed(2)])).toEqual([["1010", "10000.00", "0.00"], ["2000", "0.00", "10000.00"]]);
    expect(expectOk(await as(h, member)("GET", `contributions/${c.id}/payment-eligibility`))).toMatchObject({ canPay: false, financialStatus: "SETTLED", reason: "Contribution settled." });
  });

  it("verifies webhooks over the exact raw bytes; rejects bad signatures and reused event ids with new payloads", async () => {
    const g = await razorpayGroup();
    const { result } = await pay(g, g.members[0]!);
    const hook = h.razorpay.webhook("payment.captured", result.razorpayPaymentId);
    const tampered = Buffer.from(hook.body.toString().replace("  ", " "));
    const bad = await h.app.inject({ method: "POST", url: "/api/v1/payments/webhooks/razorpay", payload: tampered, headers: { "content-type": "application/json", "x-razorpay-signature": hook.signature } });
    expect(bad.statusCode).toBe(409);
    expect(bad.json().code).toBe("INVALID_WEBHOOK_SIGNATURE");
    const ok = await h.app.inject({ method: "POST", url: "/api/v1/payments/webhooks/razorpay", payload: hook.body, headers: { "content-type": "application/json", "x-razorpay-signature": hook.signature, "x-razorpay-event-id": "evt_a" } });
    expect(ok.statusCode).toBe(200);
    const other = h.razorpay.webhook("payment.authorized", result.razorpayPaymentId);
    const reused = await h.app.inject({ method: "POST", url: "/api/v1/payments/webhooks/razorpay", payload: other.body, headers: { "content-type": "application/json", "x-razorpay-signature": other.signature, "x-razorpay-event-id": "evt_a" } });
    expect(reused.json().code).toBe("PROVIDER_EVENT_REUSED");
  });

  it("records failed attempts without settlement and allows a new capture afterwards", async () => {
    const g = await razorpayGroup();
    const member = g.members[1]!;
    const c = await contributionOf(g, member);
    const checkout = expectOk(await as(h, member)("POST", `contributions/${c.id}/payments`, undefined, { "idempotency-key": "f-1" }));
    const failed = h.razorpay.fail(checkout.payment.providerOrderId);
    const hook = h.razorpay.webhook("payment.failed", failed.id);
    expect((await h.app.inject({ method: "POST", url: "/api/v1/payments/webhooks/razorpay", payload: hook.body, headers: { "content-type": "application/json", "x-razorpay-signature": hook.signature } })).statusCode).toBe(200);
    expect(expectOk(await as(h, member)("GET", `payments/${checkout.payment.id}`)).payment).toMatchObject({ status: "FAILED", journalId: null });
    expect(expectOk(await as(h, member)("GET", `contributions/${c.id}/payment-eligibility`)).canPay).toBe(true);
    const result = h.razorpay.capture(checkout.payment.providerOrderId);
    expect(expectOk(await as(h, member)("POST", `payments/${checkout.payment.id}/verify`, result)).status).toBe("CAPTURED");
  });

  it("refund reverses the capture journal once and releases the contribution", async () => {
    const g = await razorpayGroup();
    const { checkout, result, verified } = await pay(g, g.members[0]!);
    const refund = h.razorpay.refund(result.razorpayPaymentId);
    const hook = h.razorpay.webhook("refund.processed", result.razorpayPaymentId, refund);
    for (let i = 0; i < 2; i++)
      expect((await h.app.inject({ method: "POST", url: "/api/v1/payments/webhooks/razorpay", payload: hook.body, headers: { "content-type": "application/json", "x-razorpay-signature": hook.signature } })).statusCode).toBe(200);
    const details = expectOk(await as(h, g.members[0]!)("GET", `payments/${checkout.payment.id}`));
    expect(details.payment).toMatchObject({ status: "REFUNDED" });
    const reversal = await h.db.query<{ Id: string }>(`SELECT "Id" FROM ledger."JournalEntries" WHERE "ReversesJournalEntryId" = $1`, [verified.journalId]);
    expect(reversal).toHaveLength(1);
    expect(expectOk(await as(h, g.members[0]!)("GET", `contributions/${checkout.payment.contributionId}/payment-eligibility`)).financialStatus).toBe("REFUNDED");
  });

  it("reconciliation marks a provider mismatch and holds it (sticky)", async () => {
    const g = await razorpayGroup();
    const admin = g.owner;
    const c = await contributionOf(g, g.members[0]!);
    const checkout = expectOk(await as(h, g.members[0]!)("POST", `contributions/${c.id}/payments`, undefined, { "idempotency-key": "m-1" }));
    h.razorpay.orders.get(checkout.payment.providerOrderId)!.amount = 1n; // provider disagrees on amount
    const reconciled = expectOk(await as(h, admin)("POST", `admin/payments/${checkout.payment.id}/reconcile`));
    expect(reconciled).toMatchObject({ status: "RECONCILIATION_REQUIRED", reconciliationStatus: "MISMATCH" });
    const overview = expectOk(await as(h, admin)("GET", "admin/operations/overview"));
    expect(overview.payments.counts.reconciliationRequired).toBeGreaterThanOrEqual(1);
  });

  it("an uncertain order creation is recorded and never retried automatically", async () => {
    const g = await razorpayGroup();
    const c = await contributionOf(g, g.members[0]!);
    h.razorpay.failNextCreate = true;
    const res = expectOk(await as(h, g.members[0]!)("POST", `contributions/${c.id}/payments`, undefined, { "idempotency-key": "u-1" }));
    expect(res).toMatchObject({ checkoutAllowed: false, payment: { reconciliationStatus: "FAILED", providerOrderId: null } });
  });
});

describe("funded selection, ledger and payouts", () => {
  it("captures every contribution, selects, prepares payouts, settles via the FAKE provider, completes the cycle and opens the next", async () => {
    const g = await razorpayGroup(2);
    for (const m of g.members) await pay(g, m);
    const cycle = expectOk(await as(h, g.owner)("GET", `groups/${g.groupId}/cycles/${g.cycleId}`));
    expect(cycle).toMatchObject({ status: "READY_FOR_SELECTION", financiallySettledAmount: 20000, financiallySettledMemberCount: 2 });
    const selection = expectOk(await as(h, g.owner)("POST", `groups/${g.groupId}/cycles/${g.cycleId}/selection`));
    // Funded pool: Dr 2000 20,000 / Cr 2100 20,000 to the winner, posted with the selection.
    expect(await journals("RandomSelectionCompleted", selection.id)).toHaveLength(1);
    const prepared = expectOk(await as(h, g.owner)("POST", `admin/cycles/${g.cycleId}/prepare-settlement`));
    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toMatchObject({ payoutType: "WINNER_PAYOUT", amount: 20000, status: "PENDING_BENEFICIARY", beneficiaryAvailable: false });
    expect(expectOk(await as(h, g.owner)("POST", `admin/cycles/${g.cycleId}/prepare-settlement`))[0].id).toBe(prepared[0].id);
    const winnerUser = (await h.db.one<{ UserId: string }>(`SELECT "UserId" FROM groups."GroupMemberships" WHERE "Id" = $1`, [selection.winner.membershipId])).UserId;
    const recipient = g.members.find((m) => m.id === winnerUser)!;
    expect((await as(h, recipient)("POST", "users/me/payout-account", { accountHolderName: "R", accountNumber: "123456789012", confirmAccountNumber: "123456789012", ifsc: "HDFC0001234", password: "wrong" })).statusCode).toBe(401);
    const account = expectOk(await as(h, recipient)("POST", "users/me/payout-account", { accountHolderName: "Recipient", accountNumber: "123456789012", confirmAccountNumber: "123456789012", ifsc: "HDFC0001234", bankName: "HDFC", password: "Passw0rd!" }));
    expect(account.maskedAccountNumber).toBe("****9012");
    const raw = await h.db.query(`SELECT * FROM payouts."PayoutBeneficiaries" WHERE "UserId" = $1`, [recipient.id]);
    expect(JSON.stringify(raw)).not.toContain("123456789012");
    const payoutId = prepared[0].id;
    expect((await as(h, recipient)("POST", `admin/payouts/${payoutId}/approve`)).statusCode).toBe(403);
    expect(expectOk(await as(h, g.owner)("POST", `admin/payouts/${payoutId}/approve`)).status).toBe("APPROVED");
    const executed = expectOk(await as(h, g.owner)("POST", `admin/payouts/${payoutId}/execute`, undefined, { "idempotency-key": "exec-1" }));
    expect(executed).toMatchObject({ status: "SUCCEEDED", maskedAccountNumber: "****9012" });
    expect(expectOk(await as(h, g.owner)("POST", `admin/payouts/${payoutId}/execute`, undefined, { "idempotency-key": "exec-1" })).status).toBe("SUCCEEDED");
    expect(await journals("PayoutSettled", payoutId)).toHaveLength(1);
    const cycles = expectOk(await as(h, g.owner)("GET", `groups/${g.groupId}/cycles`));
    expect(cycles.map((c: { status: string }) => c.status)).toEqual(["COMPLETED", "COLLECTING_CONTRIBUTIONS"]);
    expect(expectOk(await as(h, g.owner)("GET", `admin/groups/${g.groupId}`)).currentCycleNumber).toBe(2);
    const trial = expectOk(await as(h, g.owner)("GET", "admin/ledger/trial-balance"));
    expect(trial.balanced).toBe(true);
    expect(trial.totalDebits).toBe(trial.totalCredits);
    const mine = expectOk(await as(h, recipient)("GET", "me/ledger"));
    expect(mine.items.every((i: { groupId: string }) => i.groupId === g.groupId)).toBe(true);
    // Posted history is append-only.
    await expect(h.db.execute(`UPDATE ledger."JournalEntries" SET "Description" = 'x'`)).rejects.toThrow(/append-only/);
  });
});
