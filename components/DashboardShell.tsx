"use client";
import { PartyLine } from "./PartyLine";
import { NotificationBell } from "./NotificationBell";

export function DashboardShell({ userId }: { userId: string }) {
  return <PartyLine currentUserId={userId} />;
}

export function SidebarNotifications({ userId }: { userId: string }) {
  return <NotificationBell userId={userId} />;
}
