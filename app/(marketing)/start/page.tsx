"use client";
import { useEffect, useMemo, useRef, useState } from "react";

// /start — 6-step intake form. Single client component with a `step`
// state machine and one `form` state object for all collected data.
// Submits to POST /api/onboard. Files uploaded in parallel via
// /api/onboard/upload before final submission.
//
// Steps:
//   1. Project type
//   2. Project details + scope
//   3. File upload
//   4. Items + size breakdown (optional)
//   5. Contact + shipping route
//   6. Review + submit

const PROJECT_TYPES = [
  { value: "production",   title: "Product Manufacturing",      desc: "You know what you want and just need us to make it happen." },
  { value: "design",       title: "Design and Development",     desc: "You have direction. We'll help you turn your idea into something real." },
  { value: "fulfillment",  title: "Warehousing and Fulfillment", desc: "You have product. We store, pick, and ship to your customers." },
  { value: "full_service", title: "Full Service",               desc: "Concept to customer. Every step handled under one roof." },
] as const;

const ITEMS_RANGES = ["1-3 designs", "4-8 designs", "9-15 designs", "15+ designs"];
const UNITS_RANGES = ["Under 100", "100-500", "500-2,000", "2,000-5,000", "5,000+"];
const BUDGET_RANGES = ["Under $5,000", "$5,000-$15,000", "$15,000-$50,000", "$50,000+", "Not sure yet"];
const SIZES_LIST = ["XS", "S", "M", "L", "XL", "2XL", "3XL"];

const SHIPPING_ROUTES = [
  { value: "ship_to_us",            title: "Ship to HPD",       desc: "Goods come to our Las Vegas warehouse, we forward to you." },
  { value: "drop_ship",             title: "Drop ship",         desc: "Goods ship direct from decorator to client / end customer." },
  { value: "hold_for_fulfillment",  title: "Hold for fulfillment", desc: "Stored as inventory, we pick + pack as orders come in." },
];

const TOTAL_STEPS = 6;

type Step = 1 | 2 | 3 | 4 | 5 | 6;

type FileRow = {
  id: string;            // local key
  file: File;
  uploading: boolean;
  uploaded: boolean;
  error: string | null;
  url: string | null;
  size: number;
};

type ItemRow = {
  id: string;
  name: string;
  sizes: Record<string, string>;  // string so empty / partial inputs don't break
};

type FormState = {
  // Step 1
  project_type: string;
  // Step 2
  project_name: string;
  description: string;
  items_count_range: string;
  units_range: string;
  target_ship_date: string;
  budget_range: string;
  // Step 3
  files: FileRow[];
  // Step 4
  items: ItemRow[];
  // Step 5
  contactName: string;
  email: string;
  phone: string;
  company: string;
  shipping_route: string;
};

const initialState: FormState = {
  project_type: "",
  project_name: "",
  description: "",
  items_count_range: "",
  units_range: "",
  target_ship_date: "",
  budget_range: "",
  files: [],
  items: [],
  contactName: "",
  email: "",
  phone: "",
  company: "",
  shipping_route: "",
};

