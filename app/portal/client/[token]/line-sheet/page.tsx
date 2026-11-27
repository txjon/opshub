"use client";
import { useEffect, useState } from "react";
import { useNoPageZoom } from "@/lib/useNoPageZoom";
import { LineSheetView, LS as C, type SaveBody, type ViewItem } from "@/components/LineSheetView";
import { ReleaseSchedule } from "../_shared/ReleaseSchedule";

// THE PLANNER, client side (Jon, Nov 27 2026: "each client should have a
// planner"; it replaces the line sheet and the Releases tab). Top: the board
// with each release as a filter, and "Add to release" on As is cards.
// Bottom: the Schedule (_shared/ReleaseSchedule). Was THE LINE SHEET (mig 190) — his board as a webstore he reacts
// to: one list of concepts, product cards (front/back nested), and a verdict
// on each (mig 215): As is · Change · Pass. Always the latest PUBLISHED art;
// drafts never show here. Its own hub tab since Nov 26 2026 (one running
// board per client, feeding releases via mig 217). The cards, groups and every
// interaction are components/LineSheetView, the same view HPD's builder
// renders (Jon, Nov 26: "we see it internally how he sees it").
// "Nov 26, 3:31 PM" in his own time zone
const fmt = (iso?: string) => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

export default function LineSheetTab({ params }: { params: { token: string } }) {
  const { token } = params;
  const [data, setData] = useState<any>(null);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);       // couldn't load (not the same as "no line sheet")
  const [schedKey, setSchedKey] = useState(0);       // bumped when the board adds to a release
  useNoPageZoom();                                                // app feel: the page doesn't pinch; the viewer does
  const api = `/api/portal/client/${token}/line-sheet`;
  const load = () => fetch(api).then(async r => { const j = await r.json(); if (r.status === 404) setMissing(true); else if (!r.ok || j.error) setFailed(true); else { setFailed(false); setData(j); } }).catch(() => setFailed(true));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token]);
  if (missing) return <div style={{ maxWidth: 1100, margin: "0 auto", padding: "26px 18px", fontFamily: C.font, color: C.faint, fontSize: 13 }}>Nothing on your planner yet. When we post designs for you, they show up here.</div>;
  if (failed && !data) return <div style={{ maxWidth: 1100, margin: "0 auto", padding: "26px 18px", fontFamily: C.font, color: C.faint, fontSize: 13 }}>Couldn&rsquo;t load your planner. Check your connection and refresh.</div>;
  if (!data) return <div style={{ padding: 40, color: C.faint, fontFamily: C.font, fontSize: 13 }}>Loading…</div>;
  const { sheet, version } = data;
  const items: any[] = data.items;
  const newCount = items.filter(i => i.badge === "new").length;
  const updCount = items.filter(i => i.badge === "updated").length;

  // every write: the version he had loaded rides along (mig 214 seen stamps)
  async function save(b: SaveBody): Promise<true | string> {
    const r = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: data?.version?.n, ...b }) }).catch(() => null);
    if (r && r.ok) return true;
    const j = r ? await r.json().catch(() => null) : null;
    return j?.error || "That didn't save. Check your connection and try again.";
  }

  // an As is card into a release he's building; null = start a new one with it
  async function addToRelease(it: ViewItem, releaseId: string | null): Promise<true | string> {
    let rid = releaseId;
    if (!rid) {
      const r = await fetch(`/api/portal/client/${token}/releases`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "New release" }) }).catch(() => null);
      const j = r ? await r.json().catch(() => null) : null;
      if (!r?.ok || !j?.dropId) return j?.error || "Couldn't start a release. Try again.";
      rid = j.dropId as string;
    }
    const r = await fetch(`/api/portal/client/${token}/releases/${rid}/slots`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cardId: it.id }) }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    await load(); setSchedKey(k => k + 1);
    return r?.ok ? true : j?.error || "Couldn't add it. Try again.";
  }
  const releases: any[] = data.releases || [];

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "26px 18px 90px" }}>
      <LineSheetView items={items} stamp={data} save={save} onSettled={failed => { if (failed) load(); }} stickyTop={52}
        releases={releases} addToRelease={{ add: addToRelease, addable: releases.filter(r => r.status === "building").map(r => r.id) }} head={<>
        <h1 style={{ fontSize: "clamp(26px,4.5vw,40px)", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.02em", margin: 0, fontFamily: C.font, color: C.text }}>{sheet.title}</h1>
        <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", marginTop: 8, fontSize: 11, fontFamily: C.mono, color: C.faint }}>
          <span style={{ color: C.blue, fontWeight: 700 }}>v{version.n}</span>
          <span>updated {fmt(version.published_at)}</span>
          {newCount > 0 && <span style={{ color: C.green }}>{newCount} new</span>}
          {updCount > 0 && <span style={{ color: C.amber }}>{updCount} updated</span>}
        </div>
        {version.note && <div style={{ marginTop: 10, padding: "11px 14px", background: C.surface, border: `1px solid ${C.line}`, borderLeft: `3px solid ${C.blue}`, borderRadius: 10, fontSize: 13, color: C.dim, maxWidth: 640 }}>{version.note}</div>}
      </>} />
      <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 48, paddingTop: 36 }}>
        <ReleaseSchedule embedded reloadKey={schedKey} onChanged={load} />
      </div>
    </div>
  );
}
