"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/features/auth/auth-context";
import {
  groupService,
  groupPath,
  type GroupScope,
} from "@/services/group.service";
import type { Group, Member } from "@/types/group";
import { Guard, money, label, errorText } from "./shared";
import { CyclePanel } from "@/features/contributions/cycle-panel";
import { GroupForm } from "./group-form";
export function GroupDetailPage({
  scope = "public",
  applications = false,
}: {
  scope?: GroupScope;
  applications?: boolean;
}) {
  return (
    <Guard scope={scope}>
      <GroupDetail scope={scope} applications={applications} />
    </Guard>
  );
}
function GroupDetail({
  scope,
  applications,
}: {
  scope: GroupScope;
  applications: boolean;
}) {
  const { id } = useParams<{ id: string }>();
  const auth = useAuth();
  const [g, setGroup] = useState<Group>();
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [contact, setContact] = useState<{
    name: string;
    phone: string | null;
    email: string;
  }>();
  const manage = scope === "admin" || scope === "organizer";
  const load = useCallback(async () => {
    const group = await groupService.details(id, scope);
    setGroup(group);
    if (manage) setMembers(await groupService.members(id, scope));
  }, [id, scope, manage]);
  useEffect(() => {
    let active = true;
    groupService
      .details(id, scope)
      .then(async (group) => {
        if (!active) return;
        setGroup(group);
        if (manage) {
          const rows = await groupService.members(id, scope);
          if (active) setMembers(rows);
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [id, scope, manage, auth.user?.id]);
  async function act(path: string, body: object = {}) {
    setBusy(true);
    setError("");
    try {
      await groupService.action(path, body);
      await load();
      setAccepted(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  if (!g)
    return (
      <p role={error ? "alert" : undefined}>{error || "Loading group…"}</p>
    );
  const base = `${groupPath(scope)}/${id}`;
  const own = g.myMembership;
  const canManage =
    manage && (scope === "organizer" || g.creatorType === "PLATFORM");
  return (
    <>
      <p className="eyebrow">
        {g.creatorType === "PLATFORM" ? "Dhanvi Platform" : g.organizer?.name} ·{" "}
        {g.groupType}
      </p>
      <h1>{g.name}</h1>
      <span className="status-badge">{label(g.status)}</span>
      <p className="lead">{g.description}</p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <section className="panel wide">
        <h2>Group rules · Version {g.rulesVersion || "Draft"}</h2>
        <dl className="details-list">
          {Object.entries({
            "Group value": money(g.groupValue),
            Members: `${g.currentMemberCount} / ${g.memberLimit} (${g.availableSlots} available)`,
            "Monthly amount": money(g.monthlyContribution),
            Duration: `${g.durationMonths} months`,
            "Start date": g.startDate,
            Contribution: `Day ${g.contributionDueDay}`,
            Selection: `Day ${g.selectionDay}`,
            Payout: `Day ${g.payoutDay}`,
            "Organizer participates": g.organizerParticipates ? "Yes" : "No",
            "First cycle": label(g.firstCycleSelectionMethod),
          }).map(([k, v]) => (
            <div className="detail-row" key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        {g.organizer && (
          <p>
            Organizer: {g.organizer.name} · {label(g.organizer.status)} · Email{" "}
            {g.organizer.verified ? "verified" : "not verified"} · Member since{" "}
            {g.organizer.memberSince.slice(0, 10)}
          </p>
        )}
        {g.organizerFirstPayout && (
          <aside className="status-note">
            <h3>Organizer first payout</h3>
            <p>
              The organizer of this group is reserved to receive the first cycle
              payout. Random selection/auction begins from Cycle 2. The reserved
              payout is the full group value, with zero discount.
            </p>
          </aside>
        )}
        <p>
          Each member may receive the main payout once and must continue
          contributing for all remaining cycles.{" "}
          {g.groupType === "RANDOM"
            ? "The future selected member receives the full group value."
            : "The future auction payout equals group value minus winning discount."}{" "}
          No money is collected yet.
        </p>
        {g.auctionRules && (
          <p>
            Auction configuration: minimum discount{" "}
            {money(g.auctionRules.minimumDiscount)}, maximum{" "}
            {money(g.auctionRules.maximumDiscount)}, increment{" "}
            {money(g.auctionRules.bidIncrement)}. Window{" "}
            {g.auctionRules.auctionStartTime}–{g.auctionRules.auctionEndTime}{" "}
            UTC.
          </p>
        )}
        {g.currentRules && (
          <details>
            <summary>Published rules snapshot and hash</summary>
            <pre className="rules-snapshot">{g.currentRules.rulesSnapshot}</pre>
            <p className="rules-hash">{g.currentRules.rulesHash}</p>
          </details>
        )}
      </section>
      {!auth.authenticated && (
        <Link
          className="button"
          href={`/login?returnUrl=${encodeURIComponent(`/groups/${id}`)}`}
        >
          Sign in to apply
        </Link>
      )}
      {auth.authenticated && !own && g.status === "RECRUITING" && (
        <button
          className="button"
          disabled={busy}
          onClick={() => act(`groups/${id}/applications`)}
        >
          Apply to join
        </button>
      )}
      {own && (
        <section className="panel">
          <h2>My membership: {label(own.status)}</h2>
          {own.hasBeenSelectedForPayout && (
            <p className="status-note">
              Selected for the cycle {own.payoutCycleNumber} payout right. This
              does not confirm a money transfer.
            </p>
          )}
          {own.rejectedReason && <p>{own.rejectedReason}</p>}
          {own.status === "APPLIED" && (
            <p>Application pending. No payment is needed.</p>
          )}
          {own.termsAcceptedAt ? (
            <p className="form-success">
              Rules accepted on {new Date(own.termsAcceptedAt).toLocaleString()}
              .
            </p>
          ) : (
            own.status === "APPROVED" &&
            g.currentRules &&
            ["RECRUITING", "FULLY_SUBSCRIBED"].includes(g.status) && (
              <>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={accepted}
                    onChange={(e) => setAccepted(e.target.checked)}
                  />
                  I have reviewed and accept the published group rules,
                  including the first payout rule shown above.
                </label>
                <button
                  disabled={busy || !accepted}
                  className="button"
                  onClick={() =>
                    act(`groups/${id}/accept-terms`, {
                      groupRuleVersionId: g.currentRules!.id,
                      rulesHash: g.currentRules!.rulesHash,
                    })
                  }
                >
                  Accept rules version {g.rulesVersion}
                </button>
              </>
            )
          )}
          {["APPROVED", "ACTIVE"].includes(own.status) &&
            g.creatorType === "ORGANIZER" && (
              <button
                className="button secondary"
                onClick={async () => {
                  try {
                    setContact(await groupService.contact(id));
                  } catch (e) {
                    setError(errorText(e));
                  }
                }}
              >
                Organizer contact
              </button>
            )}
          {contact && (
            <p>
              {contact.name} · {contact.phone ?? "Phone not configured"} ·{" "}
              {contact.email}
            </p>
          )}
        </section>
      )}
      {g.activatedAt && (manage || own?.status === "ACTIVE") && (
        <CyclePanel group={g} scope={scope} />
      )}
      {manage && (
        <>
          <div className="actions">
            {canManage && g.status === "DRAFT" && (
              <>
                <button
                  className="button secondary"
                  onClick={() => setEdit(!edit)}
                >
                  Edit draft
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => act(`${base}/publish`)}
                >
                  Publish
                </button>
              </>
            )}
            {canManage && g.status === "READY_TO_START" && (
              <button
                className="button"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      `Activate ${g.name}?\nGroup value: ${money(g.groupValue)}\nMembers: ${g.memberLimit}\nMonthly contribution: ${money(g.monthlyContribution)}\nDuration: ${g.durationMonths} months\nStart date: ${g.startDate} (${g.groupTimeZone})\nCycles: ${g.durationMonths}\nFirst cycle: ${label(g.firstCycleSelectionMethod)}\n\nActivation creates the full cycle and contribution schedule. Core group rules cannot be changed afterward.`,
                    )
                  )
                    act(`groups/${id}/activate`);
                }}
              >
                Activate group
              </button>
            )}
            {canManage && g.status === "FULLY_SUBSCRIBED" && (
              <button
                className="button"
                disabled={busy}
                onClick={() => act(`${base}/confirm-ready`)}
              >
                Confirm ready
              </button>
            )}
            {scope === "organizer" && !applications && (
              <Link
                className="button secondary"
                href={`/organizer/groups/${id}/applications`}
              >
                Review applications / members
              </Link>
            )}
            {[
              "DRAFT",
              "RECRUITING",
              "FULLY_SUBSCRIBED",
              "READY_TO_START",
              "SUSPENDED",
            ].includes(g.status) &&
              !g.activatedAt && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => {
                    const reason = window.prompt(
                      "Reason for cancelling this group:",
                    );
                    if (reason?.trim()) act(`${base}/cancel`, { reason });
                  }}
                >
                  Cancel group
                </button>
              )}
            {scope === "admin" &&
              [
                "DRAFT",
                "RECRUITING",
                "FULLY_SUBSCRIBED",
                "READY_TO_START",
                "ACTIVE",
              ].includes(g.status) && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => {
                    const reason = window.prompt("Reason for suspension:");
                    if (reason?.trim()) act(`${base}/suspend`, { reason });
                  }}
                >
                  Suspend
                </button>
              )}
          </div>
          {g.statusReason && <p>{g.statusReason}</p>}
          {edit && (
            <GroupForm
              scope={scope}
              existing={g}
              onSaved={() => {
                setEdit(false);
                load().catch((e) => setError(errorText(e)));
              }}
            />
          )}
          {manage && (
            <>
              <h2>
                Applications and members ({g.pendingApplications} pending)
              </h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {[
                        "Slot",
                        "Member",
                        "Applied / Approved",
                        "Status",
                        "Terms",
                        "Actions",
                      ].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.id}>
                        <td>{m.slotNumber ?? "—"}</td>
                        <td>
                          {m.name}
                          <small>{m.email}</small>
                        </td>
                        <td>
                          {m.appliedAt.slice(0, 10)}
                          <small>{m.approvedAt?.slice(0, 10)}</small>
                        </td>
                        <td>{label(m.status)}</td>
                        <td>
                          {m.termsVersionId === g.currentRules?.id
                            ? "Accepted"
                            : "Not accepted"}
                        </td>
                        <td>
                          {canManage && m.status === "APPLIED" && (
                            <div className="row-actions">
                              <button
                                disabled={busy || g.status !== "RECRUITING"}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Approve ${m.name}? This reserves one member position.`,
                                    )
                                  )
                                    act(`${base}/applications/${m.id}/approve`);
                                }}
                              >
                                Approve
                              </button>
                              <button
                                disabled={busy}
                                onClick={() => {
                                  const reason =
                                    window.prompt("Rejection reason:");
                                  if (reason?.trim())
                                    act(`${base}/applications/${m.id}/reject`, {
                                      reason,
                                    });
                                }}
                              >
                                Reject
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
