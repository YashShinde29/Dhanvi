"use client";
import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { groupService, type GroupScope } from "@/services/group.service";
import type { AuctionRules, Group, GroupInput } from "@/types/group";
import { Guard, groupHref } from "./shared";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/callout";
import { ChoiceCard, FormField, FormSection, Input, MoneyInput, Textarea } from "@/components/ui/form";
import { KeyValueRows, RuleList } from "@/components/ui/description";
import { Icons } from "@/components/ui/icons";
import { Steps } from "@/components/ui/timeline";
import { useToast } from "@/components/ui/toast";
import { fieldErrors, friendlyError } from "@/lib/errors";
import { formatClockTime, formatDate, formatMoney, formatMonthlyDay } from "@/lib/format";

export function GroupCreatePage({ scope }: { scope: "organizer" | "admin" }) {
  return (
    <Guard scope={scope}>
      <PageHeader eyebrow={scope === "admin" ? "Administration" : "Organizer"} title={scope === "admin" ? "Create platform group" : "Create a savings group"}
        description="Set up the group step by step. Members will see every rule you define here before they apply." breadcrumbs={[{ label: scope === "admin" ? "Platform groups" : "My groups", href: `/${scope}/groups` }, { label: "Create group" }]} />
      <GroupWizard scope={scope} />
    </Guard>
  );
}

interface FormState {
  name: string; description: string; groupType: "RANDOM" | "AUCTION"; groupValue: string; memberLimit: string;
  organizerParticipates: boolean; organizerFirstPayout: boolean; contributionDueDay: string; selectionDay: string; payoutDay: string; startDate: string;
  minimumDiscount: string; maximumDiscount: string; bidIncrement: string; auctionStartTime: string; auctionEndTime: string;
}
type Errors = Partial<Record<keyof FormState, string>>;

const defaultAuction: AuctionRules = { minimumDiscount: 0, maximumDiscount: 10000, bidIncrement: 100, auctionStartTime: "10:00:00", auctionEndTime: "11:00:00" };

function fromGroup(existing?: Group): FormState {
  const auction = existing?.auctionRules ?? defaultAuction;
  return {
    name: existing?.name ?? "", description: existing?.description ?? "", groupType: existing?.groupType ?? "RANDOM",
    groupValue: existing ? String(existing.groupValue) : "500000", memberLimit: existing ? String(existing.memberLimit) : "20",
    organizerParticipates: existing?.organizerParticipates ?? false, organizerFirstPayout: existing?.organizerFirstPayout ?? false,
    contributionDueDay: String(existing?.contributionDueDay ?? 1), selectionDay: String(existing?.selectionDay ?? 2), payoutDay: String(existing?.payoutDay ?? 2),
    startDate: existing?.startDate ?? "",
    minimumDiscount: String(auction.minimumDiscount), maximumDiscount: String(auction.maximumDiscount), bidIncrement: String(auction.bidIncrement),
    auctionStartTime: auction.auctionStartTime, auctionEndTime: auction.auctionEndTime,
  };
}

const normalizeTime = (value: string) => (value.length === 5 ? `${value}:00` : value);

