# Responsive layout

Both apps adapt to every screen size through the shared design system in `packages/ui` — pages never carry their own media queries (`tests/responsive.test.mjs` enforces this).

## Breakpoints

| Name | Query | Used for |
| --- | --- | --- |
| phone-xs | `≤ 479px` | 320–479 tweaks: smaller money type, single-column fact/summary strips, one-column quick facts |
| mobile | `≤ 639px` | single-column grids, one-per-row cards, bottom-sheet dialogs, full-width primary actions, stacked form footers |
| tablet-down | `≤ 767px` | drawer sidebar + bottom navigation, card-mode tables, collapsed breadcrumbs, 16px inputs, filter sheet |
| laptop-down | `≤ 1023px` | two-column layouts collapse; the admin sidebar becomes icon-only (768–1023); auction hero figures stack |
| desktop-down | `≤ 1279px` | dense admin grids step from 6 to 3 columns |

Touch sizing (≥ 44px targets) keys on `(hover: none) and (pointer: coarse)` and is repeated for `≤ 767px` widths so it holds on every phone. Safe-area padding uses `--safe-bottom` (`env(safe-area-inset-bottom)`); viewport heights use `dvh` with a `vh` fallback.

Containers: member pages `--content-max: 1200px`, admin pages `1440px`; page gutters 32 / 20 / 16px (desktop / tablet / phone).

## Navigation

- **Member app phones:** bottom nav `Home · My groups · Contributions · Payments · More`. Organizers get `Home · Organizer · My groups · Contributions · More`. "More" opens the full drawer (every section, organizer tools under their own heading, admin cross-link, sign-out). The drawer closes on navigation, Escape, backdrop or its close button and locks page scroll.
- **Admin phones:** `Dashboard · Groups · Payouts · Reconcile · More`; tablets get the icon sidebar; desktops the full sidebar.

## Primitives

- `PageHeader` — `actions` holds the one primary action (full width on phones); `menu` renders secondary actions as a ⋯ menu.
- `Breadcrumbs` — full trail on tablet/desktop; phones show one `‹ Parent` link.
- `Tabs` — scrolls sideways on phones with edge fades; the active tab is scrolled into view.
- `DataTable` — `responsive` (default) turns rows into cards on phones: primary cell first, `mobile: "status"` under the title, `mobile: "emphasis"` for the key amount, `mobile: "hidden"` for bookkeeping columns, actions last. `responsive={false}` keeps columns, scrolls sideways with the primary column pinned, and takes `minWidth`.
- `ResponsiveFilters` — inline bar on tablet/desktop; on phones a search field plus `Filters (n)` opening a sheet. Fields render once per breakpoint (`useIsPhone`) so ids stay unique.
- `Dialog` / `ConfirmDialog` — bottom sheets on phones with internal body scrolling, stacked full-width buttons (primary at the bottom) and safe-area padding; full-height on short landscape viewports.
- `ChipGroup scroll` — one scrolling row on phones for long chip sets.
- `WorkflowStepper wizard` — phones show `Step n of m · Name` with a progress bar instead of the full rail.
- Sticky action bars (`StickyActionBar`, `BidSticky`) sit above the bottom nav; `.has-sticky-action` / `.auc--sticky-space` reserve page space and push toasts up.

## Auction on phones

Order: state pill + timer → current highest discount → projected winner payout → your status → minimum next bid → quick bids (auto-wrapping grid) → custom bid (`inputMode="numeric"`) → live preview → Review bid. Selecting an amount reveals the sticky `Selected discount · Review bid` bar; the confirmation sheet is the only path that submits. Headline figures reserve their line height so live updates never shift the layout. Tablets (768–1023) use a split view with the bid panel beside the state.
