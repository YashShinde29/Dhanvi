"use client";
import Link from "next/link";
import { AuctionPanel } from "@/features/auctions/auction-panel";
import { SelectionPanel } from "@/features/selections/selection-panel";
import { useEffect, useState } from "react";
import { contributionService } from "@/services/contribution.service";
import type { Group } from "@/types/group";
import type { Contribution, MonthlyCycle } from "@/types/contribution";
import { errorText, label, money } from "@/features/groups/shared";
export function CycleProgress({ cycle }: { cycle: MonthlyCycle }) {
  return (
    <div className="cycle-progress">
      <p>
        <strong>
          {cycle.fullyRecordedMemberCount} of {cycle.expectedMemberCount} fully
          recorded
        </strong>{" "}
        · {cycle.pendingMemberCount} pending
      </p>
      <progress
        max={cycle.expectedPoolAmount}
        value={cycle.recordedContributionAmount}
        aria-label={`Cycle ${cycle.cycleNumber} recorded contribution progress`}
      />
      <p>
        {money(cycle.recordedContributionAmount)} /{" "}
        {money(cycle.expectedPoolAmount)} recorded
      </p>
    </div>
  );
}
export function CyclePanel({ group, scope }: { group: Group; scope: string }) {
  const [cycles, setCycles] = useState<MonthlyCycle[]>([]);
  const [mine, setMine] = useState<Contribution[]>([]);
  const [error, setError] = useState("");
  const management = scope === "organizer" || scope === "admin";
  const hasMembership = group.myMembership?.status === "ACTIVE";
  useEffect(() => {
    let active = true;
    Promise.all([
      contributionService.cycles(
        group.id,
        management ? (scope as "admin" | "organizer") : undefined,
      ),
      hasMembership
        ? contributionService.myGroup(group.id)
        : Promise.resolve([]),
    ])
      .then(([schedule, records]) => {
        if (active) {
          setCycles(schedule);
          setMine(records);
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [group.id, management, scope, hasMembership]);
  const current = cycles.find(
    (c) => c.cycleNumber === group.currentCycleNumber,
  );
  const own = mine.find((c) => c.cycleId === current?.id);
  return (
    <section className="panel wide">
      <h2>Cycle schedule</h2>
      <p>
        Business dates use {group.groupTimeZone}. Contribution amounts are
        manual records; no real payment is processed.
      </p>
      {group.status === "SUSPENDED" && (
        <p className="status-note">
          This group is suspended. The schedule and history are preserved; new
          records are blocked.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {current && (
        <>
          <h3>
            Current cycle {current.cycleNumber} of {group.durationMonths}
          </h3>
          <p>
            {label(current.status)} · {label(current.selectionMethod)} ·
            Contribution due {current.contributionDueDate}
          </p>
          <p>
            Selection date {current.selectionDate} · Expected contribution{" "}
            {money(current.expectedContributionPerMember)}
          </p>
          <CycleProgress cycle={current} />
          {current.selectionMethod === "AUCTION" ? <AuctionPanel group={group} cycle={current} scope={scope} /> : <SelectionPanel group={group} cycle={current} scope={scope} />}
          {own && (
            <p className="status-note">
              Your contribution: {label(own.status)} ·{" "}
              {money(own.recordedAmount)} recorded of{" "}
              {money(own.expectedAmount)}
            </p>
          )}
        </>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Cycle</th>
              <th>Due</th>
              <th>Selection date / method</th>
              <th>Status</th>
              <th>{management ? "Contributions" : "My record"}</th>
            </tr>
          </thead>
          <tbody>
            {cycles.map((c) => (
              <tr key={c.id}>
                <td>{c.cycleNumber}</td>
                <td>{c.contributionDueDate}</td>
                <td>
                  {c.selectionDate}
                  <small>{label(c.selectionMethod)}</small>
                  {c.selectionMethod === "AUCTION" && <Link className="text-link" href={`/${management ? scope + "/" : ""}groups/${group.id}/cycles/${c.id}/auction`}>View auction</Link>}
                </td>
                <td>{label(c.status)}</td>
                <td>
                  {management ? (
                    <Link
                      className="text-link"
                      href={`/${scope}/groups/${group.id}/cycles/${c.id}/contributions`}
                    >
                      View contributions
                    </Link>
                  ) : (
                    (mine.find((m) => m.cycleId === c.id)?.status ?? "—")
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMembership && (
        <Link className="text-link" href={`/contributions?groupId=${group.id}`}>
          My contribution history
        </Link>
      )}
    </section>
  );
}
