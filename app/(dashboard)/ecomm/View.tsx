// THE SHOP — front-office landing, hub skin (mirrors the-distro/View.tsx).
// Every plate is a directive: what, how, done-when. Plates deep-link to the
// surface that owns the action; nothing is edited here.
import { H, HUB_PAGE } from "@/components/hub/theme";
import { DROP_DIRECTIVES, DISTRO_DIRECTIVES, type Directive } from "@/lib/directives";
import { fmtDay, daysUntilDay } from "@/lib/dates";

export type StagingJobRow = { jobId: string; jobNumber: string; client: string; items: number; units: number; names: string[] };
export type ReleaseRow = {
  id: string; title: string; client: string | null; status: string;
  liveDate: string | null; closeDate: string | null; lines: number; numbersDone: boolean;
  move: keyof typeof DROP_DIRECTIVES | null;
};
export type WireRow = { message: string; at: string; client: string; jobNumber: string };

const PURPLE = "#fd3aa3";
const STATUS_LABEL: Record<string, string> = { building: "Building", ready: "Ready for us", live: "Live", closed: "Numbers in?" };
const wt = (iso: string) => { const d = new Date(iso); return d.toLocaleDateString("en-US", { weekday: "short" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(" ", ""); };

// A release's calendar line: what the date column says and how loud it is.
function releaseMeta(r: ReleaseRow): { text: string; color: string } {
  if (r.status === "live") {
    const d = daysUntilDay(r.closeDate);
    if (d != null && d < 0) return { text: `ended ${fmtDay(r.closeDate)}`, color: H.red };
    if (d === 0) return { text: "closes today", color: H.amber };
    if (d != null) return { text: `closes ${fmtDay(r.closeDate)}`, color: d <= 3 ? H.amber : PURPLE };
    return { text: "live", color: PURPLE };
  }
  if (r.status === "closed") return { text: r.numbersDone ? "cut it" : "awaiting numbers", color: H.amber };
  if (!r.liveDate) return { text: "no date yet", color: H.faint };
  const d = daysUntilDay(r.liveDate);
  return { text: `live ${fmtDay(r.liveDate)}`, color: d != null && d <= 7 ? H.amber : "rgba(255,255,255,0.6)" };
}

function Plate({ eyebrow, title, meta, d, color, href, go }: { eyebrow: string; title: string; meta: string; d: Directive; color: string; href: string; go: string }) {
  return (
    <a href={href} className="sh-plate">
      <span className="body">
        <span style={{ display: "block", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.6)" }}>{eyebrow}</span>
        <span style={{ display: "block", fontSize: "clamp(19px,1.8vw,24px)", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.02em", lineHeight: 1.05, marginTop: 6, color: color === H.red ? H.red : "#fff" }}>{d.verb}.</span>
        <span style={{ display: "block", fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", marginTop: 7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        <span style={{ display: "block", fontSize: 10.5, fontFamily: H.mono, color: H.blue, marginTop: 3 }}>{meta}</span>
        <span style={{ display: "block", fontSize: 12, color: "rgba(255,255,255,0.85)", marginTop: 9, lineHeight: 1.5, maxWidth: "40ch" }}>
          {d.order}.
          <span style={{ display: "block", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: color === H.red ? H.red : H.amber, marginTop: 5 }}>done when {d.done}</span>
        </span>
        <span style={{ display: "inline-block", marginTop: 12, background: "#fff", color: H.ink, borderRadius: 999, padding: "9px 16px", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", width: "max-content" }}>{go} →</span>
      </span>
    </a>
  );
}

export default function TheShopView({ stagingJobs, releases, wire }: { stagingJobs: StagingJobRow[]; releases: ReleaseRow[]; wire: WireRow[] }) {
  const yourMove = releases.filter(r => r.move);
  const live = releases.filter(r => r.status === "live" && !r.move);
  const building = releases.filter(r => r.status === "building");
  const unitsToEnter = stagingJobs.reduce((a, j) => a + j.units, 0);
  const calendar = [...releases].sort((a, b) => (a.liveDate || "9999").localeCompare(b.liveDate || "9999"));
  const stat = (n: number, label: string, color?: string) => (
    <div><div style={{ fontSize: "clamp(24px,3vw,36px)", fontWeight: 900, lineHeight: 1, color: n && color ? color : H.text }}>{n}</div><div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: H.faint, marginTop: 5 }}>{label}</div></div>
  );
  const quiet = { fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.dim, textDecoration: "none" } as const;

  return (
    <div style={HUB_PAGE}>
      <style dangerouslySetInnerHTML={{ __html: `
        .sh-grid{display:grid;grid-template-columns:1fr;gap:16px}
        @media(min-width:760px){.sh-grid{grid-template-columns:repeat(2,1fr)}}
        @media(min-width:1100px){.sh-grid{grid-template-columns:repeat(3,1fr)}}
        .sh-plate{position:relative;border-radius:8px;overflow:hidden;background:#141414;border:1px solid ${H.line};display:flex;flex-direction:column;justify-content:flex-end;text-decoration:none;color:#fff;transition:transform .16s ease}
        .sh-plate:hover{transform:translateY(-4px)}
        .sh-plate .body{position:relative;padding:18px}
        .sh-row{display:flex;align-items:baseline;gap:14px;padding:10px 2px;border-bottom:1px solid ${H.line};text-decoration:none;color:${H.text}}
        .sh-row:hover{background:rgba(255,255,255,0.04)}
        @media(prefers-reduced-motion:reduce){.sh-plate,.sh-plate:hover{transition:none;transform:none}}
      ` }} />
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "26px 0 80px" }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: H.faint }}>
          Front office · {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </div>
        <h1 style={{ fontSize: "clamp(34px,5vw,64px)", fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em", textTransform: "uppercase", margin: "6px 0 8px" }}>The shop.</h1>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 4 }}>
          <a href="/drops" style={quiet}>Releases →</a>
          <a href="/ecomm/staging" style={quiet}>Shop staging →</a>
          <a href="/ecomm/cs" style={quiet}>CS desk →</a>
        </div>

        <div style={{ display: "flex", gap: "clamp(18px,4vw,48px)", flexWrap: "wrap", borderTop: `1px solid ${H.line}`, borderBottom: `1px solid ${H.line}`, padding: "16px 0", margin: "18px 0 0" }}>
          {stat(stagingJobs.length, `to enter in Shopify · ${unitsToEnter.toLocaleString()} pcs`, H.amber)}
          {stat(yourMove.length, "releases on our desk", H.amber)}
          {stat(live.length, "selling now", PURPLE)}
          {stat(building.length, "being built")}
        </div>

        {/* ── YOUR MOVE ── */}
        <section style={{ marginTop: 36 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", color: H.amber }}>Your move.</h2>
            <span style={{ fontSize: 10.5, color: H.faint }}>every card tells you what, how, and what done looks like</span>
          </div>
          <div className="sh-grid">
            {yourMove.map(r => (
              <Plate key={`rel-${r.id}`}
                eyebrow={`${r.client || "Release"} · ${STATUS_LABEL[r.status] || r.status}`}
                title={r.title}
                meta={`${r.lines} line${r.lines === 1 ? "" : "s"}${r.closeDate ? ` · window ${r.status === "live" ? "ended" : "closed"} ${fmtDay(r.closeDate)}` : r.liveDate ? ` · live ${fmtDay(r.liveDate)}` : ""}${r.status === "closed" ? (r.numbersDone ? " · numbers in" : " · awaiting numbers") : ""}`}
                d={DROP_DIRECTIVES[r.move!]}
                color={r.move === "window_ended" ? H.red : H.amber}
                href="/drops" go="Open releases" />
            ))}
            {stagingJobs.map(j => (
              <Plate key={`stg-${j.jobId}`}
                eyebrow={`${j.client} · ${j.jobNumber}`}
                title={j.items === 1 ? j.names[0] : `${j.items} items landed`}
                meta={`${j.units.toLocaleString()} pcs ready to enter`}
                d={DISTRO_DIRECTIVES.fulfill}
                color={H.amber}
                href="/ecomm/staging" go="Enter into Shopify" />
            ))}
            {yourMove.length + stagingJobs.length === 0 && (
              <div style={{ color: H.dim, fontSize: 13, padding: "10px 0" }}>The desk is clear. Watch the calendar.</div>
            )}
          </div>
        </section>

        {/* ── THE CALENDAR ── */}
        <section style={{ marginTop: 40 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>The calendar.</h2>
            <span style={{ fontSize: 10.5, color: H.faint }}>every release in motion, soonest first — pink is selling, amber needs a hand</span>
          </div>
          {calendar.length === 0 && <div style={{ color: H.dim, fontSize: 13 }}>No releases in motion. When a client builds one in their hub, it lands here.</div>}
          {calendar.length > 0 && (
            <div style={{ borderTop: `1px solid ${H.line}` }}>
              {calendar.map(r => {
                const m = releaseMeta(r);
                return (
                  <a key={r.id} href="/drops" className="sh-row">
                    <span style={{ fontSize: 12, fontWeight: 900, fontFamily: H.mono, color: m.color, width: 132, flexShrink: 0, whiteSpace: "nowrap" }}>{m.text}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 800, textTransform: "uppercase" }}>{r.client ? `${r.client} · ` : ""}{r.title}</span>
                      <span style={{ fontSize: 10.5, color: H.faint, marginLeft: 10 }}>{STATUS_LABEL[r.status] || r.status} · {r.lines} line{r.lines === 1 ? "" : "s"}</span>
                    </span>
                  </a>
                );
              })}
            </div>
          )}
        </section>

        {/* ── THE WIRE (shop edition) ── */}
        {wire.length > 0 && (
          <section style={{ marginTop: 40 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
              <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>The wire.</h2>
              <span style={{ fontSize: 10.5, color: H.faint }}>everything that moved through the shop, newest first</span>
            </div>
            <div style={{ borderTop: `1px solid ${H.line}`, maxWidth: 820 }}>
              {wire.map((w, i) => (
                <div key={i} style={{ display: "flex", gap: 14, alignItems: "baseline", padding: "11px 0", borderBottom: `1px solid ${H.line}` }}>
                  <span style={{ fontSize: 10, fontFamily: H.mono, color: H.faint, whiteSpace: "nowrap", width: 74, flexShrink: 0 }}>{wt(w.at)}</span>
                  <span style={{ fontSize: 13, lineHeight: 1.5, minWidth: 0 }}>
                    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.faint, marginRight: 8 }}>{w.client}{w.jobNumber ? ` · ${w.jobNumber}` : ""}</span>
                    {w.message}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
