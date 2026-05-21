"use client";
import { useState } from "react";
import { T, font, mono } from "@/lib/theme";
import { useIsMobile } from "@/lib/useIsMobile";

// Standalone demo of the proposed Product Builder master-detail rework.
// Mock data, no DB writes. Hit /product-builder-demo to poke at it.

type DemoItem = {
  letter: string;
  name: string;
  blank: string;
  qty: number;
  hasBlank: boolean;
  hasArt: boolean;
  hasQtys: boolean;
  sizes: string[];
  qtys: Record<string, number>;
};

const ITEMS: DemoItem[] = [
  { letter: "A", name: "Bait Shop Tee Black", blank: "Comfort Colors 1717 · Black", qty: 19, hasBlank: true, hasArt: true, hasQtys: true,
    sizes: ["S","M","L","XL","2XL"], qtys: { S:2, M:5, L:6, XL:4, "2XL":2 } },
  { letter: "B", name: "Bait Shop Tee Pepper", blank: "Comfort Colors 1717 · Pepper", qty: 25, hasBlank: true, hasArt: true, hasQtys: true,
    sizes: ["S","M","L","XL","2XL"], qtys: { S:4, M:7, L:8, XL:4, "2XL":2 } },
  { letter: "C", name: "Bait Shop Hoodie Black", blank: "AS Colour 5161 · Black", qty: 5, hasBlank: true, hasArt: true, hasQtys: true,
    sizes: ["M","L","XL"], qtys: { M:1, L:2, XL:2 } },
  { letter: "D", name: "Bait Shop Hat", blank: "NE205 Hat · Flag Chocolate/Khaki", qty: 12, hasBlank: true, hasArt: false, hasQtys: true,
    sizes: ["OSFA"], qtys: { OSFA: 12 } },
  { letter: "E", name: "Cold One Patch", blank: "Patch · PVC", qty: 100, hasBlank: false, hasArt: true, hasQtys: true,
    sizes: ["OSFA"], qtys: { OSFA: 100 } },
  { letter: "F", name: "Bait Shop Sticker Pack", blank: "Sticker", qty: 12, hasBlank: false, hasArt: false, hasQtys: true,
    sizes: ["OSFA"], qtys: { OSFA: 12 } },
];

const TOTAL_UNITS = ITEMS.reduce((a, it) => a + it.qty, 0);
const NEED_BLANKS = ITEMS.filter(it => !it.hasBlank).length;
const NEED_ART = ITEMS.filter(it => !it.hasArt).length;

export default function ProductBuilderDemoPage() {
  const isMobile = useIsMobile();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? ITEMS.find(it => it.letter === selectedId) : null;

  // ── Mobile: UINavigationController pattern ──
  if (isMobile) {
    return (
      <div style={{ background: "#f4f4f6", minHeight: "calc(100vh - 120px)", fontFamily: font, color: T.text }}>
        {!selected ? (
          <MobileList items={ITEMS} onPick={id => setSelectedId(id)} />
        ) : (
          <MobileDetail item={selected} onBack={() => setSelectedId(null)} />
        )}
      </div>
    );
  }

  // ── Desktop: master-detail ──
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-start", fontFamily: font, color: T.text }}>
      <DesktopSidebar items={ITEMS} selectedId={selectedId} onPick={setSelectedId} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {selected ? <DesktopWorkSurface item={selected} /> : <DesktopHomeState />}
      </div>
    </div>
  );
}

