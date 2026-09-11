"use client";
import { useMemo, useState } from "react";
import { groupService, type GroupScope } from "@/services/group.service";
import { useAsyncData } from "@/hooks/use-async-data";
import { Guard, groupHref } from "./shared";
import { GroupCard } from "./group-card";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton, Button } from "@/components/ui/button";
import { ChipGroup, FilterBar } from "@/components/ui/filter-bar";
import { FormField, Input, SearchInput, Select } from "@/components/ui/form";
import { Pagination } from "@/components/ui/data-table";
import { SkeletonCards } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/callout";
import { Icons } from "@/components/ui/icons";
import { Drawer } from "@/components/ui/dialog";
import { ALL_GROUP_STATUSES, PUBLIC_GROUP_STATUSES, presentStatus } from "@/lib/status";
import { useDebounced } from "@/hooks/use-debounced";

const MINE_SECTIONS = [
  { value: "ALL", label: "All" }, { value: "APPLICATIONS", label: "Applications" }, { value: "UPCOMING", label: "Upcoming" },
  { value: "READY_TO_START", label: "Ready to start" }, { value: "ACTIVE", label: "Active" }, { value: "COMPLETED", label: "Completed" },
];
const TYPE_CHIPS = [{ value: "", label: "All types" }, { value: "RANDOM", label: "Random" }, { value: "AUCTION", label: "Auction" }];
const CREATOR_CHIPS = [{ value: "", label: "All creators" }, { value: "PLATFORM", label: "Dhanvi platform" }, { value: "ORGANIZER", label: "Organizer" }];

const copy: Record<GroupScope, { eyebrow: string; title: string; description: string }> = {
  public: { eyebrow: "Browse", title: "Explore savings groups", description: "Compare group value, monthly contribution, duration and rules before you apply. No money is collected at this stage." },
  mine: { eyebrow: "Member", title: "My groups", description: "Groups you have applied to, been approved for, or are actively saving in." },
  organizer: { eyebrow: "Organizer", title: "My groups", description: "Groups you have created. Manage applications, members, cycles and selections from each group." },
  admin: { eyebrow: "Administration", title: "Platform groups", description: "All groups on Dhanvi, including organizer-created groups. Create platform groups or review any group." },
};

export function GroupListPage({ scope = "public" }: { scope?: GroupScope }) {
  return <Guard scope={scope}><GroupList scope={scope} /></Guard>;
}

