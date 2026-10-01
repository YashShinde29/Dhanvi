"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Auction, AuctionScheduleChange, AuctionScheduleReason, Group, MonthlyCycle } from "@dhanvi/types";
import { ApiError, auctionService } from "@dhanvi/api-client";
import { Button, Callout, Dialog, Drawer, FormField, Input, KeyValueRows, Select, Textarea, useToast } from "@dhanvi/ui";
import { AUCTION_RESCHEDULE_REASONS, auctionReasonLabel, formatDate, formatDateTime, formatTime, friendlyError, timeZoneLabel, utcToZonedFields, zonedToUtc } from "@dhanvi/utils";

const MIN_OTHER = 5, MAX_TEXT = 500, MAX_MESSAGE = 300, HISTORY_PAGE = 5;

/** "21 Sep 2026 · 6:00 PM – 7:00 PM IST" for a window, in the group's zone. */
export function formatWindow(startsAt: string, endsAt: string, zone: string): string {
  const sameDay = formatDate(startsAt, zone) === formatDate(endsAt, zone);
  return sameDay ? `${formatDate(startsAt, zone)} · ${formatTime(startsAt, zone).replace(/\s\S+$/, "")} – ${formatTime(endsAt, zone)}` : `${formatDateTime(startsAt, zone)} → ${formatDateTime(endsAt, zone)}`;
}
export const rescheduledTimes = (n: number) => `Rescheduled ${n === 1 ? "once" : `${n} times`}`;

interface Props {
  scope: "organizer" | "admin";
  group: Group;
  cycle: MonthlyCycle;
  auction: Auction;
  /** Called with the authoritative auction after a successful change. */
  onChanged: (auction: Auction) => void;
  /** Re-read the auction (after a conflict, so the operator reviews the latest schedule). */
  onRefresh: () => Promise<void>;
}

/**
 * Reschedule a SCHEDULED auction: new date/time in the group's time zone, a structured reason (code + internal explanation +
 * optional member message), review, then confirm. Only the confirmation step calls the backend, with an idempotency key
 * and the schedule version the operator saw.
 */
