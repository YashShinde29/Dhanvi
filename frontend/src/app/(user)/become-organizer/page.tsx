"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { ProtectedPage } from "@/features/auth/protected-page";
import { organizerService, type OrganizerApplicationInput } from "@/services/organizer.service";
import type { OrganizerStatusResponse } from "@/types/organizer";
import { errorMessage } from "@/utils/forms";

const empty: OrganizerApplicationInput = { address: "", city: "", state: "", postalCode: "", reasonForBecomingOrganizer: "", experienceDescription: "" };

export default function BecomeOrganizerPage() {
  const [status, setStatus] = useState<OrganizerStatusResponse | null>(null); const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { organizerService.myStatus().then(setStatus).catch(failure => setError(errorMessage(failure))).finally(() => setLoading(false)); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { setStatus(await organizerService.apply(form)); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  const canApply = status?.status === "NOT_APPLIED" || status?.status === "REJECTED";
  return <ProtectedPage><section className="panel wide"><p className="eyebrow">Organizer program</p><h1>Become an organizer</h1>
    <p>An approved organizer will later be able to create and manage Dhanvi savings groups.</p>
    {loading && <p>Loading application status...</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {status && !canApply && <div><p>Your application status is <strong>{status.status.replaceAll("_", " ")}</strong>.</p><Link className="text-link" href="/organizer/application-status">See application details</Link></div>}
    {status?.status === "REJECTED" && <p className="status-note">Your previous application was rejected. You may submit a new application below.</p>}
    {canApply && <form className="form-stack" onSubmit={submit}>
      <div className="form-grid"><label>Street address<input required value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></label>
      <label>City<input required value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} /></label>
      <label>State<input required value={form.state} onChange={e => setForm({ ...form, state: e.target.value })} /></label>
      <label>Postal code<input required value={form.postalCode} onChange={e => setForm({ ...form, postalCode: e.target.value })} /></label></div>
      <label>Why do you want to become an organizer?<textarea required rows={4} value={form.reasonForBecomingOrganizer} onChange={e => setForm({ ...form, reasonForBecomingOrganizer: e.target.value })} /></label>
      <label>Relevant experience (optional)<textarea rows={4} value={form.experienceDescription} onChange={e => setForm({ ...form, experienceDescription: e.target.value })} /></label>
      <button className="button" disabled={busy}>{busy ? "Submitting..." : "Submit application"}</button>
    </form>}
  </section></ProtectedPage>;
}
