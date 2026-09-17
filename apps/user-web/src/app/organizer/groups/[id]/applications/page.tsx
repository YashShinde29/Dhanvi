import { Suspense } from "react";
import { GroupDetailPage } from "@dhanvi/features/groups/group-pages";
export default function Page() { return <Suspense><GroupDetailPage scope="organizer" applications /></Suspense>; }
