"use client";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { T, font } from "@/lib/theme";

// Request Art Pricing — sends an outside graphic artist a tokenized gallery
// link (download ONLY the files you pick, no Drive link exposed) + an ask for
// price + screen count. Email-back v1: the returned number is entered manually
// as an Additional charge on the quote. Parallels the decorator "Request
// Pricing" flow but sits OUTSIDE costing, so it can fire before costing exists.
const STAGE_LABEL = { client_art: "Client art", vector: "Vector", mockup: "Mockup", proof: "Proof", print_ready: "Print-ready" };

export default function ArtRequestModal({ open, onClose, project, onSent }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(null); // { url, emailSent }
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);       // [{id, name}]
  const [files, setFiles] = useState([]);        // [{id, item_id, drive_file_id, file_name, stage}]
  const [selected, setSelected] = useState({});  // { fileId: true }
  const [requests, setRequests] = useState([]);  // prior requests + responses for this job
  const [showForm, setShowForm] = useState(false); // once requests exist, gate the send form behind "＋ New"

  // Load the job's art files + prior requests when the modal opens.
  useEffect(() => {
    if (!open || !project?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const sb = createClient();
      const { data: its } = await sb.from("items").select("id, name, sort_order").eq("job_id", project.id).order("sort_order", { ascending: true });
      const itemIds = (its || []).map(i => i.id);
      const [fsRes, reqRes] = await Promise.all([
        itemIds.length
          ? sb.from("item_files").select("id, item_id, drive_file_id, file_name, stage, created_at").in("item_id", itemIds).is("superseded_at", null).order("created_at", { ascending: true })
          : Promise.resolve({ data: [] }),
        fetch(`/api/art-request?jobId=${project.id}`).then(r => r.ok ? r.json() : { requests: [] }).catch(() => ({ requests: [] })),
      ]);
      if (cancelled) return;
      setItems(its || []);
      setFiles((fsRes.data || []).filter(f => f.drive_file_id));
      const reqs = reqRes.requests || [];
      setRequests(reqs);
      setShowForm(reqs.length === 0); // no history → straight to the form
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, project?.id]);

  if (!open) return null;

  const reset = () => { setEmail(""); setName(""); setMessage(""); setErr(""); setSent(null); setSending(false); setSelected({}); setRequests([]); setShowForm(false); };
  const close = () => { reset(); onClose?.(); };
  const fmtMoney = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const STATUS = { sent: { label: "Awaiting quote", color: T.amber }, quoted: { label: "Quoted", color: T.green }, closed: { label: "Closed", color: T.faint } };

  const selectedIds = Object.keys(selected).filter(id => selected[id]);
  const toggle = (id) => setSelected(s => ({ ...s, [id]: !s[id] }));
  const allSelected = files.length > 0 && selectedIds.length === files.length;
  const toggleAll = () => {
    if (allSelected) { setSelected({}); }
    else { const next = {}; files.forEach(f => { next[f.id] = true; }); setSelected(next); }
  };

  const byItem = {};
  files.forEach(f => { (byItem[f.item_id] ||= []).push(f); });

  const send = async () => {
    const to = email.trim();
    if (!to || !/.+@.+\..+/.test(to)) { setErr("Enter a valid designer email."); return; }
    if (selectedIds.length === 0) { setErr("Pick at least one file to share."); return; }
    setSending(true); setErr("");
    try {
      const res = await fetch("/api/art-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: project?.id, designerEmail: to, designerName: name.trim() || null, message: message.trim() || null, fileIds: selectedIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Send failed");
      setSent({ url: data.url, emailSent: data.emailSent !== false });
      onSent?.();
    } catch (e) {
      setErr(e.message || "Send failed");
    }
    setSending(false);
  };

  const inp = {
    width: "100%", height: 38, padding: "0 12px", borderRadius: 8,
    border: `1px solid ${T.border}`, background: T.card, color: T.text,
    fontSize: 13, fontFamily: font, boxSizing: "border-box",
  };
  const lbl = { display: "block", fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 };

  return createPortal(
    <div onClick={close}
      style={{ position: "fixed", inset: 0, background: "rgba(10,10,14,0.5)", backdropFilter: "blur(4px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: font }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: "min(560px, 100%)", maxHeight: "90vh", background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, boxShadow: "0 12px 40px rgba(0,0,0,0.18)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ padding: "16px 18px", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>Request art pricing</div>
          <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2 }}>
            Send a designer a private link to download the files you pick and quote them. Outside costing — the price becomes an Additional charge on the quote.
          </div>
        </div>

        {sent ? (
          <div style={{ padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: T.green, fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
              <span style={{ fontSize: 18 }}>✓</span>
              {sent.emailSent ? `Sent to ${email.trim()}` : "Request created"}
            </div>
            {!sent.emailSent && (
              <div style={{ fontSize: 11.5, color: T.amber, marginBottom: 10 }}>
                The email didn't go out — copy the link below and send it manually.
              </div>
            )}
            <div style={{ ...lbl }}>Gallery link</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input readOnly value={sent.url || ""} onFocus={e => e.target.select()} style={{ ...inp, fontFamily: "monospace", fontSize: 11 }} />
              <button onClick={() => { navigator.clipboard?.writeText(sent.url || ""); }}
                style={{ flexShrink: 0, height: 38, padding: "0 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: font }}>
                Copy
              </button>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={close}
                style={{ height: 36, padding: "0 18px", borderRadius: 8, border: "none", background: T.accent, color: "#0a0a0a", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: font }}>
                Done
              </button>
            </div>
          </div>
        ) : !showForm ? (
          /* History mode — prior requests + their submitted quotes. */
          <>
            <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10, overflowY: "auto" }}>
              {requests.map(r => {
                const st = STATUS[r.status] || STATUS.sent;
                const lineItems = Array.isArray(r.quoted_items) ? r.quoted_items : [];
                const quoted = r.responded_at && lineItems.length > 0;
                return (
                  <div key={r.id} style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.text, wordBreak: "break-word" }}>{r.designer_name || r.designer_email}</div>
                      <div style={{ fontSize: 10, fontWeight: 800, color: st.color, textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0 }}>{st.label}</div>
                    </div>
                    <div style={{ fontSize: 11, color: T.faint, marginTop: 2 }}>
                      {(r.file_ids || []).length} file{(r.file_ids || []).length === 1 ? "" : "s"} shared
                    </div>
                    {quoted ? (
                      <div style={{ marginTop: 10, background: T.surface, borderRadius: 8, padding: "10px 12px" }}>
                        {/* Per-item lines: name · screens · price + copy */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                          {lineItems.map((li, k) => (
                            <div key={k} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{li.item_name || "Item"}</div>
                              <div style={{ fontSize: 11, color: T.muted, flexShrink: 0 }}>{li.screens != null ? `${li.screens} scr` : "—"}</div>
                              <div style={{ fontSize: 13, fontWeight: 800, color: T.text, flexShrink: 0, minWidth: 60, textAlign: "right" }}>{fmtMoney(li.amount)}</div>
                              <button onClick={() => { navigator.clipboard?.writeText(String(li.amount)); }}
                                style={{ flexShrink: 0, height: 24, padding: "0 8px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.card, color: T.muted, fontWeight: 700, fontSize: 10, cursor: "pointer", fontFamily: font }}
                                title="Copy this item's price to paste as an Additional charge">Copy</button>
                            </div>
                          ))}
                        </div>
                        {lineItems.length > 1 && (
                          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.border}`, fontSize: 12.5 }}>
                            <span style={{ color: T.muted }}>Total</span>
                            <span style={{ fontWeight: 800, color: T.text, minWidth: 60, textAlign: "right" }}>{fmtMoney(r.quoted_amount)}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11.5, color: T.muted, marginTop: 8 }}>No quote back yet — the designer hasn't submitted.</div>
                    )}
                    {quoted && r.quoted_note && (
                      <div style={{ fontSize: 12, color: T.muted, marginTop: 8, whiteSpace: "pre-wrap" }}>{r.quoted_note}</div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ padding: "12px 18px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", gap: 8, flexShrink: 0 }}>
              <button onClick={() => setShowForm(true)}
                style={{ height: 36, padding: "0 16px", borderRadius: 8, border: `1px solid ${T.accent}`, background: T.card, color: T.accent, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: font }}>
                ＋ New request
              </button>
              <button onClick={close}
                style={{ height: 36, padding: "0 16px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.card, color: T.muted, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: font }}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Designer email *</label>
                  <input value={email} onChange={e => setEmail(e.target.value)} placeholder="artist@studio.com" type="email" style={inp} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Name <span style={{ color: T.faint }}>(optional)</span></label>
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="First name" style={inp} />
                </div>
              </div>
              <div>
                <label style={lbl}>Note <span style={{ color: T.faint }}>(optional)</span></label>
                <textarea value={message} onChange={e => setMessage(e.target.value)} rows={2}
                  placeholder="Anything specific — deadline, number of colors to expect, etc."
                  style={{ ...inp, height: "auto", padding: "9px 12px", resize: "vertical", lineHeight: 1.4 }} />
              </div>

              {/* File picker */}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <label style={{ ...lbl, marginBottom: 0 }}>Files to share {selectedIds.length > 0 && <span style={{ color: T.accent }}>· {selectedIds.length} selected</span>}</label>
                  {files.length > 0 && (
                    <button onClick={toggleAll} style={{ background: "none", border: "none", color: T.accent, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: font, padding: 0 }}>
                      {allSelected ? "Clear" : "Select all"}
                    </button>
                  )}
                </div>
                {loading ? (
                  <div style={{ fontSize: 12, color: T.muted, padding: "10px 0" }}>Loading files…</div>
                ) : files.length === 0 ? (
                  <div style={{ fontSize: 12, color: T.muted, padding: "10px 0" }}>No art files on this project yet — upload art in Product Builder first.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {(items || []).map(it => {
                      const fs = byItem[it.id] || [];
                      if (!fs.length) return null;
                      return (
                        <div key={it.id}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: T.faint, marginBottom: 6 }}>{it.name || "Item"}</div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 }}>
                            {fs.map(f => {
                              const on = !!selected[f.id];
                              return (
                                <div key={f.id} onClick={() => toggle(f.id)}
                                  title={f.file_name || ""}
                                  style={{ cursor: "pointer", border: `2px solid ${on ? T.accent : T.border}`, borderRadius: 9, overflow: "hidden", background: T.surface, position: "relative" }}>
                                  <div style={{ aspectRatio: "1 / 1", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={`/api/files/thumbnail?id=${f.drive_file_id}&thumb=1`} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                                  </div>
                                  {/* Check badge */}
                                  <div style={{ position: "absolute", top: 5, right: 5, width: 18, height: 18, borderRadius: "50%", background: on ? T.accent : "rgba(255,255,255,0.85)", border: `1px solid ${on ? T.accent : T.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: on ? "#0a0a0a" : "#666", fontSize: 11, fontWeight: 800 }}>
                                    {on ? "✓" : ""}
                                  </div>
                                  <div style={{ fontSize: 8.5, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.04em", padding: "3px 5px", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {STAGE_LABEL[f.stage] || "File"}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {err && <div style={{ fontSize: 12, color: T.red }}>{err}</div>}
            </div>

            {/* Footer */}
            <div style={{ padding: "12px 18px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "flex-end", gap: 8, flexShrink: 0 }}>
              <button onClick={close}
                style={{ height: 36, padding: "0 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.card, color: T.muted, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: font }}>
                Cancel
              </button>
              <button onClick={send} disabled={sending}
                style={{ height: 36, padding: "0 18px", borderRadius: 8, border: "none", background: sending ? T.surface : T.accent, color: sending ? T.muted : "#fff", fontWeight: 700, fontSize: 13, cursor: sending ? "default" : "pointer", fontFamily: font }}>
                {sending ? "Sending…" : `Send request${selectedIds.length ? ` (${selectedIds.length})` : ""}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
