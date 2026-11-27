"use client";
// Releases on their own: for a client with no board (Planner tab off). With
// a board, the Schedule lives under it on the Planner tab.
import { ReleaseSchedule } from "../_shared/ReleaseSchedule";

export default function ReleasesPage() {
  return <ReleaseSchedule />;
}
