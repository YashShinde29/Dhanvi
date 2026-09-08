"use client";

import { useCallback, useEffect, useState } from "react";
import { ProtectedPage } from "@/features/auth/protected-page";
import { organizerService } from "@/services/organizer.service";
import type { OrganizerApplicationSummary, PagedResponse } from "@/types/organizer";
import { errorMessage } from "@/utils/forms";

export default function AdminOrganizersPage() {
  const [result, setResult] = useState<PagedResponse<OrganizerApplicationSummary> | null>(null); const [status, setStatus] = useState(""); const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<OrganizerApplicationSummary | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState("");
  const load = useCallback(async () => { try { setResult(await organizerService.applications(1, 50, status, search)); setError(""); } catch (failure) { setError(errorMessage(failure)); } }, [status, search]);
  useEffect(() => {
    let active = true;
    organizerService.applications(1, 50, status, search)
      .then(data => { if (active) { setResult(data); setError(""); } })
      .catch(failure => { if (active) setError(errorMessage(failure)); });
    return () => { active = false; };
  }, [status, search]);
  async function approve(item: OrganizerApplicationSummary) {
    if (!window.confirm(`Approve ${item.applicant} as an organizer?`)) return;
    setBusy(item.id); try { await organizerService.approve(item.id); await load(); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(""); }
  }
  async function reject(item: OrganizerApplicationSummary) {
    const reason = window.prompt(`Reason for rejecting ${item.applicant}:`); if (!reason?.trim()) return;
    setBusy(item.id); try { await organizerService.reject(item.id, reason); await load(); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(""); }
  }
  return <ProtectedPage roles={["ADMIN", "SUPER_ADMIN"]}><section><p className="eyebrow">Administration</p><h1>Organizer applications</h1>
    <div className="filters"><label>Search<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or email" /></label><label>Status<select value={status} onChange={e => setStatus(e.target.value)}><option value="">All</option><option>PENDING</option><option>UNDER_REVIEW</option><option>APPROVED</option><option>REJECTED</option><option>SUSPENDED</option></select></label></div>
    {error && <p className="form-error">{error}</p>}
    <div className="table-wrap"><table><thead><tr><th>Applicant</th><th>Submitted</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      {result?.items.map(item => <tr key={item.id}><td><strong>{item.applicant}</strong><small>{item.email}</small></td><td>{new Date(item.submittedAt).toLocaleDateString()}</td><td><span className="status-badge">{item.status.replaceAll("_", " ")}</span></td><td className="row-actions"><button onClick={() => setSelected(item)}>View</button>{(item.status === "PENDING" || item.status === "UNDER_REVIEW") && <><button disabled={busy === item.id} onClick={() => approve(item)}>Approve</button><button className="danger" disabled={busy === item.id} onClick={() => reject(item)}>Reject</button></>}</td></tr>)}
      {!result?.items.length && <tr><td colSpan={4}>No applications found.</td></tr>}
    </tbody></table></div>
    {selected && <aside className="panel compact detail-panel"><button className="close-button" aria-label="Close details" onClick={() => setSelected(null)}>×</button><h2>{selected.applicant}</h2><p>{selected.email}{selected.phone ? ` · ${selected.phone}` : ""}</p><p>Submitted {new Date(selected.submittedAt).toLocaleString()}</p><p>Status: {selected.status.replaceAll("_", " ")}</p></aside>}
  </section></ProtectedPage>;
}