export default function StartPage() {
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormState>(initialState);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const sessionRef = useRef<string>(`s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  // Scroll-to-top on step change so the next step's content is fully
  // visible on small screens. Without this the user lands mid-form.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(f => ({ ...f, [key]: value }));
  }

  function canAdvance(): boolean {
    if (step === 1) return !!form.project_type;
    if (step === 2) return !!form.project_name.trim();
    if (step === 5) return !!form.contactName.trim() && /\S+@\S+\.\S+/.test(form.email) && !!form.company.trim();
    return true;
  }

  async function handleSubmit() {
    if (submitting) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const payload = {
        // Required
        company: form.company.trim(),
        contactName: form.contactName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        // Step 1-2
        project_type: form.project_type || undefined,
        project_name: form.project_name.trim() || undefined,
        description: form.description.trim() || undefined,
        items_count_range: form.items_count_range || undefined,
        units_range: form.units_range || undefined,
        target_ship_date: form.target_ship_date || undefined,
        budget_range: form.budget_range || undefined,
        // Step 5
        shipping_route: form.shipping_route || undefined,
        // Step 4 — only items with a name OR some sizes
        items: form.items
          .filter(it => it.name.trim() || Object.values(it.sizes).some(v => parseInt(v) > 0))
          .map(it => ({
            name: it.name.trim() || undefined,
            sizes: Object.fromEntries(
              Object.entries(it.sizes)
                .map(([k, v]) => [k, parseInt(v)])
                .filter(([, n]) => typeof n === "number" && !isNaN(n) && n > 0)
            ),
          })),
        // Step 3 — only successfully-uploaded files
        files: form.files
          .filter(f => f.uploaded && f.url)
          .map(f => ({ filename: f.file.name, url: f.url, size: f.size })),
      };

      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        throw new Error(data?.error || "Submission failed");
      }
      setSubmitted(true);
    } catch (e: any) {
      setSubmitError(e?.message || "Submission failed. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // Upload a single file. Triggered immediately when the user picks a
  // file in step 3 — keeps the final submit fast (files are already in
  // storage by then).
  //
  // Two-step flow to bypass Vercel's 4.5MB serverless body limit:
  //   1. POST metadata to /api/onboard/upload → get signed upload URL
  //   2. PUT the raw file directly to Supabase Storage (browser → Supabase)
  async function uploadFile(row: FileRow) {
    setForm(f => ({
      ...f,
      files: f.files.map(r => r.id === row.id ? { ...r, uploading: true, error: null } : r),
    }));
    try {
      // Step 1 — get signed URL
      const initRes = await fetch("/api/onboard/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: row.file.name,
          contentType: row.file.type,
          session: sessionRef.current,
        }),
      });
      const init = await initRes.json();
      if (!initRes.ok || init?.error) throw new Error(init?.error || "Could not get upload URL");
      if (init.session) sessionRef.current = init.session;

      // Step 2 — PUT directly to Supabase
      const putRes = await fetch(init.uploadUrl, {
        method: "PUT",
        body: row.file,
        headers: {
          "Content-Type": row.file.type || "application/octet-stream",
        },
      });
      if (!putRes.ok) {
        throw new Error(`Upload failed (HTTP ${putRes.status})`);
      }

      setForm(f => ({
        ...f,
        files: f.files.map(r => r.id === row.id
          ? { ...r, uploading: false, uploaded: true, url: init.downloadUrl, error: null }
          : r),
      }));
    } catch (e: any) {
      setForm(f => ({
        ...f,
        files: f.files.map(r => r.id === row.id
          ? { ...r, uploading: false, uploaded: false, error: e?.message || "Upload failed" }
          : r),
      }));
    }
  }

  function addFiles(filesIn: FileList | null) {
    if (!filesIn) return;
    const MAX_BYTES = 50 * 1024 * 1024; // 50MB per file
    const newRows: FileRow[] = Array.from(filesIn).map(file => {
      const oversize = file.size > MAX_BYTES;
      return {
        id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        uploading: false,
        uploaded: false,
        error: oversize ? `Too large (${Math.round(file.size / 1024 / 1024)}MB). Max 50MB per file. Paste a link to it in the description instead.` : null,
        url: null,
        size: file.size,
      };
    });
    setForm(f => ({ ...f, files: [...f.files, ...newRows] }));
    // Fire uploads immediately (only for in-bounds files) so the user
    // doesn't wait at submit time.
    newRows.filter(r => !r.error).forEach(r => uploadFile(r));
  }

  function removeFile(id: string) {
    setForm(f => ({ ...f, files: f.files.filter(r => r.id !== id) }));
  }

  function addItem() {
    setForm(f => ({
      ...f,
      items: [...f.items, {
        id: `it-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: "",
        sizes: Object.fromEntries(SIZES_LIST.map(s => [s, ""])),
      }],
    }));
  }
  function updateItem(id: string, patch: Partial<ItemRow>) {
    setForm(f => ({
      ...f,
      items: f.items.map(it => it.id === id ? { ...it, ...patch } : it),
    }));
  }
  function updateItemSize(id: string, size: string, value: string) {
    setForm(f => ({
      ...f,
      items: f.items.map(it => it.id === id ? { ...it, sizes: { ...it.sizes, [size]: value } } : it),
    }));
  }
  function removeItem(id: string) {
    setForm(f => ({ ...f, items: f.items.filter(it => it.id !== id) }));
  }

  const filesPending = useMemo(() => form.files.some(f => f.uploading), [form.files]);

  // SUCCESS STATE — replaces the form once submitted.
  if (submitted) {
    return (
      <SuccessScreen onReset={() => {
        setForm(initialState);
        setStep(1);
        setSubmitted(false);
        sessionRef.current = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      }} />
    );
  }

  return (
    <>
      {/* Header band — much smaller than other PageHeros since the form is the focus */}
      <section style={{
        background: "#0a0a0c",
        color: "#fff",
        padding: "48px 32px 40px",
        textAlign: "center",
      }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <h1 style={{
            fontSize: "clamp(24px, 3.5vw, 36px)",
            fontWeight: 900,
            letterSpacing: "-0.02em",
            textTransform: "uppercase",
            lineHeight: 1.1,
          }}>
            Tell us what you need.
          </h1>
          <p style={{
            fontSize: 14,
            color: "rgba(255,255,255,0.7)",
            marginTop: 12,
            lineHeight: 1.55,
          }}>
            Six quick steps. We&apos;ll take it from there.
          </p>
        </div>
      </section>

      {/* Form body */}
      <section style={{ padding: "48px 32px 96px", background: "#fff" }}>
        <div style={{ maxWidth: 680, margin: "0 auto" }}>
          {/* Progress bar */}
          <StepBar step={step} total={TOTAL_STEPS} />

          <div style={{
            background: "#fff",
            border: "1px solid #e0e0e4",
            borderRadius: 12,
            padding: "32px 32px 28px",
            marginTop: 24,
          }}>
            {/* Step heading */}
            <StepHeading step={step} />

            {step === 1 && (
              <Step1
                value={form.project_type}
                onSelect={v => update("project_type", v)}
              />
            )}

            {step === 2 && (
              <Step2 form={form} update={update} />
            )}

            {step === 3 && (
              <Step3
                files={form.files}
                onAdd={addFiles}
                onRemove={removeFile}
              />
            )}

            {step === 4 && (
              <Step4
                items={form.items}
                onAdd={addItem}
                onUpdate={updateItem}
                onUpdateSize={updateItemSize}
                onRemove={removeItem}
              />
            )}

            {step === 5 && (
              <Step5 form={form} update={update} />
            )}

            {step === 6 && (
              <Step6 form={form} sizesList={SIZES_LIST} />
            )}

            {submitError && step === 6 && (
              <div style={{
                background: "#ffe8ec", border: "1px solid #ffc3cc",
                color: "#c43030", borderRadius: 8,
                padding: "10px 14px", marginTop: 16, fontSize: 13,
              }}>
                {submitError}
              </div>
            )}

            {/* Step nav buttons */}
            <div style={{
              display: "flex", gap: 10, marginTop: 28,
            }}>
              {step > 1 && (
                <button
                  type="button"
                  onClick={() => setStep((step - 1) as Step)}
                  disabled={submitting}
                  style={btnSecondary}
                >
                  ← Back
                </button>
              )}
              <div style={{ flex: 1 }} />
              {step < TOTAL_STEPS && (
                <button
                  type="button"
                  onClick={() => setStep((step + 1) as Step)}
                  disabled={!canAdvance()}
                  style={{ ...btnPrimary, opacity: canAdvance() ? 1 : 0.4, cursor: canAdvance() ? "pointer" : "default" }}
                >
                  Next →
                </button>
              )}
              {step === TOTAL_STEPS && (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting || filesPending}
                  style={{ ...btnPrimary, opacity: submitting || filesPending ? 0.5 : 1, cursor: submitting || filesPending ? "default" : "pointer" }}
                >
                  {submitting ? "Sending..." : filesPending ? "Waiting on file uploads..." : "Send to HPD"}
                </button>
              )}
            </div>
          </div>

          <p style={{
            fontSize: 12, color: "#a0a0ad",
            textAlign: "center", marginTop: 20, lineHeight: 1.5,
          }}>
            Already a client? <a href="/client-portal" style={{ color: "#1a1a1a", fontWeight: 600 }}>Sign in to your portal →</a>
          </p>
        </div>
      </section>
    </>
  );
}

