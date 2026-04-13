"use client";
import { useState } from "react";

const font = "'IBM Plex Sans','Helvetica Neue',Arial,sans-serif";
const C = {
  bg: "#f8f8fa", card: "#ffffff", border: "#e0e0e4", text: "#1a1a1a",
  muted: "#6b6b78", faint: "#a0a0ad", accent: "#000", blue: "#73b6c9",
  green: "#4ddb88", red: "#ff324d",
};

export default function OnboardPage() {
  const [form, setForm] = useState({
    company: "", contactName: "", email: "", phone: "",
    address: "", city: "", state: "", zip: "",
    projectDetails: "", timeline: "",
  });
  const [extraContacts, setExtraContacts] = useState<{ name: string; email: string; phone: string }[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const upd = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }));

  const ic: React.CSSProperties = {
    width: "100%", padding: "10px 14px", border: `1px solid ${C.border}`, borderRadius: 8,
    background: C.card, color: C.text, fontSize: 14, fontFamily: font, outline: "none",
    boxSizing: "border-box",
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.company.trim() || !form.contactName.trim() || !form.email.trim()) {
      setError("Company name, contact name, and email are required.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, extraContacts, fileCount: files.length }),
      });
      if (!res.ok) throw new Error("Something went wrong. Please try again.");

      // Upload files if any
      if (files.length > 0) {
        const { clientId } = await res.json();
        for (const file of files) {
          const formData = new FormData();
          formData.append("file", file);
          formData.append("clientId", clientId || "");
          formData.append("clientName", form.company);
          await fetch("/api/onboard/upload", { method: "POST", body: formData }).catch(() => {});
        }
      }

      setSubmitted(true);
    } catch (err: any) {
      setError(err.message);
    }
    setSubmitting(false);
  }

  if (submitted) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font }}>
        <div style={{ textAlign: "center", maxWidth: 480, padding: "40px 20px" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>Welcome to the party.</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 8 }}>We got your info!</div>
          <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.6 }}>
            Our team will review your project details and reach out shortly.
            We're excited to work with you.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: font, color: C.text }}>
      {/* Header */}
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: "20px 0" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 20px" }}>
          <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-0.02em" }}>house party distro</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Custom apparel + merchandise</div>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px" }}>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Let's get started</div>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 28 }}>
          Tell us about your project and we'll take it from here.
        </div>

        {/* Company */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: C.text, display: "block", marginBottom: 6 }}>
            Company / Brand name *
          </label>
          <input style={ic} value={form.company} onChange={e => upd("company", e.target.value)} placeholder="Your company or brand name" />
        </div>

        {/* Primary contact */}
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Primary Contact</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.text, display: "block", marginBottom: 6 }}>Name *</label>
            <input style={ic} value={form.contactName} onChange={e => upd("contactName", e.target.value)} placeholder="Full name" />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.text, display: "block", marginBottom: 6 }}>Email *</label>
            <input style={ic} type="email" value={form.email} onChange={e => upd("email", e.target.value)} placeholder="email@company.com" />
          </div>
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: C.text, display: "block", marginBottom: 6 }}>Phone</label>
          <input style={ic} type="tel" value={form.phone} onChange={e => upd("phone", e.target.value)} placeholder="(555) 555-5555" />
        </div>

        {/* Additional contacts */}
        {extraContacts.map((c, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 12, marginBottom: 12 }}>
            <input style={ic} value={c.name} onChange={e => { const u = [...extraContacts]; u[i] = { ...u[i], name: e.target.value }; setExtraContacts(u); }} placeholder="Name" />
            <input style={ic} value={c.email} onChange={e => { const u = [...extraContacts]; u[i] = { ...u[i], email: e.target.value }; setExtraContacts(u); }} placeholder="Email" />
            <button type="button" onClick={() => setExtraContacts(prev => prev.filter((_, j) => j !== i))}
              style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 8, color: C.faint, cursor: "pointer", padding: "0 12px", fontSize: 14 }}>x</button>
          </div>
        ))}
        <button type="button" onClick={() => setExtraContacts(prev => [...prev, { name: "", email: "", phone: "" }])}
          style={{ background: "none", border: `1px dashed ${C.border}`, borderRadius: 8, padding: "8px 16px", color: C.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", marginBottom: 24, fontFamily: font }}>
          + Add another contact
        </button>

        {/* Shipping address */}
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Shipping Address</div>
        <div style={{ marginBottom: 12 }}>
          <input style={ic} value={form.address} onChange={e => upd("address", e.target.value)} placeholder="Street address" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12, marginBottom: 24 }}>
          <input style={ic} value={form.city} onChange={e => upd("city", e.target.value)} placeholder="City" />
          <input style={ic} value={form.state} onChange={e => upd("state", e.target.value)} placeholder="State" />
          <input style={ic} value={form.zip} onChange={e => upd("zip", e.target.value)} placeholder="Zip" />
        </div>

        {/* Project details */}
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Project Details</div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: C.text, display: "block", marginBottom: 6 }}>
            What are you looking for?
          </label>
          <textarea style={{ ...ic, minHeight: 100, resize: "vertical", lineHeight: 1.5 }} value={form.projectDetails}
            onChange={e => upd("projectDetails", e.target.value)}
            placeholder="Tell us about your project — what products, quantities, any special requirements..." />
        </div>
        <div style={{ marginBottom: 24 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: C.text, display: "block", marginBottom: 6 }}>Timeline</label>
          <input style={ic} value={form.timeline} onChange={e => upd("timeline", e.target.value)} placeholder="When do you need these? (e.g., June 15, ASAP, flexible)" />
        </div>

        {/* File upload */}
        <div style={{ marginBottom: 28 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: C.text, display: "block", marginBottom: 6 }}>
            Logos or art files (optional)
          </label>
          <div
            onClick={() => document.getElementById("onboard-files")?.click()}
            onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = C.blue; }}
            onDragLeave={e => { e.currentTarget.style.borderColor = C.border; }}
            onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = C.border; setFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]); }}
            style={{
              border: `2px dashed ${C.border}`, borderRadius: 10, padding: "20px",
              textAlign: "center", cursor: "pointer", transition: "border-color 0.15s",
            }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.blue }}>Drop files or click to browse</div>
            <div style={{ fontSize: 11, color: C.faint, marginTop: 4 }}>AI, PSD, PDF, PNG, JPG — any format</div>
          </div>
          <input id="onboard-files" type="file" multiple style={{ display: "none" }}
            onChange={e => { setFiles(prev => [...prev, ...Array.from(e.target.files || [])]); e.target.value = ""; }} />
          {files.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              {files.map((f, i) => (
                <span key={i} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, background: "#eaeaee", color: C.muted, display: "flex", alignItems: "center", gap: 6 }}>
                  {f.name}
                  <button type="button" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                    style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", fontSize: 11, padding: 0 }}>x</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div style={{ padding: "10px 14px", background: "#ffe8ec", borderRadius: 8, color: C.red, fontSize: 13, fontWeight: 600, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {/* Submit */}
        <button type="submit" disabled={submitting}
          style={{
            width: "100%", padding: "14px", borderRadius: 10, border: "none",
            background: C.accent, color: "#fff", fontSize: 15, fontWeight: 700,
            fontFamily: font, cursor: submitting ? "default" : "pointer",
            opacity: submitting ? 0.6 : 1, transition: "opacity 0.15s",
          }}>
          {submitting ? "Submitting..." : "Submit"}
        </button>

        <div style={{ fontSize: 11, color: C.faint, textAlign: "center", marginTop: 12 }}>
          We'll review your info and reach out within 1 business day.
        </div>
      </form>
    </div>
  );
}
