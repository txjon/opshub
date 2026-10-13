"use client";
// The ONE address editor (mig 200: addresses are stored as parts). Used by the
// client page (Locations + billing), project Logistics, new-client intake and
// the client hub info form — each passes its own input/label styles so it
// sits in that surface's theme.

import React, { useState } from "react";
import { US_STATES, type Addr } from "@/lib/address";

export function AddressFields({ value, onChange, inp, lab, idPrefix, nameHint, problem, warn }: {
  value: Addr; onChange: (a: Addr) => void;
  inp: React.CSSProperties; lab?: React.CSSProperties;
  idPrefix: string;
  nameHint?: string;            // placeholder for the name / company line
  problem?: string;             // shown under the fields (e.g. "ZIP is missing")
  warn?: string;                // the surface's amber token
}) {
  const set = (k: keyof Addr) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ ...value, [k]: e.target.value });
  const [outside, setOutside] = useState((value.country || "US") !== "US");
  const us = !outside;
  const L = (t: string) => lab ? <span style={lab}>{t}</span> : null;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div>{L("Name / company on the label")}<input id={`${idPrefix}-name`} style={inp} value={value.name} onChange={set("name")} placeholder={nameHint || "Company or person (optional)"} autoComplete="organization" /></div>
      <div>{L("Street")}<input id={`${idPrefix}-line1`} style={inp} value={value.line1} onChange={set("line1")} placeholder="123 Main St" autoComplete="address-line1" /></div>
      <div>{L("Suite / unit")}<input id={`${idPrefix}-line2`} style={inp} value={value.line2} onChange={set("line2")} placeholder="Suite, unit, floor (optional)" autoComplete="address-line2" /></div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(70px, 0.8fr) minmax(90px, 1fr)", gap: 8 }}>
        <div>{L("City")}<input id={`${idPrefix}-city`} style={inp} value={value.city} onChange={set("city")} autoComplete="address-level2" /></div>
        <div>{L(us ? "State" : "Province")}{us
          ? <select id={`${idPrefix}-state`} style={inp} value={value.state} onChange={set("state")} autoComplete="address-level1"><option value="">Select</option>{US_STATES.map(s => <option key={s} value={s}>{s}</option>)}</select>
          : <input id={`${idPrefix}-state`} style={inp} value={value.state} onChange={set("state")} />}</div>
        <div>{L(us ? "ZIP" : "Postal code")}<input id={`${idPrefix}-zip`} style={inp} value={value.zip} onChange={set("zip")} inputMode={us ? "numeric" : "text"} autoComplete="postal-code" /></div>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, opacity: 0.75, cursor: "pointer" }}>
        <input type="checkbox" checked={!us} onChange={e => { setOutside(e.target.checked); onChange({ ...value, country: e.target.checked ? "" : "US", state: "" }); }} />
        Outside the US
        {!us && <input id={`${idPrefix}-country`} style={{ ...inp, width: 140, marginLeft: 6 }} value={value.country} onChange={set("country")} placeholder="Country" />}
      </label>
      {problem && <div style={{ fontSize: 12, color: warn, fontWeight: 600 }}>{problem}</div>}
    </div>
  );
}
