"use client";
// Releases on their own: for a client with no planner. With one, the
// Schedule lives under the board on the Planner tab, so this page sends him
// there (keeping ?add= from the Catalog's "Add to a release", which the
// Schedule handles the same way).
import { useEffect } from "react";
import { useClientPortal } from "../_shared/context";
import { ReleaseSchedule } from "../_shared/ReleaseSchedule";

export default function ReleasesPage() {
  const { data, token } = useClientPortal();
  const planner = !!(data as any)?.has_line_sheet;
  useEffect(() => {
    if (planner) window.location.replace(`/portal/client/${token}/line-sheet${window.location.search}`);
  }, [planner, token]);
  if (!data || planner) return null;
  return <ReleaseSchedule />;
}