function GroupList({ scope }: { scope: GroupScope }) {
  const [type, setType] = useState("");
  const [creator, setCreator] = useState("");
  const [status, setStatus] = useState("");
  const [section, setSection] = useState("ALL");
  const [search, setSearch] = useState("");
  const [minimum, setMinimum] = useState("");
  const [maximum, setMaximum] = useState("");
  const [sort, setSort] = useState("");
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const debouncedSearch = useDebounced(search, 300);
  const debouncedMin = useDebounced(minimum, 400);
  const debouncedMax = useDebounced(maximum, 400);

  const query = useMemo(() => {
    const q = new URLSearchParams({ page: String(page), pageSize: "12" });
    if (type) q.set("groupType", type);
    if (creator) q.set("creatorType", creator);
    if (status) q.set("status", status);
    if (debouncedSearch.trim()) q.set("search", debouncedSearch.trim());
    if (debouncedMin) q.set("minGroupValue", debouncedMin);
    if (debouncedMax) q.set("maxGroupValue", debouncedMax);
    if (sort) q.set("sort", sort);
    if (scope === "mine") q.set("section", section);
    return q.toString();
  }, [page, type, creator, status, debouncedSearch, debouncedMin, debouncedMax, sort, section, scope]);

  const { data, error, loading, reload } = useAsyncData(() => groupService.list(scope, query), [scope, query]);
  const reset = (setter: (v: string) => void) => (v: string) => { setter(v); setPage(1); };
  const activeFilterCount = [type, creator, status, minimum, maximum, sort].filter(Boolean).length;
  const statusOptions = scope === "public" || scope === "mine" ? [...PUBLIC_GROUP_STATUSES] : ALL_GROUP_STATUSES;
  const text = copy[scope];

  const filters = (
    <>
      <FormField label="Status" htmlFor="filter-status"><Select id="filter-status" value={status} onChange={(e) => reset(setStatus)(e.target.value)}><option value="">Any status</option>{statusOptions.map((s) => <option key={s} value={s}>{presentStatus("group", s).label}</option>)}</Select></FormField>
      <FormField label="Minimum value" htmlFor="filter-min"><Input id="filter-min" type="number" inputMode="numeric" min="0" placeholder="₹" value={minimum} onChange={(e) => reset(setMinimum)(e.target.value)} /></FormField>
      <FormField label="Maximum value" htmlFor="filter-max"><Input id="filter-max" type="number" inputMode="numeric" min="0" placeholder="₹" value={maximum} onChange={(e) => reset(setMaximum)(e.target.value)} /></FormField>
      <FormField label="Sort" htmlFor="filter-sort"><Select id="filter-sort" value={sort} onChange={(e) => reset(setSort)(e.target.value)}><option value="">Newest first</option><option value="value_asc">Group value: low to high</option><option value="value_desc">Group value: high to low</option></Select></FormField>
    </>
  );

  function clearAll() { setType(""); setCreator(""); setStatus(""); setMinimum(""); setMaximum(""); setSort(""); setSearch(""); setPage(1); }

  return (
    <>
      <PageHeader eyebrow={text.eyebrow} title={text.title} description={text.description}
        actions={(scope === "admin" || scope === "organizer") && <LinkButton href={`/${scope}/groups/create`} icon={<Icons.Plus size={18} />}>Create {scope === "admin" ? "platform group" : "group"}</LinkButton>} />

      {scope === "mine" && <ChipGroup label="Membership section" options={MINE_SECTIONS} value={section} onChange={reset(setSection)} />}

      <div className="stack">
        <div className="row row--between">
          <div className="row">
            <ChipGroup label="Group type" options={TYPE_CHIPS} value={type} onChange={reset(setType)} />
            {scope !== "organizer" && <ChipGroup label="Created by" options={CREATOR_CHIPS} value={creator} onChange={reset(setCreator)} />}
          </div>
          <div className="row" style={{ flex: "1 1 260px", justifyContent: "flex-end" }}>
            <div style={{ flex: "1 1 220px", maxWidth: 360 }}><SearchInput value={search} onChange={reset(setSearch)} placeholder="Search by group name" /></div>
            <Button variant="secondary" icon={<Icons.Filter size={16} />} onClick={() => setFiltersOpen(true)} aria-expanded={filtersOpen}>Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}</Button>
          </div>
        </div>
      </div>

      <Drawer open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filter groups"
        footer={<><Button variant="ghost" onClick={clearAll}>Clear all</Button><Button onClick={() => setFiltersOpen(false)}>Show results</Button></>}>
        <FilterBar>{filters}</FilterBar>
      </Drawer>

      {error ? <ErrorState message={error} onRetry={reload} /> : loading && !data ? <SkeletonCards count={6} /> : data && data.items.length === 0 ? (
        <EmptyState icon={<Icons.Layers size={24} />}
          title={scope === "mine" ? (section === "COMPLETED" ? "No completed groups yet" : section === "ALL" ? "You haven't joined a savings group yet" : "Nothing in this section") : scope === "organizer" ? "You haven't created a group yet" : activeFilterCount || search ? "No groups match these filters" : "No groups available right now"}
          description={scope === "mine" ? "Browse open groups, review their rules and apply for a position." : scope === "organizer" ? "Create your first group to start accepting applications." : "Try clearing filters or check back soon."}
          action={scope === "mine" ? <LinkButton href="/groups" icon={<Icons.Search size={16} />}>Browse groups</LinkButton> : scope === "organizer" ? <LinkButton href="/organizer/groups/create" icon={<Icons.Plus size={16} />}>Create group</LinkButton> : (activeFilterCount || search) ? <Button variant="secondary" onClick={clearAll}>Clear filters</Button> : undefined} />
      ) : (
        <>
          <div className="group-grid" aria-busy={loading || undefined}>
            {data?.items.map((group) => <GroupCard key={group.id} group={group} href={groupHref(scope, group.id)} manage={scope === "organizer" || scope === "admin"} />)}
          </div>
          {data && <Pagination page={data.page} pageSize={data.pageSize} totalCount={data.totalCount} onPageChange={setPage} itemLabel="groups" />}
        </>
      )}
    </>
  );
}
