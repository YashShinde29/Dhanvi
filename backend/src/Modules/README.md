# Module boundaries

`Identity` and `Groups` are the two reference module skeletons. Each has separate Domain, Application, Infrastructure, and API projects so forbidden compile-time dependencies cannot be introduced accidentally.

The following planned modules remain documentation-only until their feature milestone. Create the same four-layer shape only when the module gains real behavior:

- Organizers
- Memberships
- Cycles
- Contributions
- RandomDraws
- Auctions
- Payments
- Payouts
- Ledger
- Notifications
- Audit
- Admin

Modules may share the PostgreSQL server, but own their schema, EF Core context, migrations, and tables. Cross-module interaction must go through an explicit application contract; it must not reach into another module's context.

