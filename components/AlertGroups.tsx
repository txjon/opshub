"use client";
import { useState } from "react";
import Link from "next/link";
import { T, font, mono } from "@/lib/theme";

type Alert = {
  priority: number;
  type: string;
  label: string;
  bg: string;
  color: string;
  title: string;
  sub: string;
  href: string;
  time?: string;
  jobId: string;
  projectName: string;
};

type Group = {
  jobId: string;
  projectName: string;
  topPriority: number;
  alerts: Alert[];
};

const timeAgo = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const PRIORITY_BORDER: Record<number, string> = {
  0: T.red,
  1: T.amber,
  2: T.accent,
};

export function AlertGroups({ groups }: { groups: Group[] }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    // Auto-expand groups with critical alerts
    const init: Record<string, boolean> = {};
    for (const g of groups) {
      init[g.jobId] = g.topPriority === 0;
    }
    return init;
  });

  if (groups.length === 0) return null;

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "8px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>Action Required</span>
        <span style={{ fontSize: 10, color: T.faint }}>
          {groups.length} project{groups.length !== 1 ? "s" : ""} · {groups.reduce((a, g) => a + g.alerts.length, 0)} items
        </span>
      </div>
      {groups.map((group, gi) => {
        const isOpen = expanded[group.jobId] ?? false;
        const borderColor = PRIORITY_BORDER[group.topPriority] || T.accent;
        const mostRecentTime = group.alerts.filter(a => a.time).sort((a, b) => new Date(b.time!).getTime() - new Date(a.time!).getTime())[0]?.time;

        return (
          <div key={group.jobId} style={{ borderBottom: gi < groups.length - 1 ? `1px solid ${T.border}` : "none" }}>
            {/* Project header — click to expand/collapse */}
            <div
              onClick={() => setExpanded(prev => ({ ...prev, [group.jobId]: !prev[group.jobId] }))}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                cursor: "pointer", borderLeft: `3px solid ${borderColor}`,
                background: group.topPriority === 0 ? T.redDim + "22" : "transparent",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {group.projectName}
                </div>
              </div>
              {/* Alert count pills */}
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                {group.alerts.map((a, i) => (
                  <span key={i} style={{
                    padding: "2px 8px", borderRadius: 99, fontSize: 9, fontWeight: 600,
                    background: a.bg, color: a.color, whiteSpace: "nowrap",
                  }}>{a.label}</span>
                ))}
              </div>
              {mostRecentTime && (
                <span style={{ fontSize: 10, color: T.faint, flexShrink: 0 }}>{timeAgo(mostRecentTime)}</span>
              )}
              <span style={{ fontSize: 10, color: T.faint, flexShrink: 0, width: 12, textAlign: "center" }}>
                {isOpen ? "▾" : "›"}
              </span>
            </div>

            {/* Expanded: individual alerts with deep links */}
            {isOpen && (
              <div style={{ borderLeft: `3px solid ${borderColor}`, background: T.surface + "66" }}>
                {group.alerts.map((alert, ai) => (
                  <Link key={ai} href={alert.href}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "7px 14px 7px 24px",
                      borderBottom: ai < group.alerts.length - 1 ? `1px solid ${T.border}44` : "none",
                      textDecoration: "none",
                    }}>
                    <span style={{
                      padding: "2px 8px", borderRadius: 99, fontSize: 9, fontWeight: 600,
                      background: alert.bg, color: alert.color, whiteSpace: "nowrap", flexShrink: 0,
                      minWidth: 80, textAlign: "center",
                    }}>{alert.label}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 11, color: T.text, fontWeight: 500 }}>{alert.title}</span>
                      {alert.sub && <span style={{ fontSize: 11, color: T.muted, marginLeft: 6 }}>{alert.sub}</span>}
                    </div>
                    {alert.time && (
                      <span style={{ fontSize: 9, color: T.faint, flexShrink: 0 }}>{timeAgo(alert.time)}</span>
                    )}
                    <span style={{ fontSize: 11, color: T.accent, flexShrink: 0 }}>→</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