export function RescheduleAuctionDialog({ scope, group, cycle, auction: a, onChanged, onRefresh }: Props) {
  const toast = useToast();
  const zone = group.groupTimeZone;
  const current = useMemo(() => utcToZonedFields(a.startsAt, zone), [a.startsAt, zone]);
  const durationMinutes = Math.max(1, Math.round((new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60000));
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"form" | "confirm" | "conflict">("form");
  const [date, setDate] = useState(current.date);
  const [startTime, setStartTime] = useState(current.time);
  const [endTime, setEndTime] = useState(utcToZonedFields(a.endsAt, zone).time);
  const [endEdited, setEndEdited] = useState(false);
  const [code, setCode] = useState<AuctionScheduleReason>("PUBLIC_HOLIDAY");
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = useRef<{ payload: string; value: string } | null>(null);

  function reset() { const c = utcToZonedFields(a.startsAt, zone); setDate(c.date); setStartTime(c.time); setEndTime(utcToZonedFields(a.endsAt, zone).time); setEndEdited(false); setCode("PUBLIC_HOLIDAY"); setText(""); setMessage(""); setTouched(false); setStep("form"); }
  function show() { reset(); setOpen(true); }
  function close() { if (!busy) setOpen(false); }
  // Changing the start keeps the auction's current duration unless the operator has set the end explicitly.
  function changeStart(value: string) {
    setStartTime(value);
    if (endEdited || !/^\d{2}:\d{2}$/.test(value)) return;
    const [h, m] = value.split(":").map(Number); const total = (h! * 60 + m! + durationMinutes) % (24 * 60);
    setEndTime(`${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`);
  }

  const newStartsAt = zonedToUtc(date, startTime, zone);
  const newEndsAt = zonedToUtc(date, endTime, zone);
  const errors = {
    date: !date ? "Choose the new auction date." : undefined,
    startTime: !startTime ? "Choose the new start time." : newStartsAt && new Date(newStartsAt).getTime() <= new Date(a.serverTime).getTime() ? "The new start must be in the future." : undefined,
    endTime: !endTime ? "Choose the new end time." : newStartsAt && newEndsAt && new Date(newEndsAt) <= new Date(newStartsAt) ? "The auction must end after it starts." : undefined,
    text: code === "OTHER" && text.trim().length < MIN_OTHER ? `Explain the reason in at least ${MIN_OTHER} characters.` : text.length > MAX_TEXT ? `Keep the explanation within ${MAX_TEXT} characters.` : undefined,
    message: message.length > MAX_MESSAGE ? `Keep the member message within ${MAX_MESSAGE} characters.` : undefined,
    unchanged: newStartsAt && newEndsAt && Date.parse(newStartsAt) === Date.parse(a.startsAt) && Date.parse(newEndsAt) === Date.parse(a.endsAt) ? "That is already the current schedule. Choose a different date or time." : undefined,
  };
  const valid = !errors.date && !errors.startTime && !errors.endTime && !errors.text && !errors.message && !errors.unchanged && newStartsAt && newEndsAt;

  function review() { setTouched(true); if (valid) setStep("confirm"); }
  async function confirm() {
    if (!valid || busy) return;
    const input = { newStartsAt: newStartsAt!, newEndsAt: newEndsAt!, reasonCode: code, reasonText: text.trim() || null, memberMessage: message.trim() || null, expectedScheduleVersion: a.scheduleVersion };
    const payload = JSON.stringify(input);
    if (key.current?.payload !== payload) key.current = { payload, value: crypto.randomUUID() };
    setBusy(true);
    try {
      const updated = await auctionService.reschedule(scope, group.id, cycle.id, input, key.current.value);
      key.current = null; setOpen(false); onChanged(updated);
      toast.success("Auction rescheduled ✓", `New schedule: ${formatWindow(updated.startsAt, updated.endsAt, zone)}. Members see the updated schedule.`);
    } catch (failure) {
      const c = failure instanceof ApiError ? failure.code : null;
      if (c === "AUCTION_SCHEDULE_CONFLICT") { await onRefresh(); setStep("conflict"); }
      else if (c === "AUCTION_ALREADY_OPEN" || c === "AUCTION_ALREADY_COMPLETED" || c === "AUCTION_RESCHEDULE_NOT_ALLOWED") { await onRefresh(); setOpen(false); toast.error("Schedule can no longer change", friendlyError(failure)); }
      else toast.error("Auction not rescheduled", friendlyError(failure));
    } finally { setBusy(false); }
  }

  const currentWindow = formatWindow(a.startsAt, a.endsAt, zone);
  const newWindow = newStartsAt && newEndsAt ? formatWindow(newStartsAt, newEndsAt, zone) : "—";
  return (
    <>
      <Button onClick={show} disabled={!a.canReschedule}>Reschedule auction</Button>
      {step === "form" && (
        <Dialog open={open} onClose={close} title="Reschedule auction" description={`${group.name} · Cycle ${cycle.cycleNumber} of ${group.durationMonths}`}
          footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button onClick={review} disabled={touched && !valid}>Review change</Button></>}>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); review(); }} noValidate>
            <div className="auc__formula" aria-label="Current schedule"><div className="text-xs text-muted" style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Current schedule</div><div className="text-strong">{currentWindow}</div>{a.wasRescheduled && <div className="text-xs text-muted">{rescheduledTimes(a.rescheduleCount)}</div>}</div>
            <FormField label="New date" htmlFor="resched-date" required error={touched ? errors.date : undefined}>
              <Input id="resched-date" type="date" value={date} min={utcToZonedFields(a.serverTime, zone).date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
            </FormField>
            <div className="grid-2">
              <FormField label="New start time" htmlFor="resched-start" required error={touched ? errors.startTime : undefined}>
                <Input id="resched-start" type="time" value={startTime} onChange={(e) => changeStart(e.target.value)} disabled={busy} step={300} />
              </FormField>
              <FormField label="New end time" htmlFor="resched-end" required error={touched ? errors.endTime : undefined} help={endEdited ? undefined : `Keeps the current ${durationMinutes >= 60 ? `${durationMinutes / 60} hour` : `${durationMinutes} minute`} duration.`}>
                <Input id="resched-end" type="time" value={endTime} onChange={(e) => { setEndTime(e.target.value); setEndEdited(true); }} disabled={busy} step={300} />
              </FormField>
            </div>
            <p className="text-sm text-muted" style={{ margin: 0 }}>Times are in {timeZoneLabel(zone)} — the group&apos;s business time zone, not your device&apos;s.</p>
            <FormField label="Reason" htmlFor="resched-reason" required>
              <Select id="resched-reason" value={code} onChange={(e) => setCode(e.target.value as AuctionScheduleReason)} disabled={busy}>{AUCTION_RESCHEDULE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</Select>
            </FormField>
            <FormField label="Additional explanation" htmlFor="resched-text" required={code === "OTHER"} optional={code !== "OTHER"} error={touched ? errors.text : undefined} help="Internal — for organizers and Dhanvi admins only. Members never see this.">
              <Textarea id="resched-text" value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={MAX_TEXT} disabled={busy} placeholder={code === "OTHER" ? "What changed and why" : "Ticket, incident or context for the team"} />
            </FormField>
            <FormField label="Member message" htmlFor="resched-message" optional error={touched ? errors.message : undefined} help="Shown to members with the reason, e.g. “Auction moved due to a public holiday.”">
              <Textarea id="resched-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={2} maxLength={MAX_MESSAGE} disabled={busy} />
            </FormField>
            {touched && errors.unchanged && <Callout variant="warning">{errors.unchanged}</Callout>}
            <div className="auc__preview" aria-live="polite">
              <span><span className="text-xs text-muted" style={{ display: "block" }}>Previous</span><strong style={{ fontSize: "var(--text-base)" }}>{formatDateTime(a.startsAt, zone)}</strong></span>
              <span style={{ textAlign: "right" }}><span className="text-xs text-muted" style={{ display: "block" }}>New</span><strong style={{ fontSize: "var(--text-base)" }}>{newStartsAt ? formatDateTime(newStartsAt, zone) : "—"}</strong></span>
            </div>
          </form>
        </Dialog>
      )}
      {step === "confirm" && (
        <Dialog open={open} onClose={close} title="Confirm auction reschedule" description="Members will see the updated schedule."
          footer={<><Button variant="secondary" onClick={() => setStep("form")} disabled={busy}>Back</Button><Button onClick={confirm} loading={busy} disabled={busy}>{busy ? "Rescheduling…" : "Confirm reschedule"}</Button></>}>
          <KeyValueRows items={[
            { key: "Group", value: group.name }, { key: "Cycle", value: `${cycle.cycleNumber} of ${group.durationMonths}` },
            ...(scope === "admin" ? [{ key: "Created by", value: group.creatorType === "PLATFORM" ? "Dhanvi platform" : group.organizer?.name ?? "Organizer" }, { key: "Group status", value: group.status.replace(/_/g, " ").toLowerCase() }] : []),
            { key: "Previous schedule", value: currentWindow }, { key: "New schedule", value: <strong>{newWindow}</strong> }, { key: "Reason", value: auctionReasonLabel(code) },
            ...(text.trim() ? [{ key: "Internal explanation", value: text.trim() }] : []), ...(message.trim() ? [{ key: "Member message", value: message.trim() }] : []),
          ]} />
          <p className="text-sm text-secondary" style={{ margin: 0 }}>The change is recorded with who made it and why. The previous schedule stays in the auction&apos;s history.</p>
        </Dialog>
      )}
      {step === "conflict" && (
        <Dialog open={open} onClose={close} title="The auction schedule changed while you were editing" footer={<Button onClick={() => setOpen(false)}>Reload schedule</Button>}>
          <Callout variant="warning" title="Your change was not applied">Someone else rescheduled this auction first.</Callout>
          <KeyValueRows items={[{ key: "Current schedule", value: <strong>{formatWindow(a.startsAt, a.endsAt, zone)}</strong> }]} />
          <p className="text-sm text-secondary" style={{ margin: 0 }}>Review the latest schedule before making another change.</p>
        </Dialog>
      )}
    </>
  );
}

