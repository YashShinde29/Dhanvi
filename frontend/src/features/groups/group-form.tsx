"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { groupService, groupPath, type GroupScope } from "@/services/group.service";
import type { Group, GroupInput } from "@/types/group";
import { Guard, money, errorText } from "./shared";
export function GroupCreatePage({ scope }: { scope: "organizer" | "admin" }) {
  return (
    <Guard scope={scope}>
      <GroupForm scope={scope} />
    </Guard>
  );
}
export function GroupForm({
  scope,
  existing,
  onSaved,
}: {
  scope: GroupScope;
  existing?: Group;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<GroupInput>(
    existing ?? {
      name: "",
      description: "",
      groupType: "RANDOM",
      groupValue: 50000,
      memberLimit: 20,
      organizerParticipates: false,
      organizerFirstPayout: false,
      contributionDueDay: 1,
      selectionDay: 2,
      payoutDay: 2,
      startDate: "",
    },
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = existing?.rulesLocked;
  function set<K extends keyof GroupInput>(key: K, value: GroupInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  const paise = Math.round(form.groupValue * 100);
  const exact = form.memberLimit > 0 && paise % form.memberLimit === 0;
  return (
    <section className="panel wide">
      <h2>
        {existing
          ? "Edit draft"
          : `Create ${scope === "admin" ? "platform" : "organizer"} group`}
      </h2>
      {locked && (
        <p className="status-note">
          An approved membership locks the rules. You can edit the name and
          description.
        </p>
      )}
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const g = await groupService.save(scope, form, existing?.id);
            if (onSaved) onSaved();
            else router.push(`/${groupPath(scope)}/${g.id}`);
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Group name
          <input
            required
            maxLength={200}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </label>
        <label>
          Description
          <textarea
            maxLength={4000}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </label>
        <fieldset disabled={locked || busy} className="form-stack">
          <legend>Group rules</legend>
          <div className="form-grid">
            <label>
              Type
              <select
                value={form.groupType}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    groupType: e.target.value as "RANDOM" | "AUCTION",
                    auctionRules:
                      e.target.value === "AUCTION"
                        ? {
                            minimumDiscount: 0,
                            maximumDiscount: 10000,
                            bidIncrement: 100,
                            auctionStartTime: "10:00:00",
                            auctionEndTime: "11:00:00",
                          }
                        : null,
                  }))
                }
              >
                <option>RANDOM</option>
                <option>AUCTION</option>
              </select>
            </label>
            <label>
              Group value (₹)
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                value={form.groupValue}
                onChange={(e) => set("groupValue", Number(e.target.value))}
              />
            </label>
            <label>
              Member limit
              <input
                required
                type="number"
                min="20"
                max="50"
                value={form.memberLimit}
                onChange={(e) => set("memberLimit", Number(e.target.value))}
              />
            </label>
            <label>
              Start date
              <input
                required
                type="date"
                value={form.startDate}
                onChange={(e) => set("startDate", e.target.value)}
              />
            </label>
            {(["contributionDueDay", "selectionDay", "payoutDay"] as const).map(
              (key, i) => (
                <label key={key}>
                  {
                    [
                      "Contribution due day",
                      "Selection / auction day",
                      "Payout day",
                    ][i]
                  }
                  <input
                    required
                    type="number"
                    min="1"
                    max="28"
                    value={form[key]}
                    onChange={(e) => set(key, Number(e.target.value))}
                  />
                </label>
              ),
            )}
          </div>
          {scope === "organizer" && (
            <>
              <label>
                Organizer participates
                <select
                  disabled={!!existing}
                  value={String(form.organizerParticipates)}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      organizerParticipates: e.target.value === "true",
                      organizerFirstPayout:
                        e.target.value === "true" && f.organizerFirstPayout,
                    }))
                  }
                >
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              </label>
              <label>
                Organizer first payout
                <select
                  disabled={!form.organizerParticipates}
                  value={String(form.organizerFirstPayout)}
                  onChange={(e) =>
                    set("organizerFirstPayout", e.target.value === "true")
                  }
                >
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              </label>
            </>
          )}
          {form.groupType === "AUCTION" && form.auctionRules && (
            <div className="form-grid">
              {(
                [
                  "minimumDiscount",
                  "maximumDiscount",
                  "bidIncrement",
                  "auctionStartTime",
                  "auctionEndTime",
                ] as const
              ).map((key) => (
                <label key={key}>
                  {
                    {
                      minimumDiscount: "Minimum discount (₹)",
                      maximumDiscount: "Maximum discount (₹)",
                      bidIncrement: "Bid increment (₹)",
                      auctionStartTime: "Auction start (UTC)",
                      auctionEndTime: "Auction end (UTC)",
                    }[key]
                  }
                  <input
                    required
                    type={key.includes("Time") ? "time" : "number"}
                    min="0"
                    step={key.includes("Time") ? "1" : "0.01"}
                    value={form.auctionRules![key]}
                    onChange={(e) =>
                      set("auctionRules", {
                        ...form.auctionRules!,
                        [key]: key.includes("Time")
                          ? `${e.target.value.length === 5 ? e.target.value + ":00" : e.target.value}`
                          : Number(e.target.value),
                      })
                    }
                  />
                </label>
              ))}
            </div>
          )}
        </fieldset>
        {form.organizerFirstPayout && (
          <p className="status-note">
            You will occupy one member position and receive the first cycle
            payout after the cycle requirements are satisfied. You must continue
            participating according to the group&apos;s rules for all remaining
            cycles.
          </p>
        )}
        <p aria-live="polite">
          Estimate:{" "}
          {exact
            ? money(form.groupValue / form.memberLimit)
            : "Invalid fractional paise — adjust value or member count"}{" "}
          / month · {form.memberLimit} months ·{" "}
          {form.memberLimit - Number(form.organizerParticipates)} external
          positions. Backend calculation is authoritative.
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button className="button" disabled={busy || !exact}>
          {busy ? "Saving…" : "Save draft"}
        </button>
      </form>
    </section>
  );
}
