"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { groupService } from "@/services/group.service";
import { contributionService } from "@/services/contribution.service";
import { Guard, errorText, label, money } from "@/features/groups/shared";
import type { Group } from "@/types/group";
import type {
  Contribution,
  ContributionEntry,
  MonthlyCycle,
} from "@/types/contribution";
import { CycleProgress } from "./cycle-panel";
export function ManageContributionsPage({
  scope,
}: {
  scope: "admin" | "organizer";
}) {
  return (
    <Guard scope={scope}>
      <Manage scope={scope} />
    </Guard>
  );
}
function Manage({ scope }: { scope: "admin" | "organizer" }) {
  const { id, cycleId } = useParams<{ id: string; cycleId: string }>();
  const [group, setGroup] = useState<Group>();
  const [cycle, setCycle] = useState<MonthlyCycle>();
  const [rows, setRows] = useState<Contribution[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Contribution>();
  const [original, setOriginal] = useState<ContributionEntry>();
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const pending = useRef<{ signature: string; key: string } | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all([
      groupService.details(id, scope),
      contributionService.cycles(id, scope),
      contributionService.cycleContributions(scope, id, cycleId),
    ])
      .then(([g, cycles, contributions]) => {
        if (active) {
          setGroup(g);
          setCycle(cycles.find((c) => c.id === cycleId));
          setRows(contributions);
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [id, cycleId, scope]);
  async function refresh() {
    const [g, cycles, contributions] = await Promise.all([
      groupService.details(id, scope),
      contributionService.cycles(id, scope),
      contributionService.cycleContributions(scope, id, cycleId),
    ]);
    setGroup(g);
    setCycle(cycles.find((c) => c.id === cycleId));
    setRows(contributions);
  }
  function open(contribution: Contribution, entry?: ContributionEntry) {
    setSelected(contribution);
    setOriginal(entry);
    setAmount(
      String(contribution.expectedAmount - contribution.recordedAmount),
    );
    setReference("");
    setNote("");
    setError("");
    pending.current = null;
  }
  const owner =
    group && (scope === "organizer" || group.creatorType === "PLATFORM");
  const operational = owner && group?.status === "ACTIVE";
  const canRecord = operational && cycle?.status === "COLLECTING_CONTRIBUTIONS";
  const canReverse =
    operational &&
    cycle &&
    [
      "COLLECTING_CONTRIBUTIONS",
      "CONTRIBUTIONS_COMPLETE",
      "READY_FOR_SELECTION",
    ].includes(cycle.status);
  return (
    <>
      <Link className="text-link" href={`/${scope}/groups/${id}`}>
        Back to group
      </Link>
      <h1>Cycle {cycle?.cycleNumber ?? ""} contributions</h1>
      <p className="status-note">
        <strong>Manual record — this does not process a real payment.</strong>{" "}
        Records are operational observations, not confirmation of money
        movement.
      </p>
      {cycle && (
        <>
          <p>
            {group?.name} · {label(cycle.status)} ·{" "}
            {label(cycle.selectionMethod)}
          </p>
          <p>
            Due {cycle.contributionDueDate} · Selection {cycle.selectionDate} ·{" "}
            {cycle.groupTimeZone}
          </p>
          <CycleProgress cycle={cycle} />
        </>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="form-success">
          {notice}
        </p>
      )}
      {operational && (
        <button
          className="button secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await contributionService.markOverdue(scope, id);
              await refresh();
              setNotice(`${result.markedCount} contributions marked overdue.`);
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Refresh overdue status
        </button>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {[
                "Slot / Member",
                "Expected",
                "Recorded",
                "Status",
                "Due / Recorded at",
                "Actions and history",
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.slotNumber} · {c.memberName}
                </td>
                <td>{money(c.expectedAmount)}</td>
                <td>{money(c.recordedAmount)}</td>
                <td>{label(c.status)}</td>
                <td>
                  {c.dueDate}
                  <small>
                    {c.recordedAt
                      ? new Date(c.recordedAt).toLocaleString("en-IN", {
                          timeZone: c.groupTimeZone,
                        })
                      : "Not recorded"}
                  </small>
                </td>
                <td>
                  {canRecord && c.recordedAmount < c.expectedAmount && (
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => open(c)}
                    >
                      Record contribution
                    </button>
                  )}
                  <details>
                    <summary>
                      Manual operation history ({c.entries.length})
                    </summary>
                    {c.entries.map((entry) => (
                      <div key={entry.id} className="entry-history">
                        <strong>
                          {label(entry.entryType)} · {money(entry.amount)}
                        </strong>
                        <p>
                          {entry.reference} ·{" "}
                          {new Date(entry.createdAt).toLocaleString("en-IN", {
                            timeZone: c.groupTimeZone,
                          })}
                        </p>
                        <p>{entry.note}</p>
                        {entry.reversesEntryId && (
                          <small>Reverses record {entry.reversesEntryId}</small>
                        )}
                        {canReverse &&
                          entry.entryType === "RECORD" &&
                          !c.entries.some(
                            (e) => e.reversesEntryId === entry.id,
                          ) && (
                            <button
                              className="button secondary"
                              disabled={busy}
                              onClick={() => open(c, entry)}
                            >
                              Reverse record
                            </button>
                          )}
                      </div>
                    ))}
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && (
        <section className="panel wide detail-panel">
          <h2>
            {original ? "Reverse manual record" : "Record contribution"} ·{" "}
            {selected.memberName}
          </h2>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                !window.confirm(
                  original
                    ? `Reverse ${money(original.amount)}? The original record will be preserved and this cycle may return to collecting contributions.`
                    : `Record ${money(Number(amount))} manually? This does not process a payment.`,
                )
              )
                return;
              const body = original
                ? { entryId: original.id, reason: note }
                : { amount: Number(amount), reference, note };
              const path = `${scope}/groups/${id}/cycles/${cycleId}/contributions/${selected.id}/${original ? "reverse" : "record"}`;
              const signature = JSON.stringify({ path, body });
              if (pending.current?.signature !== signature)
                pending.current = { signature, key: crypto.randomUUID() };
              setBusy(true);
              setError("");
              try {
                await contributionService.operate(
                  path,
                  pending.current.key,
                  body,
                );
                await refresh();
                setSelected(undefined);
                pending.current = null;
                setNotice(
                  original
                    ? "Reversal recorded. The original entry is preserved."
                    : "Contribution manually recorded. No payment was processed.",
                );
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {!original && (
              <>
                <label>
                  Amount (₹)
                  <input
                    required
                    type="number"
                    min="0.01"
                    max={selected.expectedAmount - selected.recordedAmount}
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <label>
                  Manual reference
                  <input
                    required
                    maxLength={200}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </label>
              </>
            )}
            <label>
              {original ? "Reversal reason" : "Note"}
              <textarea
                required={!!original}
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <p>
              Use an operational reference only. Do not enter bank details or
              payment credentials.
            </p>
            <div className="actions">
              <button className="button" disabled={busy}>
                {busy
                  ? "Saving…"
                  : original
                    ? "Confirm reversal"
                    : "Confirm manual record"}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setSelected(undefined)}
              >
                Close
              </button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
