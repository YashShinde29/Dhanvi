"use client";

import { env } from "@dhanvi/config";
import { groupService, type GroupScope } from "@dhanvi/api-client";
import type { AuctionRules, Group, GroupInput } from "@dhanvi/types";
import { PageHeader, Button, Card, CardBody, CardHeader, Callout, ChoiceCard, FormField, FormSection, Input, MoneyInput, Textarea, KeyValueRows, RuleList, Icons, useToast } from "@dhanvi/ui";
import { fieldErrors, friendlyError, formatClockTime, formatDate, formatMoney, formatMonthlyDay } from "@dhanvi/utils";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Guard, groupHref, managePrefix } from "./shared";
import { WorkflowStepper, type WorkflowStep } from "../workflow";

export function GroupCreatePage({ scope }: { scope: "organizer" | "admin" }) {
  return (
    <Guard scope={scope}>
      <PageHeader eyebrow={scope === "admin" ? "Control center" : "Organizer"} title={scope === "admin" ? "Create platform group" : "Create organizer group"}
        description={scope === "admin" ? "Creator: Dhanvi platform. Members see every rule defined here before they apply; publishing locks them as version 1." : "Set up your group step by step. Members see every rule you define here before they apply."}
        breadcrumbs={[{ label: scope === "admin" ? "Groups" : "My groups", href: `${managePrefix(scope)}/groups` }, { label: scope === "admin" ? "Create platform group" : "Create group" }]} />
      <GroupWizard scope={scope} />
    </Guard>
  );
}

interface FormState {
  name: string; description: string; groupType: "RANDOM" | "AUCTION"; groupValue: string; memberLimit: string;
  organizerParticipates: boolean; organizerFirstPayout: boolean; contributionDueDay: string; selectionDay: string; payoutDay: string; startDate: string;
  minimumDiscount: string; maximumDiscount: string; bidIncrement: string; auctionStartTime: string; auctionEndTime: string;
  collectionMode: "MANUAL_TRACKING" | "RAZORPAY";
}
type Errors = Partial<Record<keyof FormState, string>>;

const defaultAuction: AuctionRules = { minimumDiscount: 0, maximumDiscount: 10000, bidIncrement: 100, auctionStartTime: "10:00:00", auctionEndTime: "11:00:00" };

function fromGroup(existing?: Group): FormState {
  const auction = existing?.auctionRules ?? defaultAuction;
  return {
    name: existing?.name ?? "", description: existing?.description ?? "", groupType: existing?.groupType ?? "RANDOM",
    groupValue: existing ? String(existing.groupValue) : "500000", memberLimit: existing ? String(existing.memberLimit) : String(env.minimumGroupMembers),
    organizerParticipates: existing?.organizerParticipates ?? false, organizerFirstPayout: existing?.organizerFirstPayout ?? false,
    contributionDueDay: String(existing?.contributionDueDay ?? 1), selectionDay: String(existing?.selectionDay ?? 2), payoutDay: String(existing?.payoutDay ?? 2),
    startDate: existing?.startDate ?? "",
    minimumDiscount: String(auction.minimumDiscount), maximumDiscount: String(auction.maximumDiscount), bidIncrement: String(auction.bidIncrement),
    auctionStartTime: auction.auctionStartTime, auctionEndTime: auction.auctionEndTime,
    collectionMode: existing?.collectionMode ?? "MANUAL_TRACKING",
  };
}

const normalizeTime = (value: string) => (value.length === 5 ? `${value}:00` : value);

function toInput(form: FormState, scope: GroupScope): GroupInput {
  return {
    // Only platform groups may collect through Razorpay (backend rule); organizer groups always use manual tracking.
    ...(scope === "admin" ? { collectionMode: form.collectionMode } : {}),
    name: form.name.trim(), description: form.description.trim(), groupType: form.groupType,
    groupValue: Number(form.groupValue), memberLimit: Number(form.memberLimit),
    organizerParticipates: form.organizerParticipates, organizerFirstPayout: form.organizerParticipates && form.organizerFirstPayout,
    contributionDueDay: Number(form.contributionDueDay), selectionDay: Number(form.selectionDay), payoutDay: Number(form.payoutDay), startDate: form.startDate,
    auctionRules: form.groupType === "AUCTION" ? {
      minimumDiscount: Number(form.minimumDiscount), maximumDiscount: Number(form.maximumDiscount), bidIncrement: Number(form.bidIncrement),
      auctionStartTime: normalizeTime(form.auctionStartTime), auctionEndTime: normalizeTime(form.auctionEndTime),
    } : null,
  };
}

