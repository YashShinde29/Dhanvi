"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  groupService,
  groupPath,
  type GroupScope,
} from "@/services/group.service";
import type { GroupPage } from "@/types/group";
import { Guard, money, label, errorText } from "./shared";
export function GroupListPage({ scope = "public" }: { scope?: GroupScope }) {
  return (
    <Guard scope={scope}>
      <GroupList scope={scope} />
    </Guard>
  );
}
function GroupList({ scope }: { scope: GroupScope }) {
  const [data, setData] = useState<GroupPage>();
  const [error, setError] = useState("");
  const [type, setType] = useState("");
  const [creator, setCreator] = useState("");
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState("ALL");
  const [search, setSearch] = useState("");
  const [minimum, setMinimum] = useState("");
  const [maximum, setMaximum] = useState("");
  useEffect(() => {
    let active = true;
    const q = new URLSearchParams({
      page: String(page),
      pageSize: "20",
      groupType: type,
      creatorType: creator,
      search,
      section: tab,
    });
    if (minimum) q.set("minGroupValue", minimum);
    if (maximum) q.set("maxGroupValue", maximum);
    groupService
      .list(scope, q.toString())
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
  }, [scope, page, type, creator, search, minimum, maximum, tab]);
  const items = data?.items;
  return (
    <>
      <p className="eyebrow">Savings groups</p>
      <h1>
        {scope === "mine"
          ? "My groups"
          : scope === "public"
            ? "Find your group"
            : "Manage groups"}
      </h1>
      <p className="lead">
        Review the rules, apply for a position, and prepare together. No money
        is collected at this stage.
      </p>
      {(scope === "admin" || scope === "organizer") && (
        <Link className="button" href={`/${scope}/groups/create`}>
          Create {scope === "admin" ? "platform " : ""}group
        </Link>
      )}
      <div className="filters">
        <label>
          Type
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All</option>
            <option>RANDOM</option>
            <option>AUCTION</option>
          </select>
        </label>
        <label>
          Created by
          <select
            value={creator}
            onChange={(e) => {
              setCreator(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All</option>
            <option value="PLATFORM">Dhanvi Platform</option>
            <option value="ORGANIZER">Organizer</option>
          </select>
        </label>
        <label>
          Search
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Minimum value
          <input
            type="number"
            min="0"
            value={minimum}
            onChange={(e) => {
              setMinimum(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Maximum value
          <input
            type="number"
            min="0"
            value={maximum}
            onChange={(e) => {
              setMaximum(e.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>
      {scope === "mine" && (
        <label>
          Membership section
          <select
            value={tab}
            onChange={(e) => {
              setTab(e.target.value);
              setPage(1);
            }}
          >
            {[
              "ALL",
              "APPLICATIONS",
              "UPCOMING",
              "READY_TO_START",
              "ACTIVE",
              "COMPLETED",
            ].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!data && !error && <p>Loading groups…</p>}
      {items?.length === 0 && (
        <p className="status-note">
          {tab === "COMPLETED"
            ? "Completed groups will be available in a later release."
            : "No groups in this section."}
        </p>
      )}
      <div className="card-grid">
        {items?.map((g) => (
          <article className="panel compact" key={g.id}>
            <span className="status-badge">
              {g.groupType} ·{" "}
              {g.status === "FULLY_SUBSCRIBED"
                ? "Starting soon"
                : label(g.status)}
            </span>
            <h2>{g.name}</h2>
            <p>
              {money(g.groupValue)} · {g.currentMemberCount} / {g.memberLimit}{" "}
              members
            </p>
            <p>
              <strong>{money(g.monthlyContribution)} / month</strong> ·{" "}
              {g.durationMonths} months
            </p>
            <p>Created by {g.organizer?.name ?? "Dhanvi Platform"}</p>
            {g.organizerFirstPayout && (
              <p className="status-note">Organizer receives the first payout</p>
            )}
            {g.myMembership && (
              <p>Membership: {label(g.myMembership.status)}</p>
            )}
            {scope !== "public" && scope !== "mine" && (
              <p>
                {g.pendingApplications} pending applications · Starts{" "}
                {g.startDate}
              </p>
            )}
            <Link
              className="text-link"
              href={`/${scope === "mine" ? "groups" : groupPath(scope)}/${g.id}`}
            >
              View group
            </Link>
          </article>
        ))}
      </div>
      {data && (
        <div className="actions">
          <button
            className="button secondary"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <span>
            Page {page} · {data.totalCount} groups
          </span>
          <button
            className="button secondary"
            disabled={page * data.pageSize >= data.totalCount}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}