// ── Desktop sidebar — single source of truth for the item list ──
function DesktopSidebar({ items, selectedId, onPick }: {
  items: DemoItem[]; selectedId: string | null; onPick: (id: string) => void;
}) {
  return (
    <aside style={{
      width: 260, flexShrink: 0,
      background: T.card, border: `1px solid ${T.border}`, borderRadius: 10,
      overflow: "hidden",
      position: "sticky", top: 16, alignSelf: "flex-start",
      maxHeight: "calc(100vh - 32px)", overflowY: "auto",
    }}>
      <div style={{
        padding: "10px 14px", borderBottom: `1px solid ${T.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Items ({items.length})
        </span>
        <button style={{
          background: T.accent, color: "#fff", border: "none",
          fontSize: 11, fontWeight: 700, padding: "6px 10px",
          borderRadius: 6, cursor: "pointer", fontFamily: font,
        }}>+ Add</button>
      </div>
      {items.map(it => {
        const isSelected = selectedId === it.letter;
        return (
          <button key={it.letter} onClick={() => onPick(it.letter)}
            style={{
              width: "100%", textAlign: "left",
              padding: "10px 14px", display: "flex", alignItems: "center", gap: 10,
              background: isSelected ? T.bg : "transparent",
              borderLeft: isSelected ? `3px solid ${T.accent}` : "3px solid transparent",
              borderTop: "none", borderRight: "none",
              borderBottom: `1px solid ${T.border}`,
              cursor: "pointer", fontFamily: font, color: T.text,
              minHeight: 56,
            }}>
            <LetterBadge letter={it.letter} active={isSelected} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {it.name}
              </div>
              <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
                <StateDot ok={it.hasBlank} label="Blank" />
                <StateDot ok={it.hasArt} label="Art" />
                <StateDot ok={it.hasQtys} label="Qtys" />
              </div>
            </div>
          </button>
        );
      })}
    </aside>
  );
}

// ── Desktop home state — what fills the right when nothing's selected ──
function DesktopHomeState() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Action row — tight, paired CTAs. Add Item is the primary
          action; Bulk create reads as a related option. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <button style={{
          background: T.text, color: "#fff", border: "none",
          padding: "12px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700,
          cursor: "pointer", fontFamily: font, textAlign: "left",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>＋</span>
          <span style={{ flex: 1 }}>Add an item</span>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.65)", fontWeight: 500 }}>
            Pick a blank
          </span>
        </button>
        <button style={{
          background: T.surface, color: T.text, border: `1px solid ${T.border}`,
          padding: "12px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700,
          cursor: "pointer", fontFamily: font, textAlign: "left",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>⊞</span>
          <span style={{ flex: 1 }}>Bulk create</span>
          <span style={{ fontSize: 10, color: T.muted, fontWeight: 500 }}>
            Spreadsheet
          </span>
        </button>
      </div>

      {/* Drop zone — always present, lights up on drag */}
      <div style={{
        border: `2px dashed ${T.border}`, borderRadius: 12,
        padding: "28px 20px", textAlign: "center",
        background: T.surface,
        color: T.muted, fontSize: 13,
      }}>
        <div style={{ fontSize: 24, marginBottom: 6, opacity: 0.7 }}>↓</div>
        <div style={{ fontWeight: 600, color: T.text, marginBottom: 4 }}>
          Drop PSDs or mockup files anywhere
        </div>
        <div style={{ fontSize: 11 }}>
          We'll auto-create items for each file and detect print locations from PSD layers.
        </div>
      </div>

      {/* Summary */}
      <div style={{
        background: T.card, border: `1px solid ${T.border}`, borderRadius: 10,
        padding: "14px 18px",
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
          Project at a glance
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <Stat label="Items" value={String(ITEMS.length)} />
          <Stat label="Units" value={TOTAL_UNITS.toLocaleString()} />
          <Stat label="Need blank" value={String(NEED_BLANKS)} color={NEED_BLANKS > 0 ? T.amber : T.muted} />
          <Stat label="Need art" value={String(NEED_ART)} color={NEED_ART > 0 ? T.amber : T.muted} />
        </div>
      </div>

      <div style={{ fontSize: 11, color: T.faint, textAlign: "center", marginTop: 8 }}>
        Pick an item from the left to configure it.
      </div>
    </div>
  );
}

// ── Desktop work surface — selected item's edit card ──
function DesktopWorkSurface({ item }: { item: DemoItem }) {
  return (
    <div style={{
      background: T.card, border: `1px solid ${T.border}`, borderRadius: 10,
      padding: "18px 20px", display: "flex", flexDirection: "column", gap: 18,
    }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <LetterBadge letter={item.letter} large />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{item.name}</div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{item.blank}</div>
        </div>
        <button style={{
          background: "transparent", border: `1px solid ${T.border}`,
          color: T.muted, padding: "6px 12px", borderRadius: 6,
          fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font,
        }}>Delete</button>
      </header>

      {/* State pills row — visualizes the same dots from the sidebar */}
      <div style={{ display: "flex", gap: 18 }}>
        <CompletionRow label="Blank" ok={item.hasBlank} />
        <CompletionRow label="Art" ok={item.hasArt} />
        <CompletionRow label="Quantities" ok={item.hasQtys} />
      </div>

      <Section label="Item name">
        <FakeInput value={item.name} />
      </Section>

      <Section label="Blank">
        <FakeInput value={item.blank} />
      </Section>

      <Section label="Sizes & quantities">
        <SizeQtyGrid sizes={item.sizes} qtys={item.qtys} />
      </Section>

      <Section label="Print files">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <FakeFile name={`${item.name}.psd`} stage="print_ready" />
          <FakeFile name={`${item.name} Mockup.png`} stage="mockup" />
          <FakeFile name={`${item.name} - Product Proof.pdf`} stage="proof" />
        </div>
      </Section>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
        <button style={{
          background: T.surface, border: `1px solid ${T.border}`,
          color: T.muted, padding: "8px 14px", borderRadius: 8,
          fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font,
        }}>Duplicate</button>
        <button style={{
          background: T.text, color: "#fff", border: "none",
          padding: "8px 18px", borderRadius: 8,
          fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: font,
        }}>Save changes</button>
      </div>
    </div>
  );
}

// ── Mobile list (the navigator) ──
function MobileList({ items, onPick }: { items: DemoItem[]; onPick: (id: string) => void }) {
  return (
    <div style={{ padding: "0 0 80px" }}>
      <div style={{
        padding: "16px 16px 10px", display: "flex",
        alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>Items</div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
            {items.length} items · {TOTAL_UNITS.toLocaleString()} units
          </div>
        </div>
        <button style={{
          background: T.text, color: "#fff", border: "none",
          padding: "10px 14px", borderRadius: 10,
          fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: font,
          minHeight: 44,
        }}>＋ Add</button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", padding: "0 12px", gap: 8 }}>
        {items.map(it => (
          <button key={it.letter} onClick={() => onPick(it.letter)}
            style={{
              width: "100%", textAlign: "left",
              padding: "14px 14px", display: "flex", alignItems: "center", gap: 12,
              background: T.card, border: `1px solid ${T.border}`, borderRadius: 12,
              cursor: "pointer", fontFamily: font, color: T.text,
              minHeight: 64,
            }}>
            <LetterBadge letter={it.letter} large />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {it.name}
              </div>
              <div style={{ fontSize: 12, color: T.muted, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {it.blank}
              </div>
              <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, fontFamily: mono, color: T.text }}>{it.qty} units</span>
                <StateDot ok={it.hasBlank} label="Blank" />
                <StateDot ok={it.hasArt} label="Art" />
                <StateDot ok={it.hasQtys} label="Qtys" />
              </div>
            </div>
            <span style={{ fontSize: 22, color: T.faint, flexShrink: 0 }}>›</span>
          </button>
        ))}
      </div>

      <div style={{ padding: "16px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        <button style={{
          padding: "14px 16px", background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: 10, fontSize: 13, fontWeight: 600, color: T.text, cursor: "pointer",
          fontFamily: font, textAlign: "left", display: "flex", alignItems: "center", gap: 10,
          minHeight: 48,
        }}>
          <span style={{ fontSize: 16 }}>⊞</span> Bulk create — spreadsheet entry
        </button>
        <div style={{
          padding: "16px", border: `2px dashed ${T.border}`, borderRadius: 10,
          textAlign: "center", fontSize: 12, color: T.muted, background: T.surface,
        }}>
          On desktop, drop PSDs anywhere to auto-create items.
        </div>
      </div>
    </div>
  );
}

// ── Mobile detail (the pushed view) ──
function MobileDetail({ item, onBack }: { item: DemoItem; onBack: () => void }) {
  return (
    <div style={{ padding: "0 0 80px" }}>
      {/* iOS-style nav header */}
      <div style={{
        position: "sticky", top: 0, zIndex: 10,
        background: "rgba(244,244,246,0.92)", backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        padding: "10px 12px", display: "flex", alignItems: "center", gap: 10,
        borderBottom: `1px solid ${T.border}`,
      }}>
        <button onClick={onBack} style={{
          background: "transparent", border: "none", color: T.accent,
          fontSize: 16, fontWeight: 600, cursor: "pointer", fontFamily: font,
          padding: "8px 4px", minHeight: 44, display: "flex", alignItems: "center", gap: 4,
        }}>
          <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span> Items
        </button>
      </div>

      <div style={{ padding: "16px 14px", display: "flex", flexDirection: "column", gap: 16 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <LetterBadge letter={item.letter} large />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.2 }}>{item.name}</div>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 3 }}>{item.blank}</div>
          </div>
        </header>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <CompletionRow label="Blank assigned" ok={item.hasBlank} />
          <CompletionRow label="Print files uploaded" ok={item.hasArt} />
          <CompletionRow label="Quantities set" ok={item.hasQtys} />
        </div>

        <Section label="Item name"><FakeInput value={item.name} /></Section>
        <Section label="Blank"><FakeInput value={item.blank} /></Section>
        <Section label="Sizes & quantities">
          <SizeQtyGrid sizes={item.sizes} qtys={item.qtys} />
        </Section>
        <Section label="Print files">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <FakeFile name={`${item.name}.psd`} stage="print_ready" />
            <FakeFile name={`${item.name} Mockup.png`} stage="mockup" />
          </div>
        </Section>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          <button style={{
            background: T.text, color: "#fff", border: "none",
            padding: "14px 18px", borderRadius: 10,
            fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: font,
            minHeight: 44,
          }}>Save changes</button>
          <button style={{
            background: T.surface, color: T.muted, border: `1px solid ${T.border}`,
            padding: "12px 18px", borderRadius: 10,
            fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: font,
            minHeight: 44,
          }}>Duplicate</button>
        </div>
      </div>
    </div>
  );
}

// ── Reusable bits ──

function LetterBadge({ letter, active, large }: { letter: string; active?: boolean; large?: boolean }) {
  const size = large ? 40 : 30;
  return (
    <span style={{
      width: size, height: size, borderRadius: 8,
      background: active ? T.accent : T.accentDim,
      color: active ? "#fff" : T.accent,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: large ? 16 : 13, fontWeight: 800, fontFamily: mono,
      flexShrink: 0,
    }}>{letter}</span>
  );
}

function StateDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span title={`${label}: ${ok ? "done" : "missing"}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: 10, color: ok ? T.green : T.faint, fontFamily: font,
      }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: ok ? T.green : T.border,
      }} />
      <span style={{ textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>{label}</span>
    </span>
  );
}

function CompletionRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 12px", background: T.surface,
      border: `1px solid ${T.border}`, borderRadius: 8,
      fontSize: 12, fontWeight: 600,
    }}>
      <span style={{
        width: 18, height: 18, borderRadius: "50%",
        background: ok ? T.green : T.border, color: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 700,
      }}>{ok ? "✓" : ""}</span>
      <span style={{ color: ok ? T.text : T.muted }}>{label}</span>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || T.text, fontFamily: mono, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function FakeInput({ value }: { value: string }) {
  return (
    <input defaultValue={value}
      style={{
        width: "100%", padding: "10px 12px",
        border: `1px solid ${T.border}`, borderRadius: 8,
        background: T.card, color: T.text,
        fontSize: 13, fontFamily: font, outline: "none",
        boxSizing: "border-box", minHeight: 40,
      }} />
  );
}