/** Client-side estimate mirroring the backend rule (value must divide exactly in paise). Backend remains authoritative. */
export function calculate(form: Pick<FormState, "groupValue" | "memberLimit" | "organizerParticipates">) {
  const value = Number(form.groupValue);
  const members = Number(form.memberLimit);
  const paise = Math.round(value * 100);
  const valid = Number.isFinite(value) && value > 0 && Number.isInteger(members) && members > 0;
  const exact = valid && paise % members === 0;
  return {
    valid, exact, monthly: exact ? paise / members / 100 : null, duration: valid ? members : null,
    externalSlots: valid ? members - (form.organizerParticipates ? 1 : 0) : null,
  };
}

const STEPS_ORGANIZER = ["Basics", "Group type", "Group value", "Participation", "Schedule", "Review & publish"];
const STEPS_ADMIN = ["Basics", "Group type", "Financial structure", "Schedule", "Rules", "Review & publish"];

/** In-progress (unsaved) wizard state survives navigation so nobody has to restart mentally. Drafts saved to the backend are not stored here. */
const storageKey = (scope: GroupScope) => `dhanvi.group-wizard.${scope}`;
interface StoredProgress { form: FormState; step: number; savedAt: string }
const readRaw = (scope: GroupScope): string | null => { try { return window.localStorage.getItem(storageKey(scope)); } catch { return null; } };
const subscribeStorage = (onChange: () => void) => { window.addEventListener("storage", onChange); return () => window.removeEventListener("storage", onChange); };
function writeProgress(scope: GroupScope, value: StoredProgress | null) {
  try { if (value) window.localStorage.setItem(storageKey(scope), JSON.stringify(value)); else window.localStorage.removeItem(storageKey(scope)); } catch { /* storage unavailable: progress simply is not remembered */ }
}

