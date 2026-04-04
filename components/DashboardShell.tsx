"use client";
import { PartyLine } from "./PartyLine";
import { NotificationBell } from "./NotificationBell";
import { RealtimeToast } from "./RealtimeToast";
import { EventStrip } from "./EventStrip";

export function DashboardShell({ userId }: { userId: string }) {
  return (
    <>
      <PartyLine currentUserId={userId} />
      <RealtimeToast userId={userId} />
    </>
  );
}

export function SidebarNotifications({ userId }: { userId: string }) {
  return <NotificationBell userId={userId} />;
}

export function MainEventStrip({ userId }: { userId: string }) {
  return <EventStrip userId={userId} />;
}
