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

const ITEMS_RANGES = ["1-3 products", "4-8 products", "9-15 products", "15+ products"];
const UNITS_RANGES = ["Under 100", "100-500", "500-2,000", "2,000-5,000", "5,000+", "Not sure yet"];
const BUDGET_RANGES = ["Under $5,000", "$5,000-$15,000", "$15,000-$50,000", "$50,000+", "Not sure yet"];
const SIZES_LIST = ["XS", "S", "M", "L", "XL", "2XL", "3XL"];

const SHIPPING_ROUTES = [
  { value: "ship_to_us",            title: "Ship to HPD",       desc: "Goods come to our Las Vegas warehouse, we forward to you." },
  { value: "drop_ship",             title: "Drop ship",         desc: "Goods ship direct from decorator to client / end customer." },
  { value: "hold_for_fulfillment",  title: "Hold for fulfillment", desc: "Stored as inventory, we pick + pack as orders come in." },
];

const TOTAL_STEPS = 6;

// Earliest "needed by" date a client can pick: today and the next 3 business
// days are blocked, because anything that fast isn't realistic for sourcing
// + production + ship. Min selectable = the day AFTER the 3rd business day
// from today. Weekends after that point stay selectable.
function getMinNeededByDate(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  let businessDaysCounted = 0;
  while (businessDaysCounted < 3) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) businessDaysCounted++;
  }
  d.setDate(d.getDate() + 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6;

type FileRow = {
  id: string;            // local key
  file: File;
  uploading: boolean;
  uploaded: boolean;
  error: string | null;
  url: string | null;
  path: string | null;   // storage object path — used to delete on × click
  size: number;
  loaded: number;        // bytes uploaded so far (XHR upload progress)
};

type SizeCell = {
  id: string;     // stable column id, used as the React key
  label: string;  // size label (editable — "XS", "OS", "4XL", whatever)
  qty: string;    // string so empty / partial inputs don't break
};

type ItemRow = {
  id: string;
  name: string;
  sizes: SizeCell[];
};

function makeDefaultSizes(): SizeCell[] {
  return SIZES_LIST.map((label, i) => ({
    id: `sz-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
    label,
    qty: "",
  }));
}

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

function makeBlankItem(): ItemRow {
  return {
    id: `it-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: "",
    sizes: makeDefaultSizes(),
  };
}

// Function (not const) so a reset on the success screen gives the form
// fresh ids on its default row + sizes. Module-level constants would
// reuse the same ids on every reset.
function makeInitialState(): FormState {
  return {
    project_type: "",
    project_name: "",
    description: "",
    items_count_range: "",
    units_range: "",
    target_ship_date: "",
    budget_range: "",
    files: [],
    items: [makeBlankItem()],
    contactName: "",
    email: "",
    phone: "",
    company: "",
    shipping_route: "",
  };
}
const initialState: FormState = makeInitialState();

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
        // Step 4 — only items with a name OR some sizes. Sizes are stored
        // as a SizeCell[] for the UI; the API still wants a flat
        // { label: qty } record, so we flatten on the way out.
        items: form.items
          .filter(it => it.name.trim() || it.sizes.some(c => parseInt(c.qty) > 0))
          .map(it => ({
            name: it.name.trim() || undefined,
            sizes: it.sizes.reduce<Record<string, number>>((acc, c) => {
              const label = c.label.trim();
              const n = parseInt(c.qty);
              if (label && !isNaN(n) && n > 0) acc[label] = n;
              return acc;
            }, {}),
          })),
        // Step 3 — only successfully-uploaded files
        files: form.files
          .filter(f => f.uploaded && f.url)
          .map(f => ({ filename: f.file.name, url: f.url, size: f.size, path: f.path })),
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
      files: f.files.map(r => r.id === row.id ? { ...r, uploading: true, error: null, loaded: 0 } : r),
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

      // Step 2 — PUT directly to Supabase via XHR so we get real-time
      // upload progress events. `fetch` doesn't expose upload progress.
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", init.uploadUrl);
        xhr.setRequestHeader("Content-Type", row.file.type || "application/octet-stream");
        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;
          setForm(f => ({
            ...f,
            files: f.files.map(r => r.id === row.id ? { ...r, loaded: e.loaded } : r),
          }));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Upload failed (HTTP ${xhr.status})`));
        };
        xhr.onerror = () => reject(new Error("Upload failed (network error)"));
        xhr.send(row.file);
      });

      setForm(f => ({
        ...f,
        files: f.files.map(r => r.id === row.id
          ? { ...r, uploading: false, uploaded: true, url: init.downloadUrl, path: init.path, error: null, loaded: r.size }
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
        path: null,
        size: file.size,
        loaded: 0,
      };
    });
    setForm(f => ({ ...f, files: [...f.files, ...newRows] }));
    // Fire uploads immediately (only for in-bounds files) so the user
    // doesn't wait at submit time.
    newRows.filter(r => !r.error).forEach(r => uploadFile(r));
  }

  function removeFile(id: string) {
    setForm(f => {
      // If the file was uploaded to Supabase, fire a fire-and-forget
      // DELETE so the orphan bytes don't linger. Failure is fine — the
      // nightly sweeper picks up anything we miss.
      const row = f.files.find(r => r.id === id);
      if (row?.path) {
        fetch("/api/onboard/upload", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: row.path }),
          keepalive: true,
        }).catch(() => {});
      }
      return { ...f, files: f.files.filter(r => r.id !== id) };
    });
  }

  function addItem() {
    setForm(f => ({ ...f, items: [...f.items, makeBlankItem()] }));
  }
  function updateItem(id: string, patch: Partial<ItemRow>) {
    setForm(f => ({
      ...f,
      items: f.items.map(it => it.id === id ? { ...it, ...patch } : it),
    }));
  }
  function replaceItemSizes(itemId: string, sizes: SizeCell[]) {
    setForm(f => ({
      ...f,
      items: f.items.map(it => it.id === itemId ? { ...it, sizes } : it),
    }));
  }
  function removeItem(id: string) {
    setForm(f => ({ ...f, items: f.items.filter(it => it.id !== id) }));
  }

  const filesPending = useMemo(() => form.files.some(f => f.uploading), [form.files]);

  // Total upload progress across the current batch (any file currently
  // uploading or already uploaded). Drives the freeze overlay.
  const uploadStats = useMemo(() => {
    const inFlight = form.files.filter(f => f.uploading || f.uploaded);
    const totalSize = inFlight.reduce((s, f) => s + (f.size || 0), 0);
    const totalLoaded = inFlight.reduce((s, f) => s + (f.uploaded ? (f.size || 0) : (f.loaded || 0)), 0);
    const pct = totalSize > 0 ? Math.min(100, Math.floor((totalLoaded / totalSize) * 100)) : 0;
    const activeCount = form.files.filter(f => f.uploading).length;
    return { totalSize, totalLoaded, pct, activeCount };
  }, [form.files]);

  // SUCCESS STATE — replaces the form once submitted.
  if (submitted) {
    return (
      <SuccessScreen onReset={() => {
        setForm(makeInitialState());
        setStep(1);
        setSubmitted(false);
        sessionRef.current = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      }} />
    );
  }

  return (
    <>
      {/* Full-screen freeze + progress overlay. Visible only while files
          are actively uploading. Blocks the form behind it so the user
          can't navigate steps or close the tab mid-upload. */}
      {filesPending && (
        <div
          role="dialog"
          aria-live="polite"
          aria-label="Uploading files"
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(10,10,12,0.75)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 24,
          }}
        >
          <div style={{
            background: "#fff", color: "#1a1a1a",
            borderRadius: 14, padding: "32px 36px",
            width: "min(440px, 100%)",
            boxShadow: "0 24px 64px rgba(0,0,0,0.45)",
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700, textTransform: "uppercase",
              letterSpacing: "0.16em", color: "#a0a0ad", marginBottom: 12,
            }}>
              Uploading {uploadStats.activeCount} {uploadStats.activeCount === 1 ? "file" : "files"}
            </div>
            <div style={{
              fontSize: 36, fontWeight: 900, letterSpacing: "-0.02em",
              lineHeight: 1, marginBottom: 18, color: "#1a1a1a",
            }}>
              {uploadStats.pct}%
            </div>
            <div style={{
              height: 6, borderRadius: 3, background: "#e6e6ea", overflow: "hidden",
            }}>
              <div style={{
                height: "100%", width: `${uploadStats.pct}%`,
                background: "rgb(115, 182, 201)",
                transition: "width 0.2s ease",
              }} />
            </div>
            <div style={{
              fontSize: 12, color: "#6b6b78", marginTop: 14, lineHeight: 1.55,
            }}>
              Hold tight while your files transfer. Don&apos;t close this tab.
            </div>
          </div>
        </div>
      )}

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
                onReplaceSizes={replaceItemSizes}
                onRemove={removeItem}
              />
            )}

            {step === 5 && (
              <Step5 form={form} update={update} />
            )}

            {step === 6 && (
              <Step6 form={form} />
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
    3: { eyebrow: "Step 3 of 6", title: "Upload your files",         sub: "Artwork, logos, mockups, inspiration, tech packs. Anything that helps us understand your vision. Optional." },
    4: { eyebrow: "Step 4 of 6", title: "Products &amp; quantities",       sub: "If you know your size breakdown, enter it here. Skip if not." },
    5: { eyebrow: "Step 5 of 6", title: "Your details",              sub: "Where should we send your quote?" },
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
          placeholder="e.g. Fall 2026 Pre-Order"
          style={inputStyle}
          autoFocus
        />
      </Field>
      <Field label="Description">
        <textarea
          value={form.description}
          onChange={e => update("description", e.target.value)}
          placeholder="Example: A spring capsule of heavyweight tees and hoodies, washed look, premium feel. Need them by April."
          rows={4}
          style={{ ...inputStyle, resize: "vertical", minHeight: 96 }}
        />
      </Field>
      <div className="hpd-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="How many products?">
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
        <Field label="Needed by">
          <input
            type="date"
            min={getMinNeededByDate()}
            value={form.target_ship_date}
            onChange={e => update("target_ship_date", e.target.value)}
            onClick={e => {
              // Open the native picker when the user clicks anywhere in
              // the field, not just on the calendar icon. showPicker is
              // available in all evergreen browsers since 2023; on older
              // engines this is a no-op and the icon still works.
              const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void };
              if (typeof el.showPicker === "function") el.showPicker();
            }}
            style={{
              ...inputStyle,
              // Force native date inputs to match the sibling text/select
              // height. WebKit reserves vertical space for the picker
              // indicator otherwise, making the box ~2-4px taller.
              height: 46,
              appearance: "none",
              WebkitAppearance: "none",
            }}
          />
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
  items, onAdd, onUpdate, onReplaceSizes, onRemove,
}: {
  items: ItemRow[];
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<ItemRow>) => void;
  onReplaceSizes: (itemId: string, sizes: SizeCell[]) => void;
  onRemove: (id: string) => void;
}) {
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const editingItem = items.find(it => it.id === editingItemId) || null;

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
          {items.map((it, idx) => {
            const filled = it.sizes.filter(c => c.label.trim() && parseInt(c.qty) > 0);
            const total = filled.reduce((s, c) => s + (parseInt(c.qty) || 0), 0);
            return (
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
                {/* Size summary + edit button */}
                <button
                  type="button"
                  onClick={() => setEditingItemId(it.id)}
                  style={{
                    width: "100%",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    gap: 12,
                    padding: "10px 14px",
                    background: "#fff",
                    border: "1px solid #e0e0e4",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textAlign: "left",
                  }}
                >
                  <span style={{ fontSize: 13, color: filled.length ? "#1a1a1a" : "#a0a0ad" }}>
                    {filled.length === 0
                      ? "Set sizes & quantities"
                      : `${filled.map(c => `${c.label}(${c.qty})`).join("  ")}`}
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: "#6b6b78",
                    textTransform: "uppercase", letterSpacing: "0.1em",
                    whiteSpace: "nowrap",
                  }}>
                    {filled.length === 0 ? "Edit →" : `${total} total · Edit →`}
                  </span>
                </button>
              </div>
            );
          })}
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

      {editingItem && (
        <SizeModal
          item={editingItem}
          onSave={(sizes) => {
            onReplaceSizes(editingItem.id, sizes);
            setEditingItemId(null);
          }}
          onCancel={() => setEditingItemId(null)}
        />
      )}
    </div>
  );
}

// Preset sizes grouped for the modal. Custom labels still supported via
// a freeform input at the bottom so anything outside this list (jeans
// waist sizes, etc) is still in reach.
const SIZE_PRESETS: { label: string; sizes: string[] }[] = [
  { label: "Adult", sizes: ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"] },
  { label: "Youth", sizes: ["YXS", "YS", "YM", "YL", "YXL"] },
  { label: "One size", sizes: ["OSFA", "OS"] },
];

function SizeModal({
  item, onSave, onCancel,
}: {
  item: ItemRow;
  onSave: (sizes: SizeCell[]) => void;
  onCancel: () => void;
}) {
  // Local draft so Cancel discards changes.
  const [draft, setDraft] = useState<SizeCell[]>(() =>
    item.sizes.map(c => ({ ...c }))
  );
  const [totalInput, setTotalInput] = useState("");
  const [customInput, setCustomInput] = useState("");

  // Fast lookup of active labels (case-insensitive) → cell.
  const activeByLabel = useMemo(() => {
    const m = new Map<string, SizeCell>();
    draft.forEach(c => {
      const key = c.label.trim().toUpperCase();
      if (key) m.set(key, c);
    });
    return m;
  }, [draft]);

  function togglePreset(label: string) {
    const key = label.toUpperCase();
    if (activeByLabel.has(key)) {
      setDraft(d => d.filter(c => c.label.trim().toUpperCase() !== key));
    } else {
      setDraft(d => [...d, {
        id: `sz-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        label,
        qty: "",
      }]);
    }
  }
  function updateCellQty(cellId: string, qty: string) {
    setDraft(d => d.map(c => c.id === cellId ? { ...c, qty } : c));
  }
  function addCustom() {
    const label = customInput.trim();
    if (!label) return;
    if (activeByLabel.has(label.toUpperCase())) {
      setCustomInput("");
      return;
    }
    setDraft(d => [...d, {
      id: `sz-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      label,
      qty: "",
    }]);
    setCustomInput("");
  }
  function removeCell(cellId: string) {
    setDraft(d => d.filter(c => c.id !== cellId));
  }

  // Distribute Total: spread evenly across active cells, remainder rolls
  // to the middle index so the curve looks natural (most apparel sells
  // heaviest in M/L).
  function distributeTotal() {
    const t = parseInt(totalInput);
    if (!t || draft.length === 0) return;
    const per = Math.floor(t / draft.length);
    const rem = t - per * draft.length;
    const mid = Math.floor(draft.length / 2);
    setDraft(d => d.map((c, i) => ({
      ...c,
      qty: String(per + (i === mid ? rem : 0)),
    })));
  }

  const total = draft.reduce((s, c) => s + (parseInt(c.qty) || 0), 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sizes and quantities"
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(10,10,12,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#fff", color: "#1a1a1a",
          borderRadius: 14,
          width: "min(720px, 100%)",
          maxHeight: "92vh", overflowY: "auto",
          boxShadow: "0 24px 64px rgba(0,0,0,0.4)",
        }}
      >
        <div style={{ padding: "28px 32px 24px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.16em", color: "#a0a0ad", marginBottom: 6 }}>
            {item.name || "Item"}
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 24 }}>
            Sizes &amp; quantities
          </h2>

          {/* SIZES */}
          <div style={modalSection}>
            <div style={modalLabel}>Sizes</div>
            {SIZE_PRESETS.map(group => (
              <div key={group.label} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {group.sizes.map(s => {
                    const active = activeByLabel.has(s.toUpperCase());
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => togglePreset(s)}
                        style={{
                          padding: "10px 18px",
                          minWidth: 64,
                          background: active ? "#1a1a1a" : "#fff",
                          color: active ? "#fff" : "#1a1a1a",
                          border: active ? "1px solid #1a1a1a" : "1px solid #d8d8de",
                          borderRadius: 10,
                          fontSize: 13, fontWeight: 700,
                          letterSpacing: "0.04em",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          transition: "all 0.12s",
                        }}
                      >{s}</button>
                    );
                  })}
                </div>
              </div>
            ))}
            {/* Any custom (non-preset) cells appear here so they don't get lost */}
            {draft.filter(c => {
              const upper = c.label.trim().toUpperCase();
              return upper && !SIZE_PRESETS.some(g => g.sizes.some(s => s.toUpperCase() === upper));
            }).length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "#a0a0ad", marginBottom: 6 }}>Custom</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {draft.filter(c => {
                    const upper = c.label.trim().toUpperCase();
                    return upper && !SIZE_PRESETS.some(g => g.sizes.some(s => s.toUpperCase() === upper));
                  }).map(c => (
                    <div key={c.id} style={{
                      padding: "8px 12px 8px 16px",
                      background: "#1a1a1a", color: "#fff",
                      borderRadius: 10,
                      fontSize: 13, fontWeight: 700,
                      letterSpacing: "0.04em",
                      display: "flex", alignItems: "center", gap: 8,
                    }}>
                      {c.label}
                      <button
                        type="button"
                        onClick={() => removeCell(c.id)}
                        aria-label={`Remove ${c.label}`}
                        style={{
                          background: "transparent", border: "none", color: "rgba(255,255,255,0.7)",
                          cursor: "pointer", padding: 0, fontSize: 14, lineHeight: 1,
                        }}
                      >×</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input
                type="text"
                value={customInput}
                onChange={e => setCustomInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }}
                placeholder="Add custom size (e.g. Tall L, W32)"
                style={{ ...inputStyle, padding: "10px 14px", fontSize: 13, flex: 1, background: "#f8f8f9" }}
              />
              <button type="button" onClick={addCustom} style={{ ...btnSecondary, padding: "10px 18px", fontSize: 13 }}>Add</button>
            </div>
          </div>

          {/* QUANTITIES */}
          <div style={modalSection}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={modalLabel}>Quantities</div>
              <div style={{ fontSize: 13, color: "#6b6b78" }}>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "#a0a0ad", marginRight: 8 }}>Total</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: "#1a1a1a" }}>{total}</span>
              </div>
            </div>
            {draft.length === 0 ? (
              <div style={{ fontSize: 13, color: "#a0a0ad" }}>Pick at least one size above.</div>
            ) : (
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
                gap: 10,
              }}>
                {draft.map(cell => (
                  <div key={cell.id}>
                    <div style={{
                      fontSize: 10, fontWeight: 700,
                      textTransform: "uppercase", letterSpacing: "0.08em",
                      color: "#6b6b78", textAlign: "center", marginBottom: 4,
                    }}>{cell.label}</div>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={cell.qty}
                      onChange={e => updateCellQty(cell.id, e.target.value.replace(/[^0-9]/g, ""))}
                      placeholder="0"
                      style={{
                        width: "100%", padding: "10px 6px",
                        textAlign: "center",
                        border: "1px solid #e0e0e4",
                        borderRadius: 8,
                        fontSize: 14, fontWeight: 600,
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
            )}
          </div>

          {/* DISTRIBUTE TOTAL */}
          {draft.length > 0 && (
            <div style={modalSection}>
              <div style={modalLabel}>Distribute total</div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  type="text"
                  inputMode="numeric"
                  value={totalInput}
                  onChange={e => setTotalInput(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="Total qty"
                  style={{ ...inputStyle, padding: "10px 14px", fontSize: 13, width: 160, background: "#f8f8f9" }}
                />
                <button type="button" onClick={distributeTotal} style={{ ...btnPrimary, padding: "10px 22px", fontSize: 13 }}>Fill</button>
                <span style={{ fontSize: 12, color: "#6b6b78" }}>Spreads total evenly across active sizes.</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          borderTop: "1px solid #e0e0e4",
          padding: "16px 24px",
          display: "flex", justifyContent: "flex-end", gap: 10,
        }}>
          <button type="button" onClick={onCancel} style={{ ...btnSecondary, padding: "12px 22px" }}>Cancel</button>
          <button type="button" onClick={() => onSave(draft)} style={{ ...btnPrimary, padding: "12px 28px" }}>Save</button>
        </div>
      </div>
    </div>
  );
}

const modalSection: React.CSSProperties = {
  marginBottom: 24,
};
const modalLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 700,
  textTransform: "uppercase", letterSpacing: "0.14em",
  color: "#a0a0ad", marginBottom: 12,
};

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
          <input type="text" value={form.contactName} onChange={e => update("contactName", e.target.value)} style={inputStyle} autoFocus />
        </Field>
        <Field label="Company *">
          <input type="text" value={form.company} onChange={e => update("company", e.target.value)} style={inputStyle} />
        </Field>
      </div>
      <div className="hpd-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Email *">
          <input type="email" value={form.email} onChange={e => update("email", e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Phone">
          <input type="tel" value={form.phone} onChange={e => update("phone", e.target.value)} style={inputStyle} />
        </Field>
      </div>

      <div style={{ marginTop: 8 }}>
        <Field label="Where should the finished product go?">
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

function Step6({ form }: { form: FormState }) {
  const projectType = PROJECT_TYPES.find(t => t.value === form.project_type)?.title;
  const shippingRoute = SHIPPING_ROUTES.find(r => r.value === form.shipping_route)?.title;
  const itemsWithContent = form.items.filter(it =>
    it.name.trim() || it.sizes.some(c => parseInt(c.qty) > 0)
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
            {form.items_count_range && <div>Products: {form.items_count_range}</div>}
            {form.units_range && <div>Units: {form.units_range}</div>}
            {form.target_ship_date && <div>Needed by: {form.target_ship_date}</div>}
            {form.budget_range && <div>Budget: {form.budget_range}</div>}
          </div>
        </div>
      )}
      {shippingRoute && <Summary label="Shipping" value={shippingRoute} />}
      {itemsWithContent.length > 0 && (
        <div style={summaryBlock}>
          <div style={summaryLabel}>Products &amp; quantities</div>
          <div style={{ fontSize: 13, color: "#1a1a1a", lineHeight: 1.7 }}>
            {itemsWithContent.map(it => {
              const sizeStr = it.sizes
                .map(c => [c.label.trim(), parseInt(c.qty)] as [string, number])
                .filter(([label, n]) => label && !isNaN(n) && n > 0)
                .map(([label, n]) => `${label}(${n})`)
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
