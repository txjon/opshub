"use client";
import { C } from "../_shared/theme";

// Staging tab stub — the real content lands in Phase 5.5. Jon's legacy
// /staging page stays untouched; this shell tab just signals "coming soon"
// until the opt-in board-visibility flag ships.

export default function StagingStub() {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: "60px 32px", textAlign: "center",
      color: C.muted, minHeight: 240,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12,
    }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Staging is coming soon</div>
      <div style={{ fontSize: 12, maxWidth: 440, lineHeight: 1.6 }}>
        A shared planning board for specialty items and upcoming drops. HPD will share boards here once this tab launches.
      </div>
    </div>
  );
}