/**
 * Paged, newest-first history of THIS auction only, loaded on demand: the first page when the drawer opens, five more per
 * "Load more". Members see the sanitized rows (reason label + member message, no actor, no internal text).
 */
export function ScheduleHistoryDrawer({ open, onClose, groupId, cycle, auction: a, zone, viewer }: { open: boolean; onClose: () => void; groupId: string; cycle: MonthlyCycle; auction: Auction; zone: string; viewer: "member" | "operator" }) {
  const [items, setItems] = useState<AuctionScheduleChange[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const load = async (next: number) => {
    setLoading(true); setError("");
    try { const result = await auctionService.scheduleHistory(groupId, cycle.id, next, HISTORY_PAGE); setItems((list) => (next === 1 ? result.items : [...list, ...result.items])); setTotal(result.totalCount); setPage(next); }
    catch (f) { setError(friendlyError(f)); } finally { setLoading(false); }
  };
  // The drawer fetches page 1 when it opens (and again if the auction moved meanwhile); the timer avoids setState in the effect body.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => { void load(1); }, 0);
    return () => window.clearTimeout(timer);
  }, [open, a.rescheduleCount, cycle.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const remaining = total === null ? 0 : total - items.length;
  return (
    <Drawer open={open} onClose={onClose} title={viewer === "member" ? "Schedule changes" : "Schedule history"}
      footer={<><span className="text-sm text-muted" style={{ marginRight: "auto" }}>{total !== null ? `Showing ${items.length} of ${total} change${total === 1 ? "" : "s"}` : ""}</span>{remaining > 0 && <Button variant="secondary" loading={loading} onClick={() => load(page + 1)}>Load more</Button>}<Button onClick={onClose}>Close</Button></>}>
      <div className="stack" style={{ gap: 12 }}>
        <div className="text-sm text-muted">Cycle {cycle.cycleNumber} · this auction only</div>
        <div className="auc__formula"><div className="text-xs text-muted" style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Current schedule</div><div className="text-strong">{formatWindow(a.startsAt, a.endsAt, zone)}</div></div>
        {error && <Callout variant="danger">{error}</Callout>}
        {total === 0 && <p className="text-sm text-muted" style={{ margin: 0 }}>This auction has not been rescheduled.</p>}
        <ol className="stack" style={{ margin: 0, padding: 0, listStyle: "none", gap: 10 }} aria-label="Schedule history">
          {items.map((c) => (
            <li key={c.id} className="card"><div className="card__body stack" style={{ gap: 6, padding: 14 }}>
              <div className="row row--between"><span className="text-strong">Reschedule #{c.changeSequence}</span><span className="text-xs text-muted">{formatDateTime(c.changedAt, zone)}</span></div>
              <dl className="auc__status-grid" style={{ margin: 0 }}>
                <div><dt>Previous</dt><dd style={{ fontSize: "var(--text-base)" }}>{formatDateTime(c.previousStartsAt, zone)}</dd></div>
                <div><dt>Changed to</dt><dd style={{ fontSize: "var(--text-base)" }}>{formatDateTime(c.newStartsAt, zone)}</dd></div>
              </dl>
              <div className="text-sm"><span className="text-muted">Reason:</span> {auctionReasonLabel(c.reasonCode)}{c.memberMessage && <span className="text-secondary"> — {c.memberMessage}</span>}</div>
              {viewer === "operator" && c.reasonText && <div className="text-sm text-secondary"><span className="text-muted">Internal note:</span> {c.reasonText}</div>}
              {viewer === "operator" && c.changedByRole && <div className="text-xs text-muted">Changed by {c.changedByRole === "ADMIN" ? "Dhanvi admin" : "organizer"}{c.changedByName ? ` · ${c.changedByName}` : ""}</div>}
            </div></li>
          ))}
          {loading && items.length === 0 && <li className="skeleton skeleton--card" style={{ height: 96 }} />}
        </ol>
        {a.originalStartsAt && total !== null && total > 0 && items.length >= total && <p className="text-xs text-muted" style={{ margin: 0 }}>Original schedule: {formatWindow(a.originalStartsAt, a.originalEndsAt ?? a.originalStartsAt, zone)}</p>}
      </div>
    </Drawer>
  );
}

/** Operator-facing schedule card: current window, reschedule count, the one Reschedule action and the history drawer. */
export function AuctionScheduleCard({ scope, group, cycle, auction: a, onChanged, onRefresh }: Props) {
  const zone = group.groupTimeZone;
  const [history, setHistory] = useState(false);
  return (
    <section className="card" aria-label="Auction schedule">
      <div className="card__header">
        <div style={{ minWidth: 0 }}>
          <h3 className="card__title">Auction schedule{a.wasRescheduled && <span className="badge badge--warning badge--plain" style={{ marginLeft: 8 }}>Rescheduled</span>}</h3>
          <p className="card__subtitle">{formatWindow(a.startsAt, a.endsAt, zone)}{a.wasRescheduled && <> · {rescheduledTimes(a.rescheduleCount)}</>}</p>
        </div>
        <div className="row">
          {a.wasRescheduled && <Button variant="secondary" onClick={() => setHistory(true)}>View schedule history</Button>}
          {a.status === "SCHEDULED" && a.canReschedule ? <RescheduleAuctionDialog scope={scope} group={group} cycle={cycle} auction={a} onChanged={onChanged} onRefresh={onRefresh} /> : null}
        </div>
      </div>
      {(a.status !== "SCHEDULED" || (!a.canReschedule && a.rescheduleUnavailableReason) || a.wasRescheduled) && (
        <div className="card__body stack" style={{ gap: 8 }}>
          {a.status !== "SCHEDULED" ? <p className="text-sm text-secondary" style={{ margin: 0 }}>{a.status === "OPEN" ? "Auction is live. Schedule changes are unavailable after bidding begins." : "This auction has closed; its timing is part of the record."}</p>
            : !a.canReschedule && a.rescheduleUnavailableReason ? <p className="text-sm text-secondary" style={{ margin: 0 }}>{a.rescheduleUnavailableReason}</p> : null}
          {a.wasRescheduled && a.previousStartsAt && <p className="text-sm text-secondary" style={{ margin: 0 }}>Latest change: {formatDateTime(a.previousStartsAt, zone)} → {formatDateTime(a.startsAt, zone)} · {auctionReasonLabel(a.latestReasonCode)}{a.latestMemberMessage && <> — “{a.latestMemberMessage}”</>}</p>}
        </div>
      )}
      <ScheduleHistoryDrawer open={history} onClose={() => setHistory(false)} groupId={group.id} cycle={cycle} auction={a} zone={zone} viewer="operator" />
    </section>
  );
}

/** Member-facing notice: the auction moved — from when, to when, why (label + message). Optional link to the sanitized change list. */
export function RescheduledNotice({ auction: a, zone, groupId, cycle }: { auction: Auction; zone: string; groupId: string; cycle: MonthlyCycle }) {
  const [history, setHistory] = useState(false);
  if (!a.wasRescheduled || !a.previousStartsAt) return null;
  return (
    <Callout variant="info" title={`This auction was rescheduled${a.rescheduleCount > 1 ? ` (${a.rescheduleCount} times)` : ""}`}>
      <dl className="auc__status-grid" style={{ marginTop: 4 }}>
        <div><dt>Previously</dt><dd style={{ fontSize: "var(--text-base)" }}>{formatDateTime(a.previousStartsAt, zone)}</dd></div>
        <div><dt>New</dt><dd style={{ fontSize: "var(--text-base)" }}>{formatDateTime(a.startsAt, zone)}</dd></div>
      </dl>
      <p className="text-sm" style={{ margin: "6px 0 0" }}><strong>Reason:</strong> {auctionReasonLabel(a.latestReasonCode)}{a.latestMemberMessage && <> — {a.latestMemberMessage}</>}</p>
      <div style={{ marginTop: 8 }}><button type="button" className="link text-sm" onClick={() => setHistory(true)}>View schedule changes</button></div>
      <ScheduleHistoryDrawer open={history} onClose={() => setHistory(false)} groupId={groupId} cycle={cycle} auction={a} zone={zone} viewer="member" />
    </Callout>
  );
}