function SizeQtyGrid({ sizes, qtys }: { sizes: string[]; qtys: Record<string, number> }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {sizes.map(sz => (
        <div key={sz} style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.muted, fontFamily: mono, letterSpacing: "0.05em" }}>
            {sz}
          </div>
          <input defaultValue={qtys[sz] || 0}
            style={{
              width: 56, padding: "8px", textAlign: "center",
              border: `1px solid ${T.border}`, borderRadius: 6,
              background: T.card, color: T.text,
              fontSize: 14, fontFamily: mono, fontWeight: 700, outline: "none",
              minHeight: 40,
            }} />
        </div>
      ))}
    </div>
  );
}

function FakeFile({ name, stage }: { name: string; stage: "print_ready" | "mockup" | "proof" }) {
  const stageMap = {
    print_ready: { label: "Print-ready", color: T.green },
    mockup: { label: "Mockup", color: T.amber },
    proof: { label: "Proof", color: T.purple },
  } as const;
  const s = stageMap[stage];
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 12px", background: T.surface,
      border: `1px solid ${T.border}`, borderRadius: 8,
      fontSize: 12,
    }}>
      <span style={{ fontSize: 9, fontWeight: 800, color: s.color, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {s.label}
      </span>
      <span style={{ color: T.text, fontFamily: mono }}>{name}</span>
    </div>
  );
}
