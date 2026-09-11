"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ProtectedPage } from "@/features/auth/protected-page";
import { useAuth } from "@/features/auth/auth-context";
import { organizerService, type OrganizerApplicationInput } from "@/services/organizer.service";
import { useAsyncData } from "@/hooks/use-async-data";
import { PageHeader } from "@/components/ui/page-header";
import { Button, LinkButton } from "@/components/ui/button";
import { Callout, ErrorState } from "@/components/ui/callout";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormField, FormSection, Input, Textarea } from "@/components/ui/form";
import { Icons } from "@/components/ui/icons";
import { StatusBadge } from "@/components/ui/badge";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { fieldErrors, friendlyError } from "@/lib/errors";

const empty: OrganizerApplicationInput = { address: "", city: "", state: "", postalCode: "", reasonForBecomingOrganizer: "", experienceDescription: "" };

export default function BecomeOrganizerPage() {
  return <ProtectedPage><BecomeOrganizer /></ProtectedPage>;
}

function BecomeOrganizer() {
  const auth = useAuth();
  const router = useRouter();
  const toast = useToast();
  const status = useAsyncData(() => organizerService.myStatus(), [auth.user?.id]);
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const set = (key: keyof OrganizerApplicationInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setForm({ ...form, [key]: e.target.value }); if (errors[key]) setErrors({ ...errors, [key]: "" }); };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const next: Record<string, string> = {};
    if (!form.address.trim()) next.address = "Enter your street address.";
    if (!form.city.trim()) next.city = "Enter your city.";
    if (!form.state.trim()) next.state = "Enter your state.";
    if (!form.postalCode.trim()) next.postalCode = "Enter your postal code.";
    if (form.reasonForBecomingOrganizer.trim().length < 20) next.reasonForBecomingOrganizer = "Tell us a little more (at least 20 characters).";
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) { document.getElementById(`org-${first}`)?.focus(); return; }
    setBusy(true); setFailure("");
    try {
      await organizerService.apply({ ...form, experienceDescription: form.experienceDescription?.trim() || undefined });
      await auth.refreshUser();
      toast.success("Application submitted", "Dhanvi will review your organizer application.");
      router.push("/organizer/application-status");
    } catch (error) {
      const fields = fieldErrors(error);
      if (Object.keys(fields).length) setErrors(fields); else setFailure(friendlyError(error));
      setBusy(false);
    }
  }

  if (status.error) return <ErrorState message={status.error} onRetry={status.reload} />;
  if (!status.data) return <PageSkeleton />;
  const current = status.data.status;
  const canApply = current === "NOT_APPLIED" || current === "REJECTED";

  return (
    <div className="stack stack--lg">
      <PageHeader eyebrow="Organizer program" title="Become an organizer" description="Approved organizers create and manage savings groups on Dhanvi. Applications are reviewed by the Dhanvi team." />
      {!canApply && (
        <Card>
          <CardBody className="stack">
            <div className="row" style={{ gap: 10 }}><span className="text-strong">Your application status</span><StatusBadge kind="organizer" value={current} /></div>
            <p className="text-secondary">{current === "APPROVED" ? "You're an approved organizer. Create and manage groups from your organizer dashboard." : current === "SUSPENDED" ? "Your organizer access is currently suspended." : "Your application is with the Dhanvi team."}</p>
            <div className="row">{current === "APPROVED" ? <LinkButton href="/organizer">Go to organizer dashboard</LinkButton> : <LinkButton href="/organizer/application-status" variant="secondary">See application details</LinkButton>}</div>
          </CardBody>
        </Card>
      )}
      {current === "REJECTED" && <Callout variant="warning" title="Previous application not approved">{status.data.application?.rejectionReason || "You may submit a new application below."} <Link className="link" href="/organizer/application-status">View details</Link></Callout>}
      {canApply && (
        <div className="grid-sidebar">
          <Card>
            <CardHeader title="Organizer application" />
            <CardBody>
              <form className="stack stack--lg" onSubmit={submit} noValidate>
                <FormSection title="Address" description="Used for verification only. Never shown publicly.">
                  <FormField label="Street address" htmlFor="org-address" required error={errors.address}><Input id="org-address" value={form.address} onChange={set("address")} invalid={!!errors.address} autoComplete="street-address" /></FormField>
                  <div className="grid-3">
                    <FormField label="City" htmlFor="org-city" required error={errors.city}><Input id="org-city" value={form.city} onChange={set("city")} invalid={!!errors.city} autoComplete="address-level2" /></FormField>
                    <FormField label="State" htmlFor="org-state" required error={errors.state}><Input id="org-state" value={form.state} onChange={set("state")} invalid={!!errors.state} autoComplete="address-level1" /></FormField>
                    <FormField label="Postal code" htmlFor="org-postalCode" required error={errors.postalCode}><Input id="org-postalCode" value={form.postalCode} onChange={set("postalCode")} invalid={!!errors.postalCode} inputMode="numeric" autoComplete="postal-code" /></FormField>
                  </div>
                </FormSection>
                <FormSection title="About you">
                  <FormField label="Why do you want to become an organizer?" htmlFor="org-reasonForBecomingOrganizer" required error={errors.reasonForBecomingOrganizer} help="Describe the community you'd organize for and how you'd run the group."><Textarea id="org-reasonForBecomingOrganizer" rows={4} value={form.reasonForBecomingOrganizer} onChange={set("reasonForBecomingOrganizer")} invalid={!!errors.reasonForBecomingOrganizer} /></FormField>
                  <FormField label="Relevant experience" htmlFor="org-experienceDescription" optional error={errors.experienceDescription}><Textarea id="org-experienceDescription" rows={4} value={form.experienceDescription ?? ""} onChange={set("experienceDescription")} invalid={!!errors.experienceDescription} /></FormField>
                </FormSection>
                {failure && <Callout variant="danger">{failure}</Callout>}
                <div className="form-actions"><Button type="submit" loading={busy} icon={<Icons.Send size={16} />}>Submit application</Button></div>
              </form>
            </CardBody>
          </Card>
          <div className="stack">
            <Card muted>
              <CardBody className="stack stack--sm">
                <div className="text-strong">What organizers can do</div>
                <ul className="choice__list"><li>Create random or auction savings groups</li><li>Review and approve member applications</li><li>Publish versioned group rules</li><li>Record contributions each cycle</li><li>Run verifiable draws or auctions</li></ul>
              </CardBody>
            </Card>
            <Card muted>
              <CardBody className="stack stack--sm">
                <div className="text-strong">What we check</div>
                <p className="text-sm text-secondary">Applications are reviewed manually. Organizers who break group rules can be suspended, which blocks group management.</p>
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
