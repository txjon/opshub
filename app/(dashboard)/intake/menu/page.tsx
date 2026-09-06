"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";

// /intake/menu — the pricing grid behind the public intake menu.
// One row per style, one column per qty band. Values come seeded from
// scripts/seed-menu-rates.ts (job history + live items); every cell is
// editable and an edited cell is never touched by a re-seed. "↺ seed"
// restores the script's proposal and re-opens the cell to future seeds.

type Rate = {
  id: string;
  product_group: string;
  lane: string;
  style_code: string;
  style_name: string;
  band_min: number;
  price_lo: number | null;
  price_hi: number | null;
  seeded_lo: number | null;
  seeded_hi: number | null;
  seed_meta: {
    source?: string;
    lines?: number;
    units?: number;
    cost_basis?: number | null;
    flagged?: boolean;
  } | null;
  edited_at: string | null;
  active: boolean;
  sort: number;
};

const BANDS = [48, 100, 250, 500];
const LANE_LABEL: Record<string, string> = {
  la_apparel: "LA APPAREL",
  as_colour: "AS COLOUR",
  popular: "POPULAR PICKS",
};
const LANE_COLOR: Record<string, string> = {
  la_apparel: T.blue,
  as_colour: T.purple,
  popular: T.green,
};
const GROUP_LABEL: Record<string, string> = { tee: "Tees", hoodie: "Hoodies" };

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `$${n.toFixed(2)}`;

