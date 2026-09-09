# Contributions

`Dhanvi.Modules.Contributions.Domain` owns expected obligations, append-only manual records/reversals, and overdue behavior. Groups Application exposes `IContributionRecordingService` and orchestrates cycle totals transactionally through Groups Infrastructure. ContributionEntry is operational history, not a Payment or LedgerEntry. See `docs/cycles-and-contributions.md`.
