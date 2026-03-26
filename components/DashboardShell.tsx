"use client";
import { PartyLine } from "./PartyLine";

export function DashboardShell({ userId }: { userId: string }) {
  return <PartyLine currentUserId={userId} />;
}
