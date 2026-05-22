"use client";
import React, { useRef, useState } from "react";
import { T, font } from "@/lib/theme";

type Status = "draft" | "active" | "all";

type SortOption = { value: string; label: string };

type Props = {
  /** Card section label, e.g. "Inventory Count Sheet" */
  title: string;
  /** One-line subtitle under the title */
  subtitle: string;
  /** API endpoint that accepts POST multipart `file` and returns a PDF.
   *  Status will be appended as ?status=... */
  endpoint: string;
  /** Default status filter (matches Shopify status values). */
  defaultStatus?: Status;
  /** Optional sort menu — when provided, a Sort selector renders and
   *  the chosen value is sent as ?sort=... to the endpoint. */
  sortOptions?: SortOption[];
  /** Default sort value (must match one of sortOptions[].value). */
  defaultSort?: string;
  /** Optional format menu — when provided, a Format selector renders
   *  and the chosen value is sent as ?format=... to the endpoint. */
  formatOptions?: SortOption[];
  /** Default format value (must match one of formatOptions[].value). */
  defaultFormat?: string;
};

export default function CsvPdfTool({ title, subtitle, endpoint, defaultStatus = "draft", sortOptions, defaultSort, formatOptions, defaultFormat }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>(defaultStatus);
  const [sort, setSort] = useState<string>(defaultSort || sortOptions?.[0]?.value || "");
  const [format, setFormat] = useState<string>(defaultFormat || formatOptions?.[0]?.value || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragover, setDragover] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function pickFile(f: File | null | undefined) {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) {
      setError("Only .csv files are supported.");
      return;
    }
    setError(null);
    setFile(f);
  }

  async function generate() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const params = new URLSearchParams({ status });
      if (sort) params.set("sort", sort);
      if (format) params.set("format", format);
      const sep = endpoint.includes("?") ? "&" : "?";
      const res = await fetch(`${endpoint}${sep}${params.toString()}`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Request failed (${res.status})`);
      }
      const blob = await res.blob();
      const disp = res.headers.get("Content-Disposition") || "";
      const m = disp.match(/filename="([^"]+)"/);
      const filename = m?.[1] || "Report.pdf";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message || "Failed to generate");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setFile(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const radio = (val: Status, label: string) => (
    <label
      key={val}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 6,
        border: `1px solid ${status === val ? T.accent : T.border}`,
        background: status === val ? T.accentDim : "transparent",
        cursor: "pointer",
        fontSize: 12,
        color: status === val ? T.text : T.muted,
        fontFamily: font,
      }}
    >
      <input
        type="radio"
        name={`${title}-status`}
        value={val}
        checked={status === val}
        onChange={() => setStatus(val)}
        style={{ accentColor: T.accent }}
      />
      {label}
    </label>
  );

  return (
    <div
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        padding: "16px 18px",
        marginTop: 16,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: T.muted,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 12, color: T.faint, marginBottom: 14 }}>{subtitle}</div>

      {!file && !busy && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragover(true);
          }}
          onDragLeave={() => setDragover(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragover(false);
            pickFile(e.dataTransfer.files?.[0]);
          }}
          onClick={() => fileRef.current?.click()}
          style={{
            border: `2px dashed ${dragover ? T.accent : T.border}`,
            borderRadius: 8,
            padding: "26px 16px",
            textAlign: "center",
            cursor: "pointer",
            background: dragover ? T.accentDim : "transparent",
            transition: "all 0.15s",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: T.accent, marginBottom: 4 }}>
            Upload Shopify CSV
          </div>
          <div style={{ fontSize: 11, color: T.muted }}>
            Drop a .csv here or click to choose
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              pickFile(e.target.files?.[0]);
              e.target.value = "";
            }}
            style={{ display: "none" }}
          />
        </div>
      )}

      {file && !busy && (
        <div
          style={{
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            padding: 14,
            background: T.surface,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: T.muted,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                File
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: T.text,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {file.name}
              </div>
            </div>
            <button
              onClick={reset}
              style={{
                background: "none",
                border: "none",
                color: T.muted,
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              ×
            </button>
          </div>

          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: T.muted,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 6,
            }}
          >
            Status Filter
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            {radio("draft", "Drafts Only")}
            {radio("active", "Active Only")}
            {radio("all", "All Products")}
          </div>

          {formatOptions && formatOptions.length > 0 && (
            <>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: T.muted,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 6,
                }}
              >
                Format
              </div>
              <div style={{ marginBottom: 12 }}>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    borderRadius: 6,
                    border: `1px solid ${T.border}`,
                    background: T.card,
                    color: T.text,
                    fontSize: 12,
                    fontFamily: font,
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  {formatOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {sortOptions && sortOptions.length > 0 && (
            <>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: T.muted,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 6,
                }}
              >
                Sort By
              </div>
              <div style={{ marginBottom: 12 }}>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    borderRadius: 6,
                    border: `1px solid ${T.border}`,
                    background: T.card,
                    color: T.text,
                    fontSize: 12,
                    fontFamily: font,
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  {sortOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={generate}
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                border: "none",
                background: T.accent,
                color: "#fff",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: font,
              }}
            >
              Generate PDF
            </button>
            <button
              onClick={reset}
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                border: `1px solid ${T.border}`,
                background: "transparent",
                color: T.muted,
                fontSize: 12,
                cursor: "pointer",
                fontFamily: font,
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {busy && (
        <div style={{ textAlign: "center", padding: 24 }}>
          <div style={{ fontSize: 13, color: T.accent, fontWeight: 600, marginBottom: 4 }}>
            Generating…
          </div>
          <div style={{ fontSize: 11, color: T.muted }}>{file?.name}</div>
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: 10,
            padding: "8px 12px",
            background: T.redDim,
            borderRadius: 6,
            fontSize: 12,
            color: T.red,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
