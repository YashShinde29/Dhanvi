"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ProtectedPage } from "@/features/auth/protected-page";
import { errorText } from "@/features/groups/shared";
import { selectionService } from "@/services/selection.service";
import type { SelectionVerification } from "@/types/selection";
export function VerifySelectionPage() {
  return (
    <ProtectedPage>
      <Verification />
    </ProtectedPage>
  );
}
function Verification() {
  const { id, cycleId } = useParams<{ id: string; cycleId: string }>();
  const [data, setData] = useState<SelectionVerification>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    selectionService
      .verify(id, cycleId)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [id, cycleId]);
  return (
    <>
      <Link className="text-link" href={`/groups/${id}`}>
        Back to group
      </Link>
      <h1>Verify random draw</h1>
      <p className="lead">
        Reproduce the completed draw from its recorded eligible snapshot and
        revealed seed. Verification checks consistency; this MVP does not prove
        that the server committed to the seed before executing the draw.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {data && (
        <section className="panel wide">
          <p
            className={data.valid ? "form-success" : "form-error"}
            role="status"
          >
            {data.valid
              ? "✓ Valid — recorded draw verifies"
              : `Verification failed: ${data.failureReason}`}
          </p>
          <dl className="details-list">
            {Object.entries({
              "Algorithm version": data.proof.algorithmVersion,
              "Eligible set hash": data.proof.eligibleSetHash,
              "Seed commitment": data.proof.seedCommitment,
              "Revealed seed (hex)": data.proof.seedReveal,
              "Selected index (zero-based)": data.proof.selectedIndex,
              "Winner slot":
                data.proof.canonicalEligibleMembers.find(
                  (m) => m.membershipId === data.proof.winnerMembershipId,
                )?.slotNumber ?? "Unknown",
              "Result hash": data.proof.resultHash,
            }).map(([key, value]) => (
              <div className="detail-row" key={key}>
                <dt>{key}</dt>
                <dd className="rules-hash">{value}</dd>
              </div>
            ))}
          </dl>
          <h2>Canonical eligible snapshot</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ordinal</th>
                  <th>Slot</th>
                  <th>Membership ID</th>
                </tr>
              </thead>
              <tbody>
                {data.proof.canonicalEligibleMembers.map((member, index) => (
                  <tr key={member.membershipId}>
                    <td>{index}</td>
                    <td>{member.slotNumber}</td>
                    <td>{member.membershipId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary>Full verification payload</summary>
            <pre className="rules-snapshot">
              {JSON.stringify(data, null, 2)}
            </pre>
          </details>
        </section>
      )}
      <button
        className="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            setData(await selectionService.verify(id, cycleId));
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Verifying…" : "Recalculate verification"}
      </button>
    </>
  );
}
