"use client";
import { useEffect, useState } from "react";
import { useNoPageZoom } from "@/lib/useNoPageZoom";
import { LineSheetView, LS as C, type SaveBody } from "@/components/LineSheetView";

// THE LINE SHEET, client side (mig 190) — the line as a webstore they react
// to: one list of concepts, product cards (front/back nested), and a verdict
// on each (mig 215): As is · Change · Pass. Always the latest PUBLISHED art;
// drafts never show here. Since mig 192 it's the proposal stage of one
// release, so it lives under that release. The cards, groups and every
// interaction are components/LineSheetView, the same view HPD's builder
// renders (Jon, Nov 26: "we see it internally how he sees it").
// "Nov 26, 3:31 PM" in his own time zone
const fmt = (iso?: string) => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

export default function ReleaseLineSheet({ params }: { params: { token: string; releaseId: string } }) {
  const { token, releaseId } = params;
  const [data, setData] = useState<any>(null);
  const [missing, setMissing] = useState(false);
  useNoPageZoom();                                                // app feel: the page doesn't pinch; the viewer does
  const api = `/api/portal/client/${token}/releases/${releaseId}/line-sheet`;
  const load = () => fetch(api).then(r => r.json()).then(j => { if (j.error) setMissing(true); else setData(j); }).catch(() => setMissing(true));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [releaseId]);
  const back = <a href={`/portal/client/${token}/releases`} style={{ color: C.faint, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", textDecoration: "none" }}>‹ {data?.release?.title || "Releases"}</a>;
  if (missing) return <div style={{ maxWidth: 1100, margin: "0 auto", padding: "26px 18px", fontFamily: C.font }}>{back}<div style={{ color: C.faint, fontSize: 13, marginTop: 14 }}>No line sheet on this release yet.</div></div>;
  if (!data) return <div style={{ padding: 40, color: C.faint, fontFamily: C.font, fontSize: 13 }}>Loading…</div>;
  const { sheet, version } = data;
  const items: any[] = data.items;
  const newCount = items.filter(i => i.badge === "new").length;
  const updCount = items.filter(i => i.badge === "updated").length;

  // every write: the version he had loaded rides along (mig 214 seen stamps)
  async function save(b: SaveBody): Promise<true | string> {
    const r = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: data?.version?.n, ...b }) }).catch(() => null);
    if (r && r.ok) return true;
    if (!b.seen) load();
    const j = r ? await r.json().catch(() => null) : null;
    return j?.error || "That didn't save. Check your connection and try again.";
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "26px 18px 90px" }}>
      <LineSheetView items={items} stamp={data} save={save} stickyTop={52} head={<>
        {back}
        <h1 style={{ fontSize: "clamp(26px,4.5vw,40px)", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.02em", margin: "8px 0 0", fontFamily: C.font, color: C.text }}>{sheet.title}</h1>
        <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", marginTop: 8, fontSize: 11, fontFamily: C.mono, color: C.faint }}>
          <span style={{ color: C.blue, fontWeight: 700 }}>v{version.n}</span>
          <span>updated {fmt(version.published_at)}</span>
          {newCount > 0 && <span style={{ color: C.green }}>{newCount} new</span>}
          {updCount > 0 && <span style={{ color: C.amber }}>{updCount} updated</span>}
        </div>
        {version.note && <div style={{ marginTop: 10, padding: "11px 14px", background: C.surface, border: `1px solid ${C.line}`, borderLeft: `3px solid ${C.blue}`, borderRadius: 10, fontSize: 13, color: C.dim, maxWidth: 640 }}>{version.note}</div>}
      </>} />
    </div>
  );
}