export default function MenuRatesPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<Rate[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // rate id
  const [loVal, setLoVal] = useState("");
  const [hiVal, setHiVal] = useState("");
  const [saving, setSaving] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase
      .from("menu_rates")
      .select("id,product_group,lane,style_code,style_name,band_min,price_lo,price_hi,seeded_lo,seeded_hi,seed_meta,edited_at,active,sort")
      .order("sort")
      .order("band_min");
    setRows((data as unknown as Rate[]) || []);
  }
  useEffect(() => {
    load();
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null));
  }, []);

  const byStyle = useMemo(() => {
    const map = new Map<string, Rate[]>();
    for (const r of rows || []) {
      const k = `${r.product_group}|${r.lane}|${r.style_code}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return map;
  }, [rows]);

  function beginEdit(r: Rate) {
    setEditing(r.id);
    setLoVal(r.price_lo?.toFixed(2) ?? "");
    setHiVal(r.price_hi?.toFixed(2) ?? "");
  }

  async function saveEdit(r: Rate) {
    const lo = loVal.trim() === "" ? null : Number(loVal);
    const hi = hiVal.trim() === "" ? null : Number(hiVal);
    if ((lo !== null && !isFinite(lo)) || (hi !== null && !isFinite(hi))) return;
    setSaving(true);
    await supabase
      .from("menu_rates")
      .update({
        price_lo: lo,
        price_hi: hi,
        edited_at: new Date().toISOString(),
        edited_by: userEmail,
      } as never)
      .eq("id", r.id);
    setSaving(false);
    setEditing(null);
    load();
  }

  async function resetToSeed(r: Rate) {
    await supabase
      .from("menu_rates")
      .update({
        price_lo: r.seeded_lo,
        price_hi: r.seeded_hi,
        edited_at: null,
        edited_by: null,
      } as never)
      .eq("id", r.id);
    load();
  }

  async function toggleActive(rates: Rate[]) {
    const next = !rates[0].active;
    await supabase
      .from("menu_rates")
      .update({ active: next } as never)
      .eq("style_code", rates[0].style_code);
    load();
  }

  if (rows === null) {
    return <div style={{ padding: 24, color: T.muted, fontSize: 13, fontFamily: font }}>Loading...</div>;
  }

  const flaggedCount = rows.filter((r) => r.seed_meta?.flagged && !r.edited_at).length;
  const editedCount = rows.filter((r) => r.edited_at).length;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", fontFamily: font, color: T.text, paddingBottom: 80 }}>
      <header style={{ marginBottom: 8 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 4 }}>Menu pricing</h1>
        <p style={{ fontSize: 12, color: T.faint, maxWidth: 640, lineHeight: 1.5 }}>
          Per-shirt price ranges the public menu shows, by style and quantity. Seeded from our
          own job history and live items — click any range to edit it. Edited cells stick;
          re-seeding only refreshes untouched cells.
        </p>
      </header>

      <div style={{ display: "flex", gap: 18, margin: "14px 0 22px", fontSize: 12, fontFamily: mono }}>
        <span style={{ color: T.muted }}>{rows.length} cells</span>
        <span style={{ color: editedCount ? T.blue : T.faint }}>{editedCount} edited</span>
        <span style={{ color: flaggedCount ? T.amber : T.faint }}>{flaggedCount} flagged for review</span>
      </div>

      {(["tee", "hoodie"] as const).map((group) => (
        <section key={group} style={{ marginBottom: 34 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>{GROUP_LABEL[group]}</h2>
          <div style={{ overflowX: "auto", border: `1px solid ${T.border}`, borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  <th style={th}>STYLE</th>
                  {BANDS.map((b) => (
                    <th key={b} style={{ ...th, textAlign: "right" }}>{b === 500 ? "500+" : `${b}–${b === 48 ? 99 : b === 100 ? 249 : 499}`}</th>
                  ))}
                  <th style={{ ...th, textAlign: "right" }}>BLANK COST</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {[...byStyle.entries()]
                  .filter(([k]) => k.startsWith(group + "|"))
                  .map(([k, rates]) => {
                    const first = rates[0];
                    const cost = first.seed_meta?.cost_basis;
                    return (
                      <tr key={k} style={{ borderBottom: `1px solid ${T.border}`, opacity: first.active ? 1 : 0.4 }}>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>
                          <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: LANE_COLOR[first.lane], display: "block", marginBottom: 2 }}>
                            {LANE_LABEL[first.lane]}
                          </span>
                          <span style={{ fontWeight: 600 }}>{first.style_name}</span>
                        </td>
                        {BANDS.map((band) => {
                          const r = rates.find((x) => x.band_min === band);
                          if (!r) return <td key={band} style={td}>—</td>;
                          const isEditing = editing === r.id;
                          const flagged = r.seed_meta?.flagged && !r.edited_at;
                          return (
                            <td key={band} style={{ ...td, textAlign: "right", verticalAlign: "top" }}>
                              {isEditing ? (
                                <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                                  <input autoFocus value={loVal} onChange={(e) => setLoVal(e.target.value)} style={input} onKeyDown={(e) => e.key === "Enter" && saveEdit(r)} />
                                  <span style={{ color: T.faint }}>–</span>
                                  <input value={hiVal} onChange={(e) => setHiVal(e.target.value)} style={input} onKeyDown={(e) => { if (e.key === "Enter") saveEdit(r); if (e.key === "Escape") setEditing(null); }} />
                                  <button onClick={() => saveEdit(r)} disabled={saving} style={btnSmall}>✓</button>
                                </span>
                              ) : (
                                <>
                                  <span
                                    onClick={() => beginEdit(r)}
                                    title="Click to edit"
                                    style={{
                                      fontFamily: mono,
                                      cursor: "pointer",
                                      borderBottom: `1px dotted ${r.edited_at ? T.blue : T.faint}`,
                                      color: flagged ? T.amber : T.text,
                                      fontVariantNumeric: "tabular-nums",
                                    }}
                                  >
                                    {r.price_lo === null ? "set price" : `${money(r.price_lo)}–${money(r.price_hi)}`}
                                  </span>
                                  <span style={{ display: "block", fontSize: 10, color: T.faint, fontFamily: mono, marginTop: 3 }}>
                                    {r.seed_meta?.source === "no-data"
                                      ? "no data"
                                      : `${r.seed_meta?.lines ?? 0} sales · ${(r.seed_meta?.units ?? 0).toLocaleString()}u${r.seed_meta?.source === "curve-fallback" ? " · est" : ""}`}
                                    {flagged ? " ⚑" : ""}
                                  </span>
                                  {r.edited_at && (
                                    <span onClick={() => resetToSeed(r)} title={`Seed: ${money(r.seeded_lo)}–${money(r.seeded_hi)}`} style={{ display: "block", fontSize: 10, color: T.blue, fontFamily: mono, marginTop: 2, cursor: "pointer" }}>
                                      ↺ seed
                                    </span>
                                  )}
                                </>
                              )}
                            </td>
                          );
                        })}
                        <td style={{ ...td, textAlign: "right", fontFamily: mono, color: T.muted, fontVariantNumeric: "tabular-nums" }}>
                          {cost ? money(cost) : "—"}
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>
                          <span onClick={() => toggleActive(rates)} style={{ fontSize: 10, fontFamily: mono, fontWeight: 700, letterSpacing: "0.08em", cursor: "pointer", color: first.active ? T.green : T.faint }}>
                            {first.active ? "SHOWN" : "HIDDEN"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <p style={{ fontSize: 11, color: T.faint, maxWidth: 640, lineHeight: 1.6 }}>
        ⚑ = seeded price sits under 1.4× the style&apos;s average blank cost, or the style has thin
        data — eyeball before the menu goes live. &quot;est&quot; = extrapolated from the style&apos;s overall
        average via the quantity curve (not enough sales in that band). Re-seed anytime with{" "}
        <span style={{ fontFamily: mono }}>npx tsx scripts/seed-menu-rates.ts</span>.
      </p>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "10px 14px",
  textAlign: "left",
  fontSize: 10,
  fontFamily: mono,
  fontWeight: 700,
  letterSpacing: "0.08em",
  color: T.faint,
};
const td: React.CSSProperties = { padding: "12px 14px" };
const input: React.CSSProperties = {
  width: 62,
  background: T.card,
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  color: T.text,
  fontFamily: mono,
  fontSize: 12,
  padding: "4px 6px",
};
const btnSmall: React.CSSProperties = {
  background: T.accentDim,
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  color: T.text,
  cursor: "pointer",
  fontSize: 12,
  padding: "3px 8px",
};
