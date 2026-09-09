"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { selectionService } from "@/services/selection.service";
import { errorText, label, money } from "@/features/groups/shared";
import type { Group } from "@/types/group";
import type { MonthlyCycle } from "@/types/contribution";
import type { SelectionResult } from "@/types/selection";
export function SelectionPanel({
  group,
  cycle,
  scope,
}: {
  group: Group;
  cycle: MonthlyCycle;
  scope: string;
}) {
  const [result, setResult] = useState<SelectionResult>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canExecute =
    group.status === "ACTIVE" &&
    ((scope === "admin" && group.creatorType === "PLATFORM") ||
      (scope === "organizer" && group.organizer?.status === "APPROVED"));
  useEffect(() => {
    let active = true;
    if (cycle.status === "SELECTION_COMPLETED")
      selectionService
        .get(group.id, cycle.id)
        .then((r) => {
          if (active) setResult(r);
        })
        .catch((e) => {
          if (active) setError(errorText(e));
        });
    return () => {
      active = false;
    };
  }, [group.id, cycle.id, cycle.status]);
  async function execute() {
    setBusy(true);
    setError("");
    try {
      const preview = await selectionService.preview(group.id, cycle.id);
      const reserved = cycle.selectionMethod === "ORGANIZER_RESERVED";
      const message = reserved
        ? `First Cycle — Organizer Reserved Payout Right\nOrganizer: ${group.organizer?.name}\nGroup value: ${money(group.groupValue)}\n\nThis group's published rules reserve the first cycle payout right for the organizer. Executing this action records that selection. No actual payout is processed in this step.\n\nOnce executed, the result is final and cannot be edited.`
        : `Execute Random Draw\nGroup: ${group.name}\nCycle: ${cycle.cycleNumber}\nEligible members: ${preview.eligibleMemberCount}\nAlgorithm: ${preview.algorithmVersion}\nSelection date: ${cycle.selectionDate} (${group.groupTimeZone})\n\nOnce executed, the result is final and cannot be edited. No actual payout is processed.`;
      if (window.confirm(message)) {
        const selected = await selectionService.execute(group.id, cycle.id);
        setResult(selected);
        window.location.reload();
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="selection-panel">
      <h3>{result ? "Payout recipient selected" : "Selection"}</h3>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {result ? (
        <>
          <p>
            Member #{result.winner.slotNumber} ·{" "}
            <strong>{result.winner.displayName}</strong>
          </p>
          <p>
            {label(result.selectionMethod)} · {result.eligibleMemberCount}{" "}
            eligible · {result.algorithmVersion}
          </p>
          <p>
            Selected{" "}
            {new Date(result.executedAt).toLocaleString("en-IN", {
              timeZone: group.groupTimeZone,
            })}
            . This records a payout right; no money has been transferred.
          </p>
          {result.verificationAvailable && (
            <Link
              className="text-link"
              href={`/groups/${group.id}/cycles/${cycle.id}/selection/verify`}
            >
              Verify draw
            </Link>
          )}
        </>
      ) : cycle.status === "READY_FOR_SELECTION" ? (
        cycle.selectionMethod === "AUCTION" ? (
          <p>Auction selection is not available in this step.</p>
        ) : (
          <>
            <p>
              Selection ready ·{" "}
              {cycle.selectionMethod === "RANDOM"
                ? "Random draw"
                : "Organizer reserved"}
            </p>
            {canExecute ? (
              <button className="button" disabled={busy} onClick={execute}>
                {busy ? "Preparing…" : "Execute selection"}
              </button>
            ) : (
              <p>All contributions are complete. Waiting for selection.</p>
            )}
          </>
        )
      ) : (
        <p>
          {cycle.status === "SELECTION_COMPLETED"
            ? "Loading selection result…"
            : "Selection becomes available after all required contributions are recorded."}
        </p>
      )}
    </section>
  );
}
