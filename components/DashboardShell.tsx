"use client";
import { RealtimeToast } from "./RealtimeToast";
import { EventStrip } from "./EventStrip";

// Party Line (team chat, components/PartyLine.tsx) is unmounted for now —
// the team isn't using it yet and its floating button ate phone real estate
// (Jon, Sep 17 2026). Re-mount here when it's wanted.
export function DashboardShell({ userId }: { userId: string }) {
  return <RealtimeToast userId={userId} />;
}

export function MainEventStrip({ userId }: { userId: string }) {
  return <EventStrip userId={userId} />;
}
