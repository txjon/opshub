"use client";
// Email a blank order to a supplier rep (mig 183). Opens from the Purchasing
// block with the selected items; the sender names the supplier, the rep is
// remembered per supplier, the email is drafted from the buy sheet, editable,
// sent through the production inbox and recorded on the project.
// View only — logic in lib/blank-rep-order.ts.

import React, { useEffect, useMemo, useState } from "react";
import { T, font, mono } from "@/lib/theme";
import { createClient } from "@/lib/supabase/client";
import { ModalShell } from "@/components/board-kit";
import { draftBlankOrderEmail, loadShipToOptions, loadSupplierContact, sendBlankRepOrder, sizesLine, suggestSupplier, SUPPLIERS, type RepOrderItem, type ShipToOption } from "@/lib/blank-rep-order";

const LBL: React.CSSProperties = { fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: T.faint };
const INPUT: React.CSSProperties = { padding: "8px 10px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.card, color: T.text, fontSize: 13, fontFamily: font, outline: "none", boxSizing: "border-box", width: "100%", colorScheme: "dark" };
const BTN: React.CSSProperties = { fontSize: 12.5, fontWeight: 800, padding: "8px 14px", borderRadius: 999, border: `1px solid ${T.border}`, background: T.card, color: T.text, cursor: "pointer", fontFamily: font };
const SEG = (on: boolean): React.CSSProperties => ({ ...BTN, background: on ? T.accent : T.card, color: on ? "#111" : T.text, borderColor: on ? T.accent : T.border });

export function BlankRepOrderModal({ jobId, jobNumber, clientName, invoiceNumber, senderName, items, decoratorIds, onClose, onSent, onError }: {
  jobId: string; jobNumber: string; clientName: string; invoiceNumber: string | null; senderName: string | null;
  items: RepOrderItem[];            // the selected items (any suppliers)
  decoratorIds: string[];           // decorators printing the selected items → ship-to choices
  onClose: () => void; onSent: () => void; onError: (m: string, e?: any) => void;
}) {
  const sb = useMemo(() => createClient(), []);
  // Everything selected goes in this one email; the sender names the supplier.
  const orderItems = items;
  const [supplier, setSupplier] = useState<string>(() => suggestSupplier(items));
  const [otherSupplier, setOtherSupplier] = useState("");
  const knownSuppliers = Array.from(new Set(items.map(i => i.supplier).filter(Boolean))) as string[];
  const mixed = knownSuppliers.length > 1;

  const [repName, setRepName] = useState("");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [shipOpts, setShipOpts] = useState<ShipToOption[]>([]);
  const [shipKey, setShipKey] = useState<string>("");
  const [shipTo, setShipTo] = useState("");
  const [note, setNote] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [bodyTouched, setBodyTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // remembered rep for this supplier
  useEffect(() => {
    if (!supplier) return;
    loadSupplierContact(sb, supplier).then(c => { setRepName(c?.rep_name || ""); setTo(c?.rep_email || ""); setCc((c?.cc_emails || []).join(", ")); });
  }, [supplier, sb]);
  // ship-to choices: the printers on these items, then the warehouse
  useEffect(() => {
    loadShipToOptions(sb, decoratorIds).then(opts => { setShipOpts(opts); if (opts[0] && !shipKey) { setShipKey(opts[0].key); setShipTo(opts[0].address); } });
  }, [decoratorIds, sb]);   // eslint-disable-line react-hooks/exhaustive-deps

  // the draft follows the inputs until the body is hand-edited
  const draft = useMemo(() => draftBlankOrderEmail({ repName: repName || null, clientName, jobNumber, invoiceNumber, items: orderItems, shipTo, note, senderName }),
    [repName, clientName, jobNumber, invoiceNumber, orderItems, shipTo, note, senderName]);
  useEffect(() => { setSubject(draft.subject); if (!bodyTouched) setBody(draft.body); }, [draft, bodyTouched]);

  const ccList = cc.split(/[,\s;]+/).map(s => s.trim()).filter(s => s.includes("@"));
  const canSend = !!supplier && orderItems.length > 0 && /@/.test(to) && subject.trim().length > 0 && body.trim().length > 0 && !busy;

  const send = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await sendBlankRepOrder(sb, { jobId, supplier, repName: repName || null, toEmail: to, ccEmails: ccList, subject, body, shipTo, items: orderItems });
      if (!res.ok) { setErr(res.error || "Send failed"); setBusy(false); return; }
      onSent();
    } catch (e: any) { setErr(e?.message || "Send failed"); onError("Blank order email failed — not sent", e); setBusy(false); }
  };

  const total = orderItems.reduce((a, it) => a + Object.values(it.qtys).reduce((x, n) => x + (Number(n) || 0), 0), 0);

  return (
    <ModalShell onClose={onClose} maxWidth={760} dismissable={false}>
      <div style={{ padding: "18px 22px", borderBottom: `1px solid ${T.border}` }}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>Email blank order to rep</div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{clientName} · {jobNumber} · sent from the production inbox and logged on the project</div>
      </div>
      <div style={{ padding: "16px 22px", display: "grid", gap: 14, color: T.text }}>
        <div>
          <div style={{ ...LBL, marginBottom: 6 }}>Supplier</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {SUPPLIERS.map(s => <button key={s} style={SEG(s === supplier)} onClick={() => { setSupplier(s); setBodyTouched(false); }}>{s}</button>)}
            <input id="rep-supplier-other" style={{ ...INPUT, width: 160 }} placeholder="Other…" value={otherSupplier}
              onChange={e => { setOtherSupplier(e.target.value); if (e.target.value.trim()) { setSupplier(e.target.value.trim()); setBodyTouched(false); } }} />
          </div>
          {mixed && <div style={{ fontSize: 12, color: T.amber, fontWeight: 600, marginTop: 6 }}>Costing lists more than one supplier on these items ({knownSuppliers.join(", ")}). One email goes to one rep, so check the selection.</div>}
        </div>
        <div>
          <div style={{ ...LBL, marginBottom: 6 }}>{supplier || "Supplier"} · {orderItems.length} item{orderItems.length > 1 ? "s" : ""} · {total.toLocaleString()} units</div>
          <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, overflow: "hidden" }}>
            {orderItems.map((it, i) => (
              <div key={it.itemId} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "7px 10px", borderTop: i ? `1px solid ${T.border}` : "none", fontSize: 12.5, flexWrap: "wrap" }}>
                <span style={{ fontFamily: mono, color: T.muted, minWidth: 16 }}>{it.letter}</span>
                <span style={{ fontWeight: 700 }}>{[it.style, it.color].filter(Boolean).join(" · ") || it.name}</span>
                <span style={{ color: T.muted }}>{it.name}</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: mono, color: T.muted }}>{sizesLine(it.qtys)}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 1.4fr", gap: 8 }}>
          <label><span style={{ ...LBL, display: "block", marginBottom: 4 }}>Rep name</span><input id="rep-name" style={INPUT} value={repName} onChange={e => setRepName(e.target.value)} placeholder="First name" /></label>
          <label><span style={{ ...LBL, display: "block", marginBottom: 4 }}>To</span><input id="rep-to" style={INPUT} value={to} onChange={e => setTo(e.target.value)} placeholder="rep@supplier.com" /></label>
          <label><span style={{ ...LBL, display: "block", marginBottom: 4 }}>CC</span><input id="rep-cc" style={INPUT} value={cc} onChange={e => setCc(e.target.value)} placeholder="comma separated" /></label>
        </div>
        <div>
          <div style={{ ...LBL, marginBottom: 6 }}>Ship blanks to</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            {shipOpts.map(o => <button key={o.key} style={SEG(shipKey === o.key)} onClick={() => { setShipKey(o.key); setShipTo(o.address); }}>{o.label}</button>)}
            <button style={SEG(shipKey === "custom")} onClick={() => setShipKey("custom")}>Other</button>
          </div>
          <textarea id="rep-shipto" style={{ ...INPUT, minHeight: 70, resize: "vertical", lineHeight: 1.45, fontFamily: mono, fontSize: 12.5 }} value={shipTo} onChange={e => { setShipTo(e.target.value); setShipKey("custom"); }} />
        </div>
        <label><span style={{ ...LBL, display: "block", marginBottom: 4 }}>Note to the rep (optional)</span><input id="rep-note" style={INPUT} value={note} onChange={e => setNote(e.target.value)} placeholder="Needed by, backorder OK, ship complete only…" /></label>
        <label><span style={{ ...LBL, display: "block", marginBottom: 4 }}>Subject</span><input id="rep-subject" style={INPUT} value={subject} onChange={e => setSubject(e.target.value)} /></label>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={LBL}>Email</span>
            {bodyTouched && <button style={{ background: "none", border: "none", color: T.blue, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: font, padding: 0 }} onClick={() => { setBodyTouched(false); setBody(draft.body); }}>Reset to draft</button>}
          </div>
          <textarea id="rep-body" style={{ ...INPUT, minHeight: 260, resize: "vertical", lineHeight: 1.5, fontFamily: mono, fontSize: 12.5 }} value={body} onChange={e => { setBody(e.target.value); setBodyTouched(true); }} />
        </div>
        {err && <div style={{ fontSize: 12.5, color: T.red, fontWeight: 600 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button style={BTN} onClick={onClose} disabled={busy}>Cancel</button>
          <button style={{ ...BTN, background: canSend ? T.accent : T.surface, color: canSend ? "#111" : T.faint, borderColor: canSend ? T.accent : T.border, cursor: canSend ? "pointer" : "not-allowed" }} onClick={send} disabled={!canSend}>
            {busy ? "Sending…" : `Send to ${supplier || "rep"}`}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