function toInput(form: FormState): GroupInput {
  return {
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

const STEPS_ORGANIZER = ["Basics", "Group value", "Participation", "Schedule", "Review"];
const STEPS_ADMIN = ["Basics", "Group value", "Schedule", "Review"];

export function GroupWizard({ scope, existing, onSaved, onCancel }: { scope: GroupScope; existing?: Group; onSaved?: () => void; onCancel?: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => fromGroup(existing));
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = !!existing?.rulesLocked;
  const stepNames = locked ? ["Basics", "Review"] : scope === "organizer" ? STEPS_ORGANIZER : STEPS_ADMIN;
  const [step, setStep] = useState(0);
  const stepName = stepNames[step]!;
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
    if (name === "Group value") {
      if (!calc.valid) { if (!(Number(form.groupValue) > 0)) next.groupValue = "Enter the total group value."; }
      const members = Number(form.memberLimit);
      if (!Number.isInteger(members) || members < 20 || members > 50) next.memberLimit = "Choose between 20 and 50 members.";
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
    if (busy || stepName !== "Review") return;
    for (const name of stepNames) if (!validate(name)) { setStep(stepNames.indexOf(name)); return; }
    setBusy(true); setError("");
    try {
      const saved = await groupService.save(scope, toInput(form), existing?.id);
      toast.success(existing ? "Group updated" : "Group created", existing ? undefined : "Your group is saved as a draft. Publish it when you're ready to accept applications.");
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
    const map: Record<string, string> = { name: "Basics", description: "Basics", groupType: "Basics", groupValue: "Group value", memberLimit: "Group value", organizerParticipates: "Participation", organizerFirstPayout: "Participation" };
    const name = map[field] ?? "Schedule";
    const index = stepNames.indexOf(name);
    return index === -1 ? 0 : index;
  }

  const summaryRows = [
    { key: "Group value", value: <span className="amount">{formatMoney(Number(form.groupValue) || 0)}</span> },
    { key: "Members", value: form.memberLimit || "—" },
    { key: "Monthly contribution", value: <span className="amount">{calc.monthly !== null ? formatMoney(calc.monthly) : "—"}</span> },
    { key: "Duration", value: calc.duration ? `${calc.duration} months` : "—" },
    ...(scope === "organizer" ? [{ key: "External positions", value: calc.externalSlots ?? "—" }] : []),
  ];

  return (
    <form className="wizard" onSubmit={submit} noValidate>
      <div className="stack stack--lg">
        <Card>
          <CardBody>
            <Steps steps={stepNames} current={step} />
          </CardBody>
        </Card>
        {locked && <Callout variant="info" title="Core rules are locked">A member has been approved, so financial rules can no longer change. You can still update the name and description.</Callout>}

        <Card>
          <CardHeader title={stepName === "Basics" ? "Group basics" : stepName === "Group value" ? "Group value and members" : stepName === "Participation" ? "Your participation" : stepName === "Schedule" ? "Monthly schedule" : "Review and confirm"}
            subtitle={stepName === "Basics" ? "Name the group and choose how the payout turn is decided." : stepName === "Group value" ? "The monthly contribution and duration are calculated from these two values." : stepName === "Participation" ? "Decide whether you save alongside members and whether you take the first payout." : stepName === "Schedule" ? "Days apply to every month of the group. Use 1–28 so every month has the date." : "Check every rule. After publishing, members will accept exactly these rules."} />
          <CardBody className="stack stack--lg">
            {stepName === "Basics" && (
              <>
                <FormField label="Group name" htmlFor="group-name" required error={errors.name} help="Shown to members when browsing, e.g. “Vashi Savings Circle — ₹5 lakh”.">
                  <Input id="group-name" value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={200} invalid={!!errors.name} autoFocus />
                </FormField>
                <FormField label="Description" htmlFor="group-description" optional error={errors.description} help="Who this group is for and anything members should know before applying.">
                  <Textarea id="group-description" value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={4000} rows={4} invalid={!!errors.description} />
                </FormField>
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

            {stepName === "Group value" && (
              <>
                <div className="grid-2">
                  <FormField label="Group value" htmlFor="group-groupValue" required error={errors.groupValue} help="Total pool each cycle, e.g. ₹5,00,000.">
                    <MoneyInput id="group-groupValue" value={form.groupValue} onChange={(v) => set("groupValue", v)} invalid={!!errors.groupValue} disabled={locked} />
                  </FormField>
                  <FormField label="Number of members" htmlFor="group-memberLimit" required error={errors.memberLimit} help="Between 20 and 50. Duration equals the number of members.">
                    <Input id="group-memberLimit" type="number" inputMode="numeric" min={20} max={50} value={form.memberLimit} onChange={(e) => set("memberLimit", e.target.value)} invalid={!!errors.memberLimit} disabled={locked} />
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

            {stepName === "Review" && (
              <>
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
                  ...(form.groupType === "AUCTION" ? [
                    { key: "Discount range", value: `${formatMoney(Number(form.minimumDiscount) || 0)} – ${formatMoney(Number(form.maximumDiscount) || 0)}` },
                    { key: "Bid increment", value: formatMoney(Number(form.bidIncrement) || 0) },
                    { key: "Auction window", value: `${formatClockTime(form.auctionStartTime)} – ${formatClockTime(form.auctionEndTime)}` },
                  ] : []),
                ]} />
                {form.description && <div><div className="text-sm text-muted" style={{ marginBottom: 4 }}>Description</div><p className="text-secondary" style={{ whiteSpace: "pre-wrap" }}>{form.description}</p></div>}
                <Callout variant="info">{existing ? "Saving updates the draft. Rules become binding when the group is published." : "The group is saved as a draft. You can edit it until you publish. Once a member is approved, core rules are locked."}</Callout>
              </>
            )}

            {error && <Callout variant="danger">{error}</Callout>}
          </CardBody>
          <div className="card__footer form-actions form-actions--between">
            <div className="row">
              {onCancel && <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>}
              {step > 0 && <Button variant="secondary" icon={<Icons.ChevronLeft size={16} />} onClick={() => setStep((s) => s - 1)} disabled={busy}>Back</Button>}
            </div>
            {stepName === "Review"
              ? <Button type="submit" loading={busy} icon={<Icons.Check size={16} />}>{existing ? "Save changes" : "Create group"}</Button>
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
