"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ProtectedPage } from "@/features/auth/protected-page";
import { contributionService } from "@/services/contribution.service";
import type { ContributionPage } from "@/types/contribution";
import { errorText, label, money } from "@/features/groups/shared";
export function MyContributionsPage() {
  return (
    <ProtectedPage>
      <History />
    </ProtectedPage>
  );
}
function History() {
  const [data, setData] = useState<ContributionPage>();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({
      status,
      page: String(page),
      pageSize: "20",
    });
    const groupId = new URLSearchParams(window.location.search).get("groupId");
    if (groupId) params.set("groupId", groupId);
    contributionService
      .mine(params.toString())
      .then((d) => {
        if (active) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [page, status]);
  return (
    <>
      <p className="eyebrow">My savings groups</p>
      <h1>My contributions</h1>
      <p className="lead">
        Your expected obligations and manually recorded contributions. No real
        payment is processed here.
      </p>
      <label>
        Status
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All</option>
          {["PENDING", "RECORDED", "PARTIAL", "OVERDUE", "REVERSED"].map(
            (s) => (
              <option key={s}>{s}</option>
            ),
          )}
        </select>
      </label>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!data && !error && <p>Loading contribution history…</p>}
      {data?.items.length === 0 && <p>No contributions match this filter.</p>}
      {data && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {[
                    "Group",
                    "Cycle",
                    "Due date",
                    "Expected",
                    "Recorded",
                    "Status",
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link className="text-link" href={`/groups/${c.groupId}`}>
                        {c.groupName}
                      </Link>
                    </td>
                    <td>{c.cycleNumber}</td>
                    <td>
                      {c.dueDate}
                      <small>{c.groupTimeZone}</small>
                    </td>
                    <td>{money(c.expectedAmount)}</td>
                    <td>{money(c.recordedAmount)}</td>
                    <td>{label(c.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions">
            <button
              className="button secondary"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <span>
              Page {page} · {data.totalCount} contributions
            </span>
            <button
              className="button secondary"
              disabled={page * data.pageSize >= data.totalCount}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </>
  );
}