export function GroupWizard({ scope, existing, onSaved, onCancel }: { scope: GroupScope; existing?: Group; onSaved?: () => void; onCancel?: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => fromGroup(existing));
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = !!existing?.rulesLocked;
  const stepNames = locked ? ["Basics", "Review & publish"] : scope === "organizer" ? STEPS_ORGANIZER : STEPS_ADMIN;
  const [publishAfterSave, setPublishAfterSave] = useState(false);
  const [step, setStep] = useState(0);
  const [resumeDismissed, setResumeDismissed] = useState(false);
  const stepName = stepNames[step]!;
  const initial = useMemo(() => JSON.stringify(fromGroup(existing)), [existing]);
  const touched = JSON.stringify(form) !== initial;
  // Offer to continue an unfinished setup (new groups only). Read through useSyncExternalStore so server and first client render agree.
  // The snapshot is captured once per mount: progress written while typing must never re-open the resume offer.
  const initialRaw = useRef<string | null | undefined>(undefined);
  const storedRaw = useSyncExternalStore(subscribeStorage, () => { if (initialRaw.current === undefined) initialRaw.current = existing ? null : readRaw(scope); return initialRaw.current; }, () => null);
  const resume = useMemo<StoredProgress | null>(() => { if (resumeDismissed || !storedRaw) return null; try { const p = JSON.parse(storedRaw) as StoredProgress; return p.step > 0 ? p : null; } catch { return null; } }, [storedRaw, resumeDismissed]);
  // Persist progress while typing (only once the offer to resume has been answered or there was nothing to resume).
  useEffect(() => { if (!existing && touched && !resume) writeProgress(scope, { form, step, savedAt: new Date().toISOString() }); }, [existing, form, step, touched, resume, scope]);
  const calc = useMemo(() => calculate(form), [form]);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function validate(name: string): boolean {
    const next: Errors = {};
    if (name === "Basics") {
      if (!form.name.trim()) next.name = "Give the group a clear name.";
      else if (form.name.trim().length > 200) next.name = "Keep the name under 200 characters.";
      if (form.description.length > 4000) next.description = "Keep the description under 4,000 characters.";
    }
    if (name === "Group value" || name === "Financial structure") {
      if (!calc.valid) { if (!(Number(form.groupValue) > 0)) next.groupValue = "Enter the total group value."; }
      const members = Number(form.memberLimit);
      if (!Number.isInteger(members) || members < env.minimumGroupMembers || members > env.maximumGroupMembers) next.memberLimit = `Choose between ${env.minimumGroupMembers} and ${env.maximumGroupMembers} members.`;
      else if (calc.valid && !calc.exact) next.groupValue = "The group value must divide exactly among all members (no fractional paise). Adjust the value or member count.";
    }
    if (name === "Schedule") {
      if (!form.startDate) next.startDate = "Choose the month the group starts.";
      else if (!existing && form.startDate < today) next.startDate = "The start date should be today or later.";
      for (const key of ["contributionDueDay", "selectionDay", "payoutDay"] as const) {
        const day = Number(form[key]);
        if (!Number.isInteger(day) || day < 1 || day > 28) next[key] = "Use a day between 1 and 28 so it exists in every month.";
      }
      if (form.groupType === "AUCTION") {
        const min = Number(form.minimumDiscount), max = Number(form.maximumDiscount), inc = Number(form.bidIncrement);
        if (!(min >= 0)) next.minimumDiscount = "Enter the minimum discount (0 or more).";
        if (!(max > 0)) next.maximumDiscount = "Enter the maximum discount.";
        else if (max <= min) next.maximumDiscount = "Maximum must be greater than the minimum discount.";
        else if (calc.valid && max >= Number(form.groupValue)) next.maximumDiscount = "Maximum discount must be less than the group value.";
        if (!(inc > 0)) next.bidIncrement = "Enter a positive bid increment.";
        if (!form.auctionStartTime) next.auctionStartTime = "Set the auction start time.";
        if (!form.auctionEndTime) next.auctionEndTime = "Set the auction end time.";
        else if (form.auctionEndTime <= form.auctionStartTime) next.auctionEndTime = "The auction must end after it starts.";
      }
    }
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) document.getElementById(`group-${first}`)?.focus();
    return Object.keys(next).length === 0;
  }

  function next() { if (validate(stepName)) setStep((s) => Math.min(s + 1, stepNames.length - 1)); }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || stepName !== "Review & publish") return;
    for (const name of stepNames) if (!validate(name)) { setStep(stepNames.indexOf(name)); return; }
    setBusy(true); setError("");
    try {
      const saved = await groupService.save(scope, toInput(form, scope), existing?.id);
      if (!existing) writeProgress(scope, null);
      if (publishAfterSave && saved.status === "DRAFT") {
        try { await groupService.action(`${scope}/groups/${saved.id}/publish`); toast.success("Group published ✓", "Next: members discover the group and apply. Review applications as they arrive."); }
        catch (failure) { toast.error("Saved as draft — publishing failed", friendlyError(failure)); }
      } else toast.success(existing ? "Draft updated" : "Draft saved ✓", "Next: publish it from Group Control when you are ready to accept applications.");
      if (onSaved) onSaved();
      else router.push(groupHref(scope, saved.id));
    } catch (failure) {
      const fields = fieldErrors(failure) as Errors;
      if (Object.keys(fields).length) { setErrors(fields); const first = Object.keys(fields)[0] as keyof FormState; setStep(stepFor(first)); }
      setError(friendlyError(failure));
      setBusy(false);
    }
  }

  function stepFor(field: keyof FormState): number {
    const valueStep = scope === "admin" ? "Financial structure" : "Group value";
    const map: Record<string, string> = { name: "Basics", description: "Basics", groupType: "Group type", groupValue: valueStep, memberLimit: valueStep, organizerParticipates: "Participation", organizerFirstPayout: "Participation", collectionMode: "Rules" };
    const name = map[field] ?? "Schedule";
    const index = stepNames.indexOf(name);
    return index === -1 ? 0 : index;
  }

  const summaryRows = [
    { key: "Creator", value: scope === "admin" ? "Dhanvi platform" : "You (organizer)" },
    { key: "Group value", value: <span className="amount">{formatMoney(Number(form.groupValue) || 0)}</span> },
    { key: "Members", value: form.memberLimit || "—" },
    { key: "Monthly contribution", value: <span className="amount">{calc.monthly !== null ? formatMoney(calc.monthly) : "—"}</span> },
    { key: "Duration", value: calc.duration ? `${calc.duration} months` : "—" },
    ...(scope === "organizer" ? [{ key: "External positions", value: calc.externalSlots ?? "—" }] : []),
  ];

  const wizardSteps: WorkflowStep[] = stepNames.map((name, i) => ({ id: name, label: name, state: i < step ? "complete" : i === step ? "current" : "upcoming" }));
  if (resume) {
    const done = stepNames.slice(0, resume.step);
    return (
      <Card>
        <CardHeader title="Continue group setup" subtitle={`You started this group on ${formatDate(resume.savedAt)}${resume.form.name ? ` · “${resume.form.name}”` : ""}`} />
        <CardBody className="stack">
          <p className="text-sm text-secondary"><strong>You completed:</strong> {done.length ? done.join(", ") : "nothing yet"}. <strong>Next:</strong> {stepNames[resume.step]}.</p>
          <div className="row">
            <Button onClick={() => { setForm(resume.form); setStep(resume.step); setResumeDismissed(true); }} icon={<Icons.ChevronRight size={16} />}>Continue</Button>
            <Button variant="ghost" onClick={() => { writeProgress(scope, null); setResumeDismissed(true); }}>Start over</Button>
          </div>
        </CardBody>
      </Card>
    );
  }
  return (
    <form className="wizard" onSubmit={submit} noValidate>
      <div className="stack stack--lg">
        <Card>
          <CardBody className="stack">
            <div className="wf-card__eyebrow">Current step · {step + 1} of {stepNames.length} — {stepName}{step + 1 < stepNames.length && <span className="wf-card__position"> · Next: {stepNames[step + 1]}</span>}</div>
            <WorkflowStepper steps={wizardSteps} label="Group setup steps" />
          </CardBody>
        </Card>
        {locked && <Callout variant="info" title="Core rules are locked">A member has been approved, so financial rules can no longer change. You can still update the name and description.</Callout>}

        <Card>
          <CardHeader title={stepName === "Basics" ? "Group basics" : stepName === "Group type" ? "Group type" : stepName === "Group value" || stepName === "Financial structure" ? "Group value and members" : stepName === "Participation" ? "Your participation" : stepName === "Schedule" ? "Monthly schedule" : stepName === "Rules" ? "Collection rules" : "Review and publish"}
            subtitle={stepName === "Basics" ? "Name the group and describe who it is for." : stepName === "Group type" ? "How is each cycle's payout recipient decided?" : stepName === "Group value" || stepName === "Financial structure" ? "The monthly contribution and duration are calculated from these two values." : stepName === "Participation" ? "Decide whether you save alongside members and whether you take the first payout." : stepName === "Schedule" ? "Days apply to every month of the group. Use 1–28 so every month has the date." : stepName === "Rules" ? "How contributions are collected for this platform group." : "Check every rule. After publishing, members accept exactly these rules."} />
          <CardBody className="stack stack--lg">
            {stepName === "Basics" && (
              <>
                <FormField label="Group name" htmlFor="group-name" required error={errors.name} help="Shown to members when browsing, e.g. “Vashi Savings Circle — ₹5 lakh”.">
                  <Input id="group-name" value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={200} invalid={!!errors.name} autoFocus />
                </FormField>
                <FormField label="Description" htmlFor="group-description" optional error={errors.description} help="Who this group is for and anything members should know before applying.">
                  <Textarea id="group-description" value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={4000} rows={4} invalid={!!errors.description} />
                </FormField>
              </>
            )}

            {stepName === "Group type" && (
              <>
                <FormSection title="Group type" description={locked ? "Group type cannot change after approval." : "How is each cycle's payout recipient decided?"}>
                  <div className="choice-grid" role="radiogroup" aria-label="Group type">
                    <ChoiceCard selected={form.groupType === "RANDOM"} onSelect={() => set("groupType", "RANDOM")} disabled={locked} icon={<Icons.Shuffle size={18} />} title="Random savings group"
                      description="A recorded random draw picks one eligible member each cycle." points={["Full pool payout", "Random eligible member", "One payout per member", "Draw can be re-verified"]} />
                    <ChoiceCard selected={form.groupType === "AUCTION"} onSelect={() => set("groupType", "AUCTION")} disabled={locked} icon={<Icons.Gavel size={18} />} title="Auction savings group"
                      description="Members offer a discount; the highest valid discount wins the cycle." points={["Members bid a discount", "Highest valid discount wins", "Winner receives reduced payout", "Benefit shared under group rules"]} />
                  </div>
                </FormSection>
              </>
            )}

            {(stepName === "Group value" || stepName === "Financial structure") && (
              <>
                <div className="grid-2">
                  <FormField label="Group value" htmlFor="group-groupValue" required error={errors.groupValue} help="Total pool each cycle, e.g. ₹5,00,000.">
                    <MoneyInput id="group-groupValue" value={form.groupValue} onChange={(v) => set("groupValue", v)} invalid={!!errors.groupValue} disabled={locked} />
                  </FormField>
                  <FormField label="Number of members" htmlFor="group-memberLimit" required error={errors.memberLimit} help={`Between ${env.minimumGroupMembers} and ${env.maximumGroupMembers}. Duration equals the number of members.`}>
                    <Input id="group-memberLimit" type="number" inputMode="numeric" min={env.minimumGroupMembers} max={env.maximumGroupMembers} value={form.memberLimit} onChange={(e) => set("memberLimit", e.target.value)} invalid={!!errors.memberLimit} disabled={locked} />
                  </FormField>
                </div>
                <Callout variant={calc.exact ? "success" : "neutral"} title={calc.exact ? "Calculated monthly contribution" : "Waiting for a valid combination"}>
                  {calc.exact ? <>Each member contributes <strong className="amount">{formatMoney(calc.monthly!)}</strong> per month for <strong>{calc.duration} months</strong>. The backend performs the final calculation.</> : "The group value must divide evenly across all members."}
                </Callout>
              </>
            )}

            {stepName === "Participation" && (
              <>
                <FormSection title="Are you participating as a member?" description={existing ? "Participation is fixed when the group is created." : "If yes, you occupy one of the member positions and contribute every month like everyone else."}>
                  <div className="choice-grid" role="radiogroup" aria-label="Organizer participation">
                    <ChoiceCard selected={!form.organizerParticipates} onSelect={() => { set("organizerParticipates", false); set("organizerFirstPayout", false); }} disabled={!!existing} title="No, I only organize" description={`All ${form.memberLimit || "—"} positions are open to members.`} />
                    <ChoiceCard selected={form.organizerParticipates} onSelect={() => set("organizerParticipates", true)} disabled={!!existing} title="Yes, I save too" description={`You take one position; ${calc.externalSlots !== null ? Math.max(0, Number(form.memberLimit) - 1) : "—"} positions remain for members.`} />
                  </div>
                </FormSection>
                <FormSection title="First payout" description="Only available when you participate. This is always disclosed to members before they apply.">
                  <div className="choice-grid" role="radiogroup" aria-label="Organizer first payout">
                    <ChoiceCard selected={!form.organizerFirstPayout} onSelect={() => set("organizerFirstPayout", false)} disabled={!form.organizerParticipates} title="No reservation" description={`Every cycle, including the first, uses ${form.groupType === "AUCTION" ? "the auction" : "the random draw"}.`} />
                    <ChoiceCard selected={form.organizerFirstPayout} onSelect={() => set("organizerFirstPayout", true)} disabled={!form.organizerParticipates} title="Reserve the first payout for me" description={`Cycle 1 payout (full group value, no discount) goes to you. ${form.groupType === "AUCTION" ? "Auctions" : "Random draws"} begin from cycle 2.`} />
                  </div>
                </FormSection>
                {form.organizerFirstPayout && (
                  <Callout variant="warning" title="What members will see">
                    “Organizer receives first payout” is shown on the group card and in the rules. You must keep contributing for all remaining cycles after receiving it.
                  </Callout>
                )}
              </>
            )}

            {stepName === "Schedule" && (
              <>
                <FormField label="Start date" htmlFor="group-startDate" required error={errors.startDate} help="The first cycle begins in this month. Business dates use Asia/Kolkata (IST).">
                  <Input id="group-startDate" type="date" min={existing ? undefined : today} value={form.startDate} onChange={(e) => set("startDate", e.target.value)} invalid={!!errors.startDate} disabled={locked} style={{ maxWidth: 260 }} />
                </FormField>
                <div className="grid-3">
                  <FormField label="Contribution day" htmlFor="group-contributionDueDay" required error={errors.contributionDueDay} help="Day of the month contributions are due.">
                    <Input id="group-contributionDueDay" type="number" inputMode="numeric" min={1} max={28} value={form.contributionDueDay} onChange={(e) => set("contributionDueDay", e.target.value)} invalid={!!errors.contributionDueDay} disabled={locked} />
                  </FormField>
                  <FormField label={form.groupType === "AUCTION" ? "Auction day" : "Selection day"} htmlFor="group-selectionDay" required error={errors.selectionDay} help={form.groupType === "AUCTION" ? "Day the auction runs." : "Day the random draw runs."}>
                    <Input id="group-selectionDay" type="number" inputMode="numeric" min={1} max={28} value={form.selectionDay} onChange={(e) => set("selectionDay", e.target.value)} invalid={!!errors.selectionDay} disabled={locked} />
                  </FormField>
                  <FormField label="Payout day" htmlFor="group-payoutDay" required error={errors.payoutDay} help="Day the payout right is scheduled.">
                    <Input id="group-payoutDay" type="number" inputMode="numeric" min={1} max={28} value={form.payoutDay} onChange={(e) => set("payoutDay", e.target.value)} invalid={!!errors.payoutDay} disabled={locked} />
                  </FormField>
                </div>
                {form.groupType === "AUCTION" && (
                  <FormSection title="Auction configuration" description="Discount limits apply to every auction cycle. Times are UTC clock times used by the server (10:00 UTC = 3:30 pm IST).">
                    <div className="grid-3">
                      <FormField label="Minimum discount" htmlFor="group-minimumDiscount" required error={errors.minimumDiscount}><MoneyInput id="group-minimumDiscount" value={form.minimumDiscount} onChange={(v) => set("minimumDiscount", v)} invalid={!!errors.minimumDiscount} disabled={locked} /></FormField>
                      <FormField label="Maximum discount" htmlFor="group-maximumDiscount" required error={errors.maximumDiscount}><MoneyInput id="group-maximumDiscount" value={form.maximumDiscount} onChange={(v) => set("maximumDiscount", v)} invalid={!!errors.maximumDiscount} disabled={locked} /></FormField>
                      <FormField label="Bid increment" htmlFor="group-bidIncrement" required error={errors.bidIncrement}><MoneyInput id="group-bidIncrement" value={form.bidIncrement} onChange={(v) => set("bidIncrement", v)} invalid={!!errors.bidIncrement} disabled={locked} /></FormField>
                    </div>
                    <div className="grid-2">
                      <FormField label="Auction opens (UTC)" htmlFor="group-auctionStartTime" required error={errors.auctionStartTime}><Input id="group-auctionStartTime" type="time" step={60} value={form.auctionStartTime.slice(0, 5)} onChange={(e) => set("auctionStartTime", normalizeTime(e.target.value))} invalid={!!errors.auctionStartTime} disabled={locked} /></FormField>
                      <FormField label="Auction closes (UTC)" htmlFor="group-auctionEndTime" required error={errors.auctionEndTime}><Input id="group-auctionEndTime" type="time" step={60} value={form.auctionEndTime.slice(0, 5)} onChange={(e) => set("auctionEndTime", normalizeTime(e.target.value))} invalid={!!errors.auctionEndTime} disabled={locked} /></FormField>
                    </div>
                  </FormSection>
                )}
              </>
            )}

            {stepName === "Rules" && (
              <FormSection title="Contribution collection" description="Platform groups may collect through Razorpay Test Checkout; manual tracking records contributions operationally without moving money.">
                <div className="choice-grid" role="radiogroup" aria-label="Collection mode">
                  <ChoiceCard selected={form.collectionMode === "MANUAL_TRACKING"} onSelect={() => set("collectionMode", "MANUAL_TRACKING")} disabled={locked} title="Manual tracking" description="Dhanvi admin records each contribution as it is reported. No gateway payments." points={["Operational records only", "Selection unlocks once all are recorded"]} />
                  <ChoiceCard selected={form.collectionMode === "RAZORPAY"} onSelect={() => set("collectionMode", "RAZORPAY")} disabled={locked} title="Razorpay (test)" description="Members pay through Razorpay Checkout; only verified captures settle a contribution." points={["Members pay in the app", "Admin intervenes only on reconciliation issues"]} />
                </div>
              </FormSection>
            )}

            {stepName === "Review & publish" && (
              <>
                <RuleList items={[{ key: "Creator", value: scope === "admin" ? "Dhanvi platform" : "Organizer" }]} />
                <RuleList items={[
                  { key: "Group name", value: form.name || "—" },
                  { key: "Group type", value: form.groupType === "AUCTION" ? "Auction" : "Random" },
                  { key: "Group value", value: formatMoney(Number(form.groupValue) || 0) },
                  { key: "Members", value: form.memberLimit },
                  { key: "Monthly contribution", value: calc.monthly !== null ? formatMoney(calc.monthly) : "—" },
                  { key: "Duration", value: `${calc.duration ?? "—"} months` },
                  ...(scope === "organizer" ? [
                    { key: "Organizer participating", value: form.organizerParticipates ? "Yes" : "No" },
                    { key: "First payout", value: form.organizerFirstPayout ? "Organizer reserved (cycle 1)" : form.groupType === "AUCTION" ? "Auction from cycle 1" : "Random draw from cycle 1" },
                  ] : []),
                  { key: "Start date", value: form.startDate ? formatDate(form.startDate) : "—" },
                  { key: "Contribution date", value: formatMonthlyDay(Number(form.contributionDueDay) || 1) },
                  { key: form.groupType === "AUCTION" ? "Auction date" : "Selection date", value: formatMonthlyDay(Number(form.selectionDay) || 1) },
                  { key: "Payout date", value: formatMonthlyDay(Number(form.payoutDay) || 1) },
                  { key: "Start rule", value: "Starts when full, every member accepted the rules and the group is activated" },
                  ...(scope === "admin" ? [{ key: "Collection", value: form.collectionMode === "RAZORPAY" ? "Razorpay Test Checkout" : "Manual tracking" }] : []),
                  ...(form.groupType === "AUCTION" ? [
                    { key: "Discount range", value: `${formatMoney(Number(form.minimumDiscount) || 0)} – ${formatMoney(Number(form.maximumDiscount) || 0)}` },
                    { key: "Bid increment", value: formatMoney(Number(form.bidIncrement) || 0) },
                    { key: "Auction window", value: `${formatClockTime(form.auctionStartTime)} – ${formatClockTime(form.auctionEndTime)}` },
                  ] : []),
                ]} />
                {form.description && <div><div className="text-sm text-muted" style={{ marginBottom: 4 }}>Description</div><p className="text-secondary" style={{ whiteSpace: "pre-wrap" }}>{form.description}</p></div>}
                <Callout variant="info">{existing ? "Saving updates the draft. Rules become binding when the group is published." : "Publish now to open applications, or save a draft to edit later. Once a member is approved, core rules are locked."}</Callout>
              </>
            )}

            {error && <Callout variant="danger">{error}</Callout>}
          </CardBody>
          <div className="card__footer form-actions form-actions--between">
            <div className="row">
              {onCancel && <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>}
              {step > 0 && <Button variant="secondary" icon={<Icons.ChevronLeft size={16} />} onClick={() => setStep((s) => s - 1)} disabled={busy}>Back</Button>}
            </div>
            {stepName === "Review & publish"
              ? (existing
                ? <Button type="submit" loading={busy} icon={<Icons.Check size={16} />}>Save changes</Button>
                : <span className="row"><Button type="submit" variant="secondary" loading={busy && !publishAfterSave} disabled={busy} onClick={() => setPublishAfterSave(false)}>Save as draft</Button><Button type="submit" loading={busy && publishAfterSave} disabled={busy} onClick={() => setPublishAfterSave(true)} icon={<Icons.Send size={16} />}>Publish group</Button></span>)
              : <Button onClick={next}>Continue <Icons.ChevronRight size={16} /></Button>}
          </div>
        </Card>
      </div>

      <aside className="wizard__calc stack" aria-live="polite" aria-label="Live calculation">
        <Card>
          <CardHeader title="Group summary" subtitle="Updates as you type" />
          <CardBody>
            <KeyValueRows items={summaryRows} />
            {!calc.exact && calc.valid && <p className="text-sm text-danger" style={{ marginTop: 12 }}>Value must divide exactly among members.</p>}
          </CardBody>
        </Card>
        <Card muted>
          <CardBody className="stack stack--sm">
            <div className="row" style={{ gap: 8 }}><Icons.Info size={16} style={{ color: "var(--color-text-muted)" }} /><span className="text-sm text-strong">Good to know</span></div>
            <p className="text-sm text-secondary">Each member receives the main payout once and keeps contributing for every remaining cycle. No money is collected through Dhanvi at this stage.</p>
          </CardBody>
        </Card>
      </aside>
    </form>
  );
}
