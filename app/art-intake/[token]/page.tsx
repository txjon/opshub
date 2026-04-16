"use client";
import { useState, useEffect, useRef } from "react";

const PURPOSES = [
  { value: "tour", label: "Tour merch", desc: "Sold at shows, for fans" },
  { value: "event", label: "Event / one-off", desc: "Wedding, launch, festival, specific date" },
  { value: "brand_staple", label: "Brand staple", desc: "Ongoing line, core product" },
  { value: "drop", label: "Drop / capsule", desc: "Limited edition, seasonal" },
  { value: "corporate", label: "Corporate gift / promo", desc: "Giveaway, employee apparel" },
  { value: "retail", label: "Retail / webstore", desc: "Product line for sale" },
  { value: "other", label: "Something else", desc: "Tell us about it below" },
];

const MOOD_WORDS = [
  "bold", "clean", "minimal", "maximalist", "vintage", "modern", "nostalgic", "futuristic",
  "premium", "raw", "playful", "serious", "quiet", "loud", "weird", "classic",
  "streetwear", "athletic", "outdoorsy", "luxury", "gritty", "soft", "psychedelic", "grunge",
  "90s", "y2k", "70s", "handmade", "illustrated", "typographic",
];

export default function ArtIntakePage({ params }: { params: { token: string } }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [brief, setBrief] = useState<any>(null);
  const [refs, setRefs] = useState<any[]>([]);
  const [purpose, setPurpose] = useState("");
  const [audience, setAudience] = useState("");
  const [moodWords, setMoodWords] = useState<string[]>([]);
  const [noGos, setNoGos] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const res = await fetch(`/api/art-intake/${params.token}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Couldn't load"); setLoading(false); return; }
      setBrief(data.brief);
      setRefs(data.references || []);
      setPurpose(data.brief.purpose || "");
      setAudience(data.brief.audience || "");
      setMoodWords(data.brief.mood_words || []);
      setNoGos(data.brief.no_gos || "");
      if (data.brief.client_intake_submitted_at) setSubmitted(true);
    } catch (e: any) {
      setError("Couldn't load this page");
    }
    setLoading(false);
  }

  async function uploadFile(file: File) {
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/art-intake/${params.token}/files`, { method: "POST", body: fd });
    const data = await res.json();
    if (data.file) setRefs(p => [...p, data.file]);
    setUploading(false);
  }

  async function deleteRef(fileId: string) {
    await fetch(`/api/art-intake/${params.token}/files?fileId=${fileId}`, { method: "DELETE" });
    setRefs(p => p.filter(r => r.id !== fileId));
  }

  async function saveAnnotation(fileId: string, annotation: string) {
    await fetch(`/api/art-intake/${params.token}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fileId, client_annotation: annotation }),
    });
  }

  const toggleMood = (w: string) => {
    setMoodWords(p => p.includes(w) ? p.filter(x => x !== w) : [...p, w].slice(0, 3));
  };

  async function submit() {
    if (!purpose) { alert("Please pick what this is for"); return; }
    if (refs.length === 0) { alert("Please upload at least one reference image"); return; }
    if (moodWords.length === 0) { alert("Please pick at least one mood word"); return; }

    setSubmitting(true);
    await fetch(`/api/art-intake/${params.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose, audience, mood_words: moodWords, no_gos: noGos }),
    });
    setSubmitting(false);
    setSubmitted(true);
  }

  if (loading) return <div style={{ padding: 40, fontFamily: "-apple-system, sans-serif", color: "#666" }}>Loading...</div>;

  if (error) return (
    <div style={{ padding: 40, fontFamily: "-apple-system, sans-serif", textAlign: "center", maxWidth: 500, margin: "80px auto" }}>
      <h1 style={{ fontSize: 18, marginBottom: 8 }}>Link not found</h1>
      <p style={{ color: "#666", fontSize: 14 }}>{error}</p>
    </div>
  );

  if (submitted) return (
    <div style={{ padding: 40, fontFamily: "-apple-system, sans-serif", textAlign: "center", maxWidth: 500, margin: "80px auto" }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>✓</div>
      <h1 style={{ fontSize: 22, marginBottom: 8, fontWeight: 700 }}>Thanks — we've got it!</h1>
      <p style={{ color: "#666", fontSize: 14, lineHeight: 1.5 }}>
        House Party Distro will review your brief and reach out with anything we need clarified.
        You'll hear from us within 24 hours.
      </p>
      <button onClick={() => setSubmitted(false)}
        style={{ marginTop: 20, padding: "8px 16px", background: "transparent", border: "1px solid #ccc", borderRadius: 6, fontSize: 12, cursor: "pointer", color: "#666" }}>
        Edit my answers
      </button>
    </div>
  );

  const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "#222", marginBottom: 8, display: "block" };
  const hint: React.CSSProperties = { fontSize: 12, color: "#888", marginBottom: 10 };
  const ic: React.CSSProperties = { width: "100%", padding: "10px 14px", fontSize: 14, border: "1px solid #d0d3da", borderRadius: 8, outline: "none", fontFamily: "-apple-system, sans-serif", boxSizing: "border-box" };

  return (
    <div style={{ minHeight: "100vh", background: "#fafafa", fontFamily: "-apple-system, sans-serif", color: "#222" }}>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "40px 20px 80px" }}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 11, color: "#888", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>House Party Distro</div>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>{brief?.title || "Art brief"}</h1>
          <p style={{ fontSize: 15, color: "#666", marginTop: 8, lineHeight: 1.5 }}>
            Quick 2-minute intake so we can get started on your design.
            The more we know now, the less back-and-forth later.
          </p>
        </div>

        {/* Section 1: What's it for? */}
        <div style={{ background: "#fff", border: "1px solid #e2e4ea", borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <label style={label}>1. What's this for?</label>
          <div style={hint}>Pick the closest fit — this helps us understand the context.</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {PURPOSES.map(p => {
              const selected = purpose === p.value;
              return (
                <button key={p.value} onClick={() => setPurpose(p.value)}
                  style={{
                    textAlign: "left", padding: "10px 14px",
                    background: selected ? "#eaf4f7" : "#fff",
                    border: `1px solid ${selected ? "#73b6c9" : "#e2e4ea"}`,
                    borderRadius: 8, cursor: "pointer", fontFamily: "-apple-system, sans-serif",
                  }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: selected ? "#2d7a8f" : "#222" }}>{p.label}</div>
                  <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{p.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Section 2: References */}
        <div style={{ background: "#fff", border: "1px solid #e2e4ea", borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <label style={label}>2. Reference images <span style={{ color: "#dc2626", fontWeight: 400 }}>*</span></label>
          <div style={hint}>Drop in 3–5 images that capture the vibe. Add a quick note next to each so we know why it's relevant.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {refs.map(r => (
              <div key={r.id} style={{ display: "flex", gap: 12, padding: 10, background: "#fafafa", borderRadius: 8, border: "1px solid #eee" }}>
                <a href={r.drive_link} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0 }}>
                  <div style={{ width: 72, height: 72, background: "#eee", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", color: "#999", fontSize: 10 }}>Image</div>
                </a>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: "#222", marginBottom: 4, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.file_name}</div>
                  <input
                    defaultValue={r.client_annotation || ""}
                    onBlur={e => saveAnnotation(r.id, e.target.value)}
                    placeholder="Why does this matter? (e.g. 'love the color palette', 'not this typography')"
                    style={{ width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid #d0d3da", borderRadius: 6, outline: "none", fontFamily: "-apple-system, sans-serif", boxSizing: "border-box" }}
                  />
                </div>
                <button onClick={() => deleteRef(r.id)} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 14, padding: "0 4px" }}>×</button>
              </div>
            ))}
            <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
              style={{ padding: "12px", border: "1px dashed #c0c4cc", borderRadius: 8, background: "transparent", color: "#666", fontSize: 13, cursor: "pointer", fontFamily: "-apple-system, sans-serif" }}>
              {uploading ? "Uploading..." : "+ Add reference image"}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: "none" }}
              onChange={async e => {
                const files = Array.from(e.target.files || []);
                for (const f of files) await uploadFile(f);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }} />
          </div>
        </div>

        {/* Section 3: Vibe words */}
        <div style={{ background: "#fff", border: "1px solid #e2e4ea", borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <label style={label}>3. Pick up to 3 words that describe the vibe <span style={{ color: "#dc2626", fontWeight: 400 }}>*</span></label>
          <div style={hint}>Don't overthink it. The feeling of the final design.</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {MOOD_WORDS.map(w => {
              const selected = moodWords.includes(w);
              return (
                <button key={w} onClick={() => toggleMood(w)}
                  style={{
                    padding: "6px 14px", borderRadius: 99, fontSize: 13, fontWeight: 500,
                    background: selected ? "#222" : "#fff",
                    color: selected ? "#fff" : "#555",
                    border: `1px solid ${selected ? "#222" : "#d0d3da"}`,
                    cursor: "pointer", fontFamily: "-apple-system, sans-serif",
                  }}>
                  {w}
                </button>
              );
            })}
          </div>
          {moodWords.length > 0 && <div style={{ fontSize: 11, color: "#888", marginTop: 10 }}>Selected: {moodWords.join(" · ")}</div>}
        </div>

        {/* Section 4: Audience (optional) */}
        <div style={{ background: "#fff", border: "1px solid #e2e4ea", borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <label style={label}>4. Who's going to wear this? <span style={{ color: "#888", fontWeight: 400, fontSize: 12 }}>(optional)</span></label>
          <div style={hint}>One line. Age range, vibe of your audience, whatever comes to mind.</div>
          <input value={audience} onChange={e => setAudience(e.target.value)}
            placeholder="e.g. fans 18-30, mostly streetwear kids" style={ic} />
        </div>

        {/* Section 5: No-gos */}
        <div style={{ background: "#fff", border: "1px solid #e2e4ea", borderRadius: 12, padding: 24, marginBottom: 24 }}>
          <label style={label}>5. Anything to DEFINITELY avoid? <span style={{ color: "#888", fontWeight: 400, fontSize: 12 }}>(optional)</span></label>
          <div style={hint}>Anything off-limits, past designs that didn't work, styles you're sick of, etc.</div>
          <textarea value={noGos} onChange={e => setNoGos(e.target.value)}
            placeholder="e.g. no skulls, nothing too 'corporate', avoid pastels" rows={2}
            style={{ ...ic, resize: "vertical", lineHeight: 1.5 }} />
        </div>

        {/* Submit */}
        <button onClick={submit} disabled={submitting}
          style={{
            width: "100%", padding: "14px", fontSize: 15, fontWeight: 700,
            background: "#222", color: "#fff", border: "none", borderRadius: 10,
            cursor: "pointer", fontFamily: "-apple-system, sans-serif",
            opacity: submitting ? 0.5 : 1,
          }}>
          {submitting ? "Submitting..." : "Submit brief"}
        </button>
        <p style={{ fontSize: 11, color: "#888", textAlign: "center", marginTop: 12 }}>
          You can come back to this link anytime to update your answers.
        </p>
      </div>
    </div>
  );
}