// ─── Sub-components ─────────────────────────────────────────────

function StepBar({ step, total }: { step: number; total: number }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {Array.from({ length: total }).map((_, i) => {
        const n = i + 1;
        const state = n < step ? "done" : n === step ? "active" : "future";
        return (
          <div key={n} style={{
            flex: 1, height: 4, borderRadius: 2,
            background: state === "done" ? "rgb(115, 182, 201)" : state === "active" ? "#1a1a1a" : "#e0e0e4",
            transition: "background 0.2s",
          }} />
        );
      })}
    </div>
  );
}

function StepHeading({ step }: { step: Step }) {
  const titles: Record<Step, { eyebrow: string; title: string; sub: string }> = {
    1: { eyebrow: "Step 1 of 6", title: "What do you need from us?", sub: "Pick the closest fit. We'll dial in the details together." },
    2: { eyebrow: "Step 2 of 6", title: "Tell us about it",         sub: "The more we know, the faster we can get to work." },
    3: { eyebrow: "Step 3 of 6", title: "Upload your files",         sub: "Artwork, logos, inspiration, tech packs. Anything that helps us understand your vision. Optional." },
    4: { eyebrow: "Step 4 of 6", title: "Items &amp; sizes",         sub: "If you know your size breakdown, enter it here. Skip if not." },
    5: { eyebrow: "Step 5 of 6", title: "Your details",              sub: "Where should we send the quote?" },
    6: { eyebrow: "Step 6 of 6", title: "Review &amp; submit",       sub: "Last look before we get to work." },
  };
  const t = titles[step];
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        fontSize: 10, fontWeight: 700,
        textTransform: "uppercase", letterSpacing: "0.1em",
        color: "#a0a0ad", marginBottom: 8,
      }}>{t.eyebrow}</div>
      <h2
        dangerouslySetInnerHTML={{ __html: t.title }}
        style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.2, marginBottom: 6, color: "#1a1a1a" }}
      />
      <p
        dangerouslySetInnerHTML={{ __html: t.sub }}
        style={{ fontSize: 13, color: "#6b6b78", lineHeight: 1.55 }}
      />
    </div>
  );
}

