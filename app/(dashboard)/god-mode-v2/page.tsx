"use client";
// GOD MODE V2 — the six imported years, hub-styled (Jul 22 2026).
// Jon: "historical data in beautiful client hub worthy graphs, that are
// interactive." Concepts kept from the old tour-tool boards (revenue over
// time, product mix, size distribution, top-N) — rebuilt in the magazine
// grammar: dark ground, display type, house blue for data, hover tells the
// number, one client selector drives every module.
// Access: catalogued sensitive; API gate mirrors /god-mode (is_god or grant).
import { useEffect, useMemo, useRef, useState } from "react";
import { H } from "@/components/hub/theme";

const PURPLE = "#fd3aa3";
const fmt$ = (n: number) => "$" + Math.round(n).toLocaleString();
const fmtK = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `$${Math.round(n)}`;
const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "YS", "YM", "YL", "YXL", "OS", "OSFA"];
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
};

type Payload = {
  lines: [string, string, string, number, number, number][];  // ym, customer, group, amount, qty, opshubFlag
  curves: { c: string; g: string; o: number; s: Record<string, number> }[];
  blanks: { c: string; b: string; o: number; u: number }[];
  spend: [string, string, number][];                          // ym, vendor, amount
};

export default function GodModeV2Page() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [client, setClient] = useState<string>("ALL");
  const [group, setGroup] = useState<string>("ALL");
  // scope: "pure" = the archive only; "all" = + the OpsHub era (the stamped
  // QB lines ARE the OpsHub jobs as invoiced — either scope is double-count-free)
  const [scope, setScope] = useState<"pure" | "all">("pure");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/god/history-stats");
        const body = await res.json();
        if (!res.ok) { setErr(body.error || "Not available"); return; }
        setData(body);
      } catch { setErr("Couldn't load the history"); }
    })();
  }, []);

  const model = useMemo(() => {
    if (!data) return null;
    const inClient = (c: string) => client === "ALL" || c === client;
    const inScope = (o: number) => scope === "all" || !o;

    // client leaderboard (drives the selector)
    const byClient = new Map<string, number>();
    for (const [, c, , a, , o] of data.lines) { if (inScope(o)) byClient.set(c, (byClient.get(c) || 0) + a); }
    const topClients = Array.from(byClient.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12);

    // monthly gross for selection
    const byMonth = new Map<string, { a: number; q: number }>();
    for (const [ym, c, , a, q, o] of data.lines) {
      if (!inClient(c) || !inScope(o)) continue;
      const cur = byMonth.get(ym) || { a: 0, q: 0 };
      cur.a += a; cur.q += q; byMonth.set(ym, cur);
    }
    const months = Array.from(byMonth.keys()).sort();
    const span = months.length ? [months[0], months[months.length - 1]] : null;
    // continuous month axis
    const series: { ym: string; a: number; q: number }[] = [];
    if (span) {
      let [y, m] = span[0].split("-").map(Number);
      const [ey, em] = span[1].split("-").map(Number);
      while (y < ey || (y === ey && m <= em)) {
        const ym = `${y}-${String(m).padStart(2, "0")}`;
        const v = byMonth.get(ym) || { a: 0, q: 0 };
        series.push({ ym, a: v.a, q: v.q });
        m++; if (m > 12) { m = 1; y++; }
      }
    }

    // category mix for selection
    const byGroup = new Map<string, { a: number; q: number }>();
    for (const [, c, g, a, q, o] of data.lines) {
      if (!inClient(c) || !inScope(o)) continue;
      const cur = byGroup.get(g) || { a: 0, q: 0 };
      cur.a += a; cur.q += q; byGroup.set(g, cur);
    }
    const mix = Array.from(byGroup.entries()).map(([g, v]) => ({ g, ...v }))
      .sort((a, b) => b.a - a.a).slice(0, 10);

    // size curve for selection + group
    const curveAgg: Record<string, number> = {};
    const groupsWithCurves = new Map<string, number>();
    for (const cv of data.curves) {
      if (!inClient(cv.c) || !inScope(cv.o)) continue;
      const units = Object.values(cv.s).reduce((x, n) => x + n, 0);
      groupsWithCurves.set(cv.g, (groupsWithCurves.get(cv.g) || 0) + units);
      if (group !== "ALL" && cv.g !== group) continue;
      for (const [s, n] of Object.entries(cv.s)) curveAgg[s] = (curveAgg[s] || 0) + n;
    }
    const curveGroups = Array.from(groupsWithCurves.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([g]) => g);
    const curveTotal = Object.values(curveAgg).reduce((a, n) => a + n, 0);
    const curve = SIZE_ORDER.filter(s => curveAgg[s] > 0).map(s => ({ s, n: curveAgg[s], pct: curveTotal ? curveAgg[s] / curveTotal : 0 }));

    // blank leaderboard for selection
    const byBlank = new Map<string, number>();
    for (const b of data.blanks) {
      if (!inClient(b.c) || !inScope(b.o)) continue;
      byBlank.set(b.b, (byBlank.get(b.b) || 0) + b.u);
    }
    const blanks = Array.from(byBlank.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);

    // vendor spend (ALL only — bills aren't client-attributed)
    const byVendor = new Map<string, number>();
    for (const [, v, a] of data.spend) byVendor.set(v, (byVendor.get(v) || 0) + a);
    const vendors = Array.from(byVendor.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);

    const totalGross = Array.from(byMonth.values()).reduce((a, v) => a + v.a, 0);
    const totalUnits = Array.from(byMonth.values()).reduce((a, v) => a + v.q, 0);
    const customerCount = byClient.size;
    // honesty for THE CURVE: how many of the selection's units actually carry
    // a size split (pre-OpsHub invoices often didn't itemize sizes)
    const curveUniverse = group === "ALL" ? totalUnits : (byGroup.get(group)?.q || 0);
    return { topClients, series, mix, curve, curveTotal, curveGroups, blanks, vendors, totalGross, totalUnits, customerCount, curveUniverse, span };
  }, [data, client, group, scope]);

  return (
    <div style={{ background: H.ink, minHeight: "100vh", margin: -24, padding: 24, color: H.text, fontFamily: H.font }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .gm-mod{margin-top:44px}
        .gm-bar{transition:width .5s cubic-bezier(.2,.8,.2,1)}
        @media(prefers-reduced-motion:reduce){.gm-bar{transition:none}}
      ` }} />
      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "26px 0 90px" }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: H.faint }}>
          Owner · {model?.span ? `${monthLabel(model.span[0])} — ${monthLabel(model.span[1])}` : "the archive"}
        </div>
        <h1 style={{ fontSize: "clamp(34px,5vw,64px)", fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em", textTransform: "uppercase", margin: "6px 0 8px" }}>God mode.</h1>
        <div style={{ fontSize: 13.5, color: H.dim, maxWidth: "58ch", lineHeight: 1.6 }}>
          Six years of the book, one page. Pick a client — every graph follows.
        </div>

        {err && <div style={{ color: H.red, fontSize: 13, padding: "40px 0" }}>{err}</div>}
        {!err && !model && <div style={{ color: H.faint, fontSize: 13, padding: "40px 0" }}>Reading the ledger…</div>}

        {model && (
          <>
            {/* ── scope toggle — the archive vs + OpsHub era ── */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "20px 0 0" }}>
              {([["pure", "The archive"], ["all", "+ OpsHub era"]] as const).map(([k, label]) => {
                const active = scope === k;
                return (
                  <button key={k} onClick={() => setScope(k)}
                    style={{ borderRadius: 999, border: active ? "1px solid #fff" : `1px solid ${H.line}`, background: active ? "#fff" : "transparent", color: active ? H.ink : H.dim, fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", padding: "9px 14px", cursor: "pointer", fontFamily: H.font }}>
                    {label}
                  </button>
                );
              })}
            </div>

            {/* ── client selector — drives everything ── */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0 6px" }}>
              {[["ALL", model ? Array.from(model.topClients.values()).length : 0] as any, ...model.topClients].map((entry: any, i: number) => {
                const name = i === 0 ? "ALL" : entry[0];
                const active = client === name;
                return (
                  <button key={name} onClick={() => { setClient(name); setGroup("ALL"); }}
                    style={{ borderRadius: 999, border: active ? "1px solid #fff" : `1px solid ${H.line}`, background: active ? "#fff" : "transparent", color: active ? H.ink : H.dim, fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", padding: "9px 14px", cursor: "pointer", fontFamily: H.font }}>
                    {i === 0 ? "Everyone" : name.replace(/, (LLC|INC).*/i, "").replace(/ (LLC|INC)\.?$/i, "")}
                  </button>
                );
              })}
            </div>

            {/* ── KPI strip ── */}
            <div style={{ display: "flex", gap: "clamp(18px,4vw,48px)", flexWrap: "wrap", borderTop: `1px solid ${H.line}`, borderBottom: `1px solid ${H.line}`, padding: "16px 0", margin: "14px 0 0" }}>
              <div><div style={{ fontSize: "clamp(24px,3vw,36px)", fontWeight: 900, lineHeight: 1 }}>{fmt$(model.totalGross)}</div><div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: H.faint, marginTop: 5 }}>gross, all time</div></div>
              <div><div style={{ fontSize: "clamp(24px,3vw,36px)", fontWeight: 900, lineHeight: 1, color: H.blue }}>{Math.round(model.totalUnits).toLocaleString()}</div><div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: H.faint, marginTop: 5 }}>units sold</div></div>
              <div><div style={{ fontSize: "clamp(24px,3vw,36px)", fontWeight: 900, lineHeight: 1, color: PURPLE }}>{client === "ALL" ? model.customerCount.toLocaleString() : "1"}</div><div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: H.faint, marginTop: 5 }}>{client === "ALL" ? "clients" : client.replace(/, (LLC|INC).*/i, "")}</div></div>
              <div style={{ alignSelf: "flex-end", fontSize: 9.5, color: H.faint, maxWidth: 230, lineHeight: 1.5 }}>{scope === "pure" ? "OpsHub-era invoices excluded — flip to + OpsHub era to fold them in." : "OpsHub era folded in — each job counted once, from its QB invoice lines."}</div>
            </div>

            <MonthlyChart series={model.series} />
            <MixChart mix={model.mix} />
            <CurveChart curve={model.curve} total={model.curveTotal} universe={model.curveUniverse} groups={model.curveGroups} group={group} setGroup={setGroup} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 40 }}>
              <RankChart title="The blanks." hint="most-run styles, by units" rows={model.blanks.map(([b, u]) => ({ label: b, value: u, display: Math.round(u).toLocaleString() + " pcs" }))} />
              {client === "ALL" && <RankChart title="Money out." hint="vendor spend, all time" rows={model.vendors.map(([v, a]) => ({ label: v, value: a, display: fmt$(a) }))} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ModHead({ title, hint }: { title: string; hint: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
      <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>{title}</h2>
      <span style={{ fontSize: 10.5, color: H.faint }}>{hint}</span>
    </div>
  );
}

// ── Monthly gross — hover tells the number ──
function MonthlyChart({ series }: { series: { ym: string; a: number; q: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  if (!series.length) return null;
  const max = Math.max(...series.map(s => s.a), 1);
  const hv = hover != null ? series[hover] : null;
  return (
    <section className="gm-mod">
      <ModHead title="The long game." hint="gross by month — run your finger across it" />
      <div ref={ref} style={{ position: "relative" }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={e => {
          const r = ref.current?.getBoundingClientRect(); if (!r) return;
          setHover(Math.max(0, Math.min(series.length - 1, Math.floor((e.clientX - r.left) / (r.width / series.length)))));
        }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 190, borderBottom: `1px solid ${H.line}` }}>
          {series.map((s, i) => (
            <div key={s.ym} style={{ flex: 1, height: `${Math.max(1.5, (s.a / max) * 100)}%`, background: hover === i ? "#fff" : s.a > 0 ? H.blue : "rgba(255,255,255,0.08)", borderRadius: "2px 2px 0 0", opacity: hover == null || hover === i ? 1 : 0.45, transition: "opacity .12s" }} />
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 7, fontSize: 9.5, fontFamily: H.mono, color: H.faint }}>
          <span>{monthLabel(series[0].ym)}</span>
          <span style={{ color: "#fff", fontWeight: 700 }}>
            {hv ? `${monthLabel(hv.ym)} · ${fmt$(hv.a)} · ${Math.round(hv.q).toLocaleString()} pcs` : ""}
          </span>
          <span>{monthLabel(series[series.length - 1].ym)}</span>
        </div>
      </div>
    </section>
  );
}

// ── Product mix — horizontal bars, the anti-pie ──
function MixChart({ mix }: { mix: { g: string; a: number; q: number }[] }) {
  if (!mix.length) return null;
  const max = Math.max(...mix.map(m => m.a), 1);
  return (
    <section className="gm-mod">
      <ModHead title="The mix." hint="what they actually buy — gross by category" />
      {mix.map(m => (
        <div key={m.g} style={{ display: "flex", alignItems: "center", gap: 14, padding: "7px 0" }}>
          <span style={{ width: 130, flexShrink: 0, fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.g}</span>
          <div style={{ flex: 1, height: 22, background: "rgba(255,255,255,0.05)", borderRadius: 4, overflow: "hidden" }}>
            <div className="gm-bar" style={{ width: `${(m.a / max) * 100}%`, height: "100%", background: H.blue, borderRadius: 4, minWidth: 2 }} />
          </div>
          <span style={{ width: 150, flexShrink: 0, fontSize: 11, fontFamily: H.mono, color: H.dim, textAlign: "right" }}>{fmt$(m.a)} · {Math.round(m.q).toLocaleString()} pcs</span>
        </div>
      ))}
    </section>
  );
}

// ── The size curve — the signature graph ──
function CurveChart({ curve, total, universe, groups, group, setGroup }: {
  curve: { s: string; n: number; pct: number }[]; total: number; universe: number;
  groups: string[]; group: string; setGroup: (g: string) => void;
}) {
  if (!groups.length) return null;
  const max = Math.max(...curve.map(c => c.pct), 0.01);
  const cov = universe > 0 ? Math.min(1, total / universe) : 0;
  return (
    <section className="gm-mod">
      <ModHead title="The curve." hint={`built from ${Math.round(total).toLocaleString()} of ${Math.round(universe).toLocaleString()} units (${(cov * 100).toFixed(0)}% carry a size split — older invoices often didn't itemize sizes)`} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {["ALL", ...groups].map(g => {
          const active = group === g;
          return (
            <button key={g} onClick={() => setGroup(g)}
              style={{ borderRadius: 999, border: active ? "1px solid #fff" : `1px solid ${H.line}`, background: active ? "#fff" : "transparent", color: active ? H.ink : H.dim, fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", padding: "8px 13px", cursor: "pointer", fontFamily: H.font }}>
              {g === "ALL" ? "Everything" : g}
            </button>
          );
        })}
      </div>
      {curve.length === 0 ? (
        <div style={{ color: H.faint, fontSize: 12.5 }}>No sized lines for this cut.</div>
      ) : (
        <div style={{ display: "flex", alignItems: "flex-end", gap: "clamp(8px,2vw,22px)", height: 210 }}>
          {curve.map(c => (
            <div key={c.s} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", minWidth: 0 }}>
              <span style={{ fontSize: 12.5, fontWeight: 900, fontFamily: H.mono, color: "#fff", marginBottom: 6 }}>{(c.pct * 100).toFixed(0)}%</span>
              <div className="gm-bar" style={{ width: "100%", maxWidth: 64, height: `${(c.pct / max) * 78}%`, minHeight: 3, background: H.blue, borderRadius: "5px 5px 0 0" }} />
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", color: H.dim, marginTop: 8 }}>{c.s}</span>
              <span style={{ fontSize: 9, fontFamily: H.mono, color: H.faint, marginTop: 2 }}>{Math.round(c.n).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Ranked horizontal bars (blanks, vendors) ──
function RankChart({ title, hint, rows }: { title: string; hint: string; rows: { label: string; value: number; display: string }[] }) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map(r => r.value), 1);
  return (
    <section className="gm-mod">
      <ModHead title={title} hint={hint} />
      {rows.map(r => (
        <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0" }}>
          <span style={{ width: 120, flexShrink: 0, fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", fontFamily: H.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
          <div style={{ flex: 1, height: 16, background: "rgba(255,255,255,0.05)", borderRadius: 4, overflow: "hidden" }}>
            <div className="gm-bar" style={{ width: `${(r.value / max) * 100}%`, height: "100%", background: PURPLE, opacity: 0.85, borderRadius: 4, minWidth: 2 }} />
          </div>
          <span style={{ width: 92, flexShrink: 0, fontSize: 10.5, fontFamily: H.mono, color: H.dim, textAlign: "right" }}>{r.display}</span>
        </div>
      ))}
    </section>
  );
}
