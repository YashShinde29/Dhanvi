# Memberships

The membership foundation is implemented inside the Groups aggregate boundary for atomic capacity, slot assignment, terms acceptance, and readiness. See `Groups/Dhanvi.Modules.Groups.Domain/GroupMembership.cs` and `docs/groups-foundation.md`. A separate membership DbContext is intentionally not introduced. Financial membership behavior remains deferred.
