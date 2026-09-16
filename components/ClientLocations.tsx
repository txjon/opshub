"use client";
// Client page → Locations: the client's address book (client_locations, mig
// 180). The default entry is what every new project ships to; projects can
// pick any entry, or split across several, in Logistics. One-off project
// addresses (job_id set) live on their project, not here.
//
// View only — writes go through lib/destination-actions. Hub theme (H), same
// row language as the Contacts editor.

import React, { useEffect, useMemo, useState } from "react";
import { H } from "@/components/hub/theme";
import { createClient } from "@/lib/supabase/client";
import { addressLines, type LocationRow } from "@/lib/destinations";
import { createLocation, retireLocation, setDefaultLocation, updateLocation } from "@/lib/destination-actions";

const PURPLE = "#fd3aa3";
const LAB: React.CSSProperties = { fontSize: 9.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.faint, display: "block", marginBottom: 5 };
const INP: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: `1px solid ${H.line}`, background: H.surface, color: H.text, fontSize: 13, outline: "none", colorScheme: "dark" };
const LINK: React.CSSProperties = { background: "none", border: "none", padding: 0, cursor: "pointer", color: H.blue, fontSize: 12.5, fontWeight: 700 };

export function ClientLocations({ clientId, secHead }: { clientId: string; secHead?: (title: string, sub: string) => React.ReactNode }) {
  const sb = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<LocationRow[]>([]);
  const [editing, setEditing] = useState<string | null>(null);   // location id or "new"
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    const { data } = await sb.from("client_locations").select("id, client_id, job_id, label, address, contact_name, contact_phone, is_default, active")
      .eq("client_id", clientId).is("job_id", null).eq("active", true).order("is_default", { ascending: false }).order("label");
    setRows((data || []) as LocationRow[]);
  };
  useEffect(() => { load(); }, [clientId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<void>, okText: string) => {
    try { await fn(); await load(); setMsg({ ok: true, text: okText }); }
    catch (e: any) { setMsg({ ok: false, text: e?.message || "Save failed — not saved" }); }
  };

  return (
    <div>
      {secHead ? secHead("Locations.", "where this client's orders ship — the default is what every new project uses") : <span style={LAB}>Locations</span>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map(r => editing === r.id
          ? <LocationForm key={r.id} row={r} onCancel={() => setEditing(null)}
              onSave={p => run(async () => { await updateLocation(sb, r.id, p); setEditing(null); }, "Saved")} />
          : (
            <div key={r.id} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 0.7fr) 1.6fr auto auto auto", gap: 10, alignItems: "start", borderBottom: `1px solid ${H.line}`, padding: "8px 0" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: H.text }}>{r.label}</div>
                {r.is_default && <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: PURPLE, marginTop: 2 }}>Default</div>}
              </div>
              <div style={{ fontSize: 12.5, color: H.text, lineHeight: 1.45 }}>
                {addressLines(r.address).map((l, i) => <div key={i}>{l}</div>)}
                {(r.contact_name || r.contact_phone) && <div style={{ color: H.faint, marginTop: 2 }}>{[r.contact_name, r.contact_phone].filter(Boolean).join(" · ")}</div>}
              </div>
              <button style={LINK} onClick={() => setEditing(r.id)}>Edit</button>
              {!r.is_default
                ? <button style={{ ...LINK, color: H.faint }} title="Make this the default" onClick={() => run(() => setDefaultLocation(sb, clientId, r.id), "Default updated")}>Make default</button>
                : <span />}
              {!r.is_default
                ? <button title="Remove" style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 14, color: H.faint }} onClick={() => run(() => retireLocation(sb, r.id), "Removed")}>✕</button>
                : <span />}
            </div>
          ))}
        {rows.length === 0 && editing !== "new" && <div style={{ fontSize: 12.5, color: H.amber, fontWeight: 600 }}>No shipping address on file.</div>}
        {editing === "new"
          ? <LocationForm onCancel={() => setEditing(null)}
              onSave={p => run(async () => { await createLocation(sb, { clientId, label: p.label || "", address: p.address || "", contactName: p.contactName, contactPhone: p.contactPhone }); setEditing(null); }, "Address added")} />
          : <div><button style={LINK} onClick={() => setEditing("new")}>+ Add location</button></div>}
      </div>
      {msg && <div style={{ fontSize: 11, color: msg.ok ? H.green : H.red, marginTop: 6 }}>{msg.text}</div>}
    </div>
  );
}

function LocationForm({ row, onSave, onCancel }: {
  row?: LocationRow; onCancel: () => void;
  onSave: (p: { label?: string; address?: string; contactName?: string | null; contactPhone?: string | null }) => void;
}) {
  const [label, setLabel] = useState(row?.label || "");
  const [address, setAddress] = useState(row?.address || "");
  const [contact, setContact] = useState(row?.contact_name || "");
  const [phone, setPhone] = useState(row?.contact_phone || "");
  const id = row?.id || "new";
  return (
    <div style={{ display: "grid", gap: 8, border: `1px solid ${H.line}`, borderRadius: 10, padding: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <input id={`loc-${id}-label`} style={INP} placeholder="Label (Main, Marketing office, …)" value={label} onChange={e => setLabel(e.target.value)} />
        <input id={`loc-${id}-contact`} style={INP} placeholder="Contact (optional)" value={contact} onChange={e => setContact(e.target.value)} />
        <input id={`loc-${id}-phone`} style={INP} placeholder="Phone (optional)" value={phone} onChange={e => setPhone(e.target.value)} />
      </div>
      <textarea id={`loc-${id}-address`} style={{ ...INP, minHeight: 72, resize: "vertical", lineHeight: 1.45 }} placeholder={"Company\nStreet\nCity, ST ZIP"} value={address} onChange={e => setAddress(e.target.value)} />
      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
        <button style={{ ...LINK, color: H.faint }} onClick={onCancel}>Cancel</button>
        <button style={LINK} disabled={!address.trim()} onClick={() => onSave({ label, address, contactName: contact, contactPhone: phone })}>Save</button>
      </div>
    </div>
  );
}
