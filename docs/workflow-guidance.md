# Workflow guidance and form usability

A presentation-only milestone: every workflow-heavy screen now states where the user is, what is done, what is waiting, what is blocked, who acts next and what to do. Business rules, APIs, authorization and the design system are unchanged.

## Input focus bug (one letter at a time)

**Root cause:** `packages/ui/src/dialog.tsx` → `useFocusTrap(open, ref, onClose)` listed `onClose` as an effect dependency. Every dialog parent passes a fresh closure each render (`onClose={() => setOpen(false)}`, `onClose={busy ? () => undefined : close}` in `ConfirmDialog`). Each keystroke inside a dialog re-rendered the parent → new `onClose` → the effect's cleanup restored focus to the element focused before the dialog opened, then the setup focused the dialog's first control (the header Close button). The field lost focus after every character.

**Affected inputs:** every field rendered inside `Dialog`, `Drawer` or `ConfirmDialog` — rejection reason (member applications, organizer applications), cancel/suspend reason, the manual contribution record dialog (amount/reference/note), and the group-list filter drawer (min/max value). Plain page forms (register, profile, group wizard, search, payout account, auction bid) were never affected.

**Fix (root cause, no refocus workaround):** the effect reads `onClose` through a ref and depends only on `[open, ref]`, so it runs on open/close only; it also keeps React's `autoFocus` (so the reason textarea receives initial focus instead of the Close button). Guarded by `tests/ux-regressions.test.mjs`. Browser verification typed "Dhanvi Testing Group", "Yash Shinde", "auction group" and "Documents require verification" character-by-character with editing keys; all fields kept focus and value.

## Workflow presentation layer

```
packages/features/src/workflow/
  workflow-status.ts        WorkflowAction / WorkflowStep / WorkflowSummary types, responsible roles, sorting, age helper
  next-action-card.tsx      NextActionCard, NextActionList (all-clear state), WaitingState, UnavailableAction, StickyActionBar
  workflow-stepper.tsx      accessible stepper (icon + visually-hidden state text; vertical on phones)
  workflow-status-card.tsx  "where am I" card: stage, headline, stepper, blocked-by / waiting-for / who-acts-next / next-step facts, the viewer's action
  priority-strip.tsx        admin triage counts (action required / waiting for provider / completed / failed / reconciliation)
  group-workflow.ts  membership-workflow.ts  cycle-workflow.ts  payment-workflow.ts  payout-workflow.ts  organizer-workflow.ts  auction-workflow.ts
packages/utils/src/status-guidance.ts   backend enum → stage name, description, next actor, next action (one catalog; presentStatus keeps label/tone)
```

Adapters are pure functions of backend DTOs (group, members, current cycle, own contribution, payout, account, auction). Nothing is inferred from frontend callback state — a payment shows "confirmed" only from a captured backend record.

## Where guidance appears

| Screen | Guidance |
| --- | --- |
| Member dashboard | "Your next actions" (accept terms, pay contribution due now, add payout account, auction available) → "Waiting on" (organizer approval, other members, selection, payout processing, upcoming cycles) → stats |
| Organizer dashboard | "Actions required" (applications, confirm ready, activate, run selection/auction, record contributions, continue draft) vs "Waiting on members and Dhanvi" |
| Admin dashboard | "Requires your attention" with reason, waiting age and CTA (organizer applications, platform groups to confirm/activate, cycles ready for selection, payout settlements to prepare, payment/payout reconciliation, approvals, executions, failed payouts, suspensions) vs items waiting on members/organizers/providers |
| Group details (all scopes) | "Group progress" card: lifecycle stepper with the current cycle's steps inlined, cycle position, waiting/blocked reasons, who acts next, the viewer's action; mobile sticky "Pay now" bar when the member's Razorpay contribution is due; tabs renamed to *Cycle progress* / *Rules & schedule*; `?tab=cycles` deep links |
| Membership card | Apply → Organizer review → Accept the rules → Waiting for the group to start → Active, with "Review terms" wired to the acceptance form |
| Cycle panel | Contributions → Selection/Auction → Payout → Cycle complete, with waiting-for provider/organizer and next-cycle copy |
| Selection panel | "Unavailable — Reason: N contributions still unpaid" instead of a hidden/disabled button; explicit "Waiting for the organizer / Dhanvi admin" for members |
| Auction panel | Scheduled/Open/Closed/Completed/No-bids card, ineligibility reason in plain words, unavailable Open/Close explained by schedule or outstanding contributions |
| Contribution checkout | Payment pending → submitted/verifying → confirmed ✓ / failed (Retry) / refunded / under review, each with "Next:"; verification errors say the contribution was not charged again |
| Payment & payout details | Breadcrumbs (`Payments / PAY-XXXXXXXX`, `Payouts / Group · Cycle / Type`), progress card, admin readiness checklist (funding, beneficiary, approval, execution, provider), explained unavailable Approve/Execute, reverse-chronological activity |
| Payments / payouts lists (admin) | Priority strip; payouts strip filters the list; all-clear empty states |
| Organizer application | Submitted → Dhanvi review → Under review → Approved · setup, plus "What happens next" |
| Group wizard | "Current step · n of 5 — Name · Next: …" with a stepper; in-progress setup persisted in localStorage and offered as "Continue group setup — You completed: … Next: …" |
| Success toasts | State the next step ("Application approved ✓ — Next: the member must accept the rules", "Group activated ✓ — next: members pay their cycle 1 contribution", …) |

## Verification (2026-09-15)

`npm run lint`, `npm run typecheck`, `npm test` (19), `npm run build:user`, `npm run build:admin`: pass. Browser: 40 UX/input checks and the 37 app-split checks pass against the live backend; console shows no React key, controlled/uncontrolled or hydration warnings (only the expected anonymous `users/me` 401 probe on login pages). No backend change was needed.