function Step1({ value, onSelect }: { value: string; onSelect: (v: string) => void }) {
  return (
    <div className="hpd-type-grid" style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 10,
    }}>
      {PROJECT_TYPES.map(t => (
        <button
          key={t.value}
          type="button"
          onClick={() => onSelect(t.value)}
          style={{
            textAlign: "left",
            border: `2px solid ${value === t.value ? "#1a1a1a" : "#e0e0e4"}`,
            background: value === t.value ? "#f3f3f5" : "#fff",
            borderRadius: 10,
            padding: "18px 18px",
            cursor: "pointer",
            transition: "border-color 0.12s, background 0.12s",
            fontFamily: "inherit",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a", marginBottom: 4 }}>{t.title}</div>
          <div style={{ fontSize: 12, color: "#6b6b78", lineHeight: 1.5 }}>{t.desc}</div>
        </button>
      ))}
      <style>{`
        @media (max-width: 540px) {
          .hpd-type-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function Step2({
  form, update,
}: {
  form: FormState;
  update: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Field label="Project name *">
        <input
          type="text"
          value={form.project_name}
          onChange={e => update("project_name", e.target.value)}
          placeholder="e.g. Summer Tour 2026 Merch"
          style={inputStyle}
          autoFocus
        />
      </Field>
      <Field label="Description">
        <textarea
          value={form.description}
          onChange={e => update("description", e.target.value)}
          placeholder="What items do you need? Any specific blanks, colors, or print methods? Special packaging?"
          rows={4}
          style={{ ...inputStyle, resize: "vertical", minHeight: 96 }}
        />
      </Field>
      <div className="hpd-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Estimated designs">
          <select value={form.items_count_range} onChange={e => update("items_count_range", e.target.value)} style={inputStyle}>
            <option value="">Select...</option>
            {ITEMS_RANGES.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Estimated total units">
          <select value={form.units_range} onChange={e => update("units_range", e.target.value)} style={inputStyle}>
            <option value="">Select...</option>
            {UNITS_RANGES.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
      </div>
      <div className="hpd-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Target ship date">
          <input type="date" value={form.target_ship_date} onChange={e => update("target_ship_date", e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Budget range">
          <select value={form.budget_range} onChange={e => update("budget_range", e.target.value)} style={inputStyle}>
            <option value="">Select...</option>
            {BUDGET_RANGES.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
      </div>
      <style>{`
        @media (max-width: 540px) {
          .hpd-row { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function Step3({
  files, onAdd, onRemove,
}: {
  files: FileRow[];
  onAdd: (f: FileList | null) => void;
  onRemove: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); onAdd(e.dataTransfer.files); }}
        style={{
          border: `2px dashed ${dragOver ? "#1a1a1a" : "#d0d0d5"}`,
          borderRadius: 10,
          padding: "36px 20px",
          textAlign: "center",
          cursor: "pointer",
          background: dragOver ? "#f3f3f5" : "transparent",
          transition: "all 0.15s",
        }}
      >
        <div style={{ fontSize: 24, marginBottom: 6, color: "#a0a0ad" }}>+</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a", marginBottom: 4 }}>
          Drag files here or click to browse
        </div>
        <div style={{ fontSize: 11, color: "#a0a0ad" }}>
          Up to 50MB per file. PSD, AI, PNG, JPG, PDF all work.
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          onChange={e => { onAdd(e.target.files); e.target.value = ""; }}
          style={{ display: "none" }}
        />
      </div>

      {files.length > 0 && (
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8 }}>
          {files.map(f => (
            <div key={f.id} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "10px 14px",
              background: "#f8f8f9",
              border: "1px solid #e0e0e4",
              borderRadius: 8,
              fontSize: 13,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontWeight: 600, color: "#1a1a1a",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {f.file.name}
                </div>
                <div style={{ fontSize: 11, color: "#a0a0ad", marginTop: 2 }}>
                  {Math.round(f.size / 1024)} KB
                  {f.uploading && " · uploading..."}
                  {f.uploaded && " · ✓ uploaded"}
                  {f.error && ` · ${f.error}`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRemove(f.id)}
                style={{
                  background: "transparent", border: "none", cursor: "pointer",
                  fontSize: 18, color: "#a0a0ad", padding: "4px 8px",
                }}
                aria-label="Remove file"
              >×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Step4({
  items, onAdd, onUpdate, onUpdateSize, onRemove,
}: {
  items: ItemRow[];
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<ItemRow>) => void;
  onUpdateSize: (id: string, size: string, value: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div>
      {items.length === 0 && (
        <div style={{
          background: "#f8f8f9", border: "1px solid #e0e0e4", borderRadius: 8,
          padding: "20px 18px", textAlign: "center", marginBottom: 12,
        }}>
          <div style={{ fontSize: 13, color: "#6b6b78", marginBottom: 12 }}>
            No items yet. Add one if you have a size breakdown in mind. Otherwise skip this step.
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {items.map((it, idx) => (
            <div key={it.id} style={{
              background: "#f8f8f9", border: "1px solid #e0e0e4", borderRadius: 10,
              padding: "16px 18px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <span style={{
                  fontSize: 11, fontWeight: 800,
                  background: "#1a1a1a", color: "#fff",
                  borderRadius: 99, width: 22, height: 22,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>{idx + 1}</span>
                <input
                  type="text"
                  placeholder="Item name (e.g. Front Logo Tee)"
                  value={it.name}
                  onChange={e => onUpdate(it.id, { name: e.target.value })}
                  style={{ ...inputStyle, flex: 1, padding: "8px 12px", fontSize: 13, background: "#fff" }}
                />
                <button
                  type="button"
                  onClick={() => onRemove(it.id)}
                  style={{
                    background: "transparent", border: "none", cursor: "pointer",
                    fontSize: 18, color: "#a0a0ad", padding: "4px 8px",
                  }}
                  aria-label="Remove item"
                >×</button>
              </div>
              <div className="hpd-size-grid" style={{
                display: "grid",
                gridTemplateColumns: `repeat(${SIZES_LIST.length}, 1fr)`,
                gap: 6,
              }}>
                {SIZES_LIST.map(size => (
                  <div key={size}>
                    <div style={{
                      fontSize: 10, fontWeight: 700,
                      textAlign: "center", color: "#6b6b78",
                      marginBottom: 4,
                    }}>{size}</div>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={it.sizes[size] || ""}
                      onChange={e => onUpdateSize(it.id, size, e.target.value.replace(/[^0-9]/g, ""))}
                      placeholder="0"
                      style={{
                        width: "100%", padding: "8px 6px",
                        textAlign: "center",
                        border: "1px solid #e0e0e4",
                        borderRadius: 6,
                        fontSize: 13,
                        background: "#fff",
                        fontFamily: "inherit",
                        outline: "none",
                        color: "#1a1a1a",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onAdd}
        style={{
          ...btnSecondary,
          width: "100%",
          marginTop: items.length > 0 ? 14 : 0,
        }}
      >
        + Add an item
      </button>

      <style>{`
        @media (max-width: 540px) {
          .hpd-size-grid { grid-template-columns: repeat(4, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}

function Step5({
  form, update,
}: {
  form: FormState;
  update: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="hpd-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Your name *">
          <input type="text" value={form.contactName} onChange={e => update("contactName", e.target.value)} placeholder="Drake Smith" style={inputStyle} autoFocus />
        </Field>
        <Field label="Company *">
          <input type="text" value={form.company} onChange={e => update("company", e.target.value)} placeholder="Your Brand" style={inputStyle} />
        </Field>
      </div>
      <div className="hpd-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Email *">
          <input type="email" value={form.email} onChange={e => update("email", e.target.value)} placeholder="you@yourbrand.com" style={inputStyle} />
        </Field>
        <Field label="Phone">
          <input type="tel" value={form.phone} onChange={e => update("phone", e.target.value)} placeholder="(555) 555-5555" style={inputStyle} />
        </Field>
      </div>

      <div style={{ marginTop: 8 }}>
        <Field label="Where should the finished goods go?">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {SHIPPING_ROUTES.map(r => (
              <button
                key={r.value}
                type="button"
                onClick={() => update("shipping_route", r.value)}
                style={{
                  textAlign: "left",
                  background: form.shipping_route === r.value ? "#f3f3f5" : "#fff",
                  border: `2px solid ${form.shipping_route === r.value ? "#1a1a1a" : "#e0e0e4"}`,
                  borderRadius: 10,
                  padding: "12px 16px",
                  cursor: "pointer",
                  transition: "all 0.12s",
                  fontFamily: "inherit",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: "#1a1a1a", marginBottom: 2 }}>{r.title}</div>
                <div style={{ fontSize: 12, color: "#6b6b78", lineHeight: 1.5 }}>{r.desc}</div>
              </button>
            ))}
          </div>
        </Field>
      </div>

      <style>{`
        @media (max-width: 540px) {
          .hpd-row { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function Step6({ form, sizesList }: { form: FormState; sizesList: string[] }) {
  const projectType = PROJECT_TYPES.find(t => t.value === form.project_type)?.title;
  const shippingRoute = SHIPPING_ROUTES.find(r => r.value === form.shipping_route)?.title;
  const itemsWithContent = form.items.filter(it =>
    it.name.trim() || Object.values(it.sizes).some(v => parseInt(v) > 0)
  );
  const uploadedFiles = form.files.filter(f => f.uploaded);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Summary label="Project type" value={projectType || "Not provided"} />
      <Summary label="Project name" value={form.project_name || "Not provided"} />
      {form.description && <Summary label="Description" value={form.description} multiline />}
      {(form.items_count_range || form.units_range || form.target_ship_date || form.budget_range) && (
        <div style={summaryBlock}>
          <div style={summaryLabel}>Scope</div>
          <div style={{ fontSize: 13, color: "#1a1a1a", lineHeight: 1.7 }}>
            {form.items_count_range && <div>Designs: {form.items_count_range}</div>}
            {form.units_range && <div>Units: {form.units_range}</div>}
            {form.target_ship_date && <div>Ship date: {form.target_ship_date}</div>}
            {form.budget_range && <div>Budget: {form.budget_range}</div>}
          </div>
        </div>
      )}
      {shippingRoute && <Summary label="Shipping" value={shippingRoute} />}
      {itemsWithContent.length > 0 && (
        <div style={summaryBlock}>
          <div style={summaryLabel}>Items &amp; sizes</div>
          <div style={{ fontSize: 13, color: "#1a1a1a", lineHeight: 1.7 }}>
            {itemsWithContent.map(it => {
              const sizeStr = sizesList
                .map(s => [s, parseInt(it.sizes[s])] as [string, number])
                .filter(([, n]) => !isNaN(n) && n > 0)
                .map(([s, n]) => `${s}(${n})`)
                .join(" ");
              return (
                <div key={it.id}>
                  • {it.name || "Item"}{sizeStr ? `: ${sizeStr}` : ""}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {uploadedFiles.length > 0 && (
        <div style={summaryBlock}>
          <div style={summaryLabel}>Files ({uploadedFiles.length})</div>
          <div style={{ fontSize: 13, color: "#1a1a1a", lineHeight: 1.7 }}>
            {uploadedFiles.map(f => (
              <div key={f.id}>• {f.file.name}</div>
            ))}
          </div>
        </div>
      )}
      <Summary label="Contact" value={`${form.contactName} · ${form.email}${form.phone ? " · " + form.phone : ""}`} />
      <Summary label="Company" value={form.company} />
    </div>
  );
}

function Summary({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div style={summaryBlock}>
      <div style={summaryLabel}>{label}</div>
      <div style={{
        fontSize: 13, color: "#1a1a1a", lineHeight: 1.55,
        whiteSpace: multiline ? "pre-wrap" : "normal",
      }}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{
        display: "block",
        fontSize: 10, fontWeight: 700,
        textTransform: "uppercase", letterSpacing: "0.08em",
        color: "#6b6b78", marginBottom: 6,
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function SuccessScreen({ onReset }: { onReset: () => void }) {
  return (
    <section style={{ padding: "120px 32px 160px", background: "#fff", textAlign: "center" }}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <div style={{
          width: 60, height: 60, borderRadius: 99,
          background: "#e6f5ee", color: "#1a8c5c",
          fontSize: 28, fontWeight: 800,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          marginBottom: 18,
        }}>✓</div>
        <h1 style={{
          fontSize: "clamp(24px, 3.5vw, 32px)", fontWeight: 900,
          letterSpacing: "-0.02em", lineHeight: 1.15,
          textTransform: "uppercase", marginBottom: 14,
        }}>
          We got it.
        </h1>
        <p style={{
          fontSize: 15, color: "#4a4a55",
          lineHeight: 1.65, marginBottom: 26,
        }}>
          Thanks for the details. We&rsquo;ll get back to you within one business day with a quote and next steps. Keep an eye on your inbox.
        </p>
        <button
          type="button"
          onClick={onReset}
          style={{
            ...btnSecondary,
            padding: "12px 24px",
            fontSize: 13,
          }}
        >
          Start another project
        </button>
      </div>
    </section>
  );
}

// ─── Styles ─────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  fontSize: 14,
  border: "1px solid #e0e0e4",
  borderRadius: 8,
  outline: "none",
  fontFamily: "inherit",
  color: "#1a1a1a",
  background: "#f8f8f9",
  boxSizing: "border-box",
};

const btnPrimary: React.CSSProperties = {
  padding: "12px 28px",
  background: "#1a1a1a",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 13, fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  cursor: "pointer",
  fontFamily: "inherit",
};

const btnSecondary: React.CSSProperties = {
  padding: "12px 24px",
  background: "transparent",
  color: "#1a1a1a",
  border: "1px solid #e0e0e4",
  borderRadius: 8,
  fontSize: 13, fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};

const summaryBlock: React.CSSProperties = {
  background: "#f8f8f9",
  border: "1px solid #e0e0e4",
  borderRadius: 8,
  padding: "12px 16px",
};

const summaryLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 700,
  textTransform: "uppercase", letterSpacing: "0.08em",
  color: "#a0a0ad", marginBottom: 4,
};
