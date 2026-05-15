"use client";
import React, { useRef, useState } from "react";
import { T, font } from "@/lib/theme";

type Status = "draft" | "active" | "all";
type Step = "upload" | "locations" | "generating";

type LocationsPreview = {
  allLocations: string[];
  podLocations: string[];
  physicalLocations: string[];
};

const TITLE = "Inventory Valuation — Multi-Location";
const SUBTITLE =
  "Calculate total retail value of inventory on hand from Shopify exports. Multi-location stores require both Products and Inventory exports; single-location stores need only the Products export.";

export default function DropValuationMultiTool() {
  const [step, setStep] = useState<Step>("upload");
  const [productsFile, setProductsFile] = useState<File | null>(null);
  const [inventoryFile, setInventoryFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("draft");
  const [preview, setPreview] = useState<LocationsPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const productsRef = useRef<HTMLInputElement>(null);
  const inventoryRef = useRef<HTMLInputElement>(null);

  function pickProducts(f: File | null | undefined) {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) {
      setError("Products file must be a .csv");
      return;
    }
    setError(null);
    setProductsFile(f);
  }

  function pickInventory(f: File | null | undefined) {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) {
      setError("Inventory file must be a .csv");
      return;
    }
    setError(null);
    setInventoryFile(f);
  }

  async function onContinue() {
    if (!productsFile) {
      setError("Products CSV is required");
      return;
    }
    setError(null);
    if (!inventoryFile) {
      await generate([]);
      return;
    }
    setStep("generating");
    try {
      const fd = new FormData();
      fd.append("inventoryFile", inventoryFile);
      const res = await fetch("/api/tools/drop-valuation-multi/preview", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Preview failed (${res.status})`);
      }
      const data: LocationsPreview = await res.json();
      setPreview(data);
      setSelected(new Set(data.physicalLocations));
      setStep("locations");
    } catch (e: any) {
      setError(e.message || "Failed to read inventory locations");
      setStep("upload");
    }
  }

  async function generate(includedLocations: string[]) {
    if (!productsFile) return;
    setStep("generating");
    setError(null);
    try {
      const fd = new FormData();
      fd.append("productsFile", productsFile);
      if (inventoryFile) fd.append("inventoryFile", inventoryFile);
      const params = new URLSearchParams({ status });
      if (includedLocations.length) params.set("locations", includedLocations.join(","));
      const res = await fetch(`/api/tools/drop-valuation-multi?${params.toString()}`, {
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
      const filename = m?.[1] || "Drop-Valuation.pdf";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      reset();
    } catch (e: any) {
      setError(e.message || "Failed to generate");
      setStep(preview ? "locations" : "upload");
    }
  }

  function reset() {
    setStep("upload");
    setProductsFile(null);
    setInventoryFile(null);
    setPreview(null);
    setSelected(new Set());
    setError(null);
    if (productsRef.current) productsRef.current.value = "";
    if (inventoryRef.current) inventoryRef.current.value = "";
  }

  function toggleLocation(loc: string) {
    const next = new Set(selected);
    if (next.has(loc)) next.delete(loc);
    else next.add(loc);
    setSelected(next);
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
        name="dvm-status"
        value={val}
        checked={status === val}
        onChange={() => setStatus(val)}
        style={{ accentColor: T.accent }}
      />
      {label}
    </label>
  );

  const fileTile = (
    file: File | null,
    label: string,
    helper: string,
    inputRef: React.RefObject<HTMLInputElement>,
    onPick: (f: File | null | undefined) => void,
    required: boolean
  ) => (
    <div style={{ flex: 1, minWidth: 0 }}>
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
        {label} {required && <span style={{ color: T.red }}>*</span>}
      </div>
      {file ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 10px",
            background: T.card,
            borderRadius: 6,
            border: `1px solid ${T.border}`,
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: T.text,
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {file.name}
          </span>
          <button
            onClick={() => onPick(null as any)}
            style={{
              background: "none",
              border: "none",
              color: T.muted,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            ×
          </button>
        </div>
      ) : (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onPick(e.dataTransfer.files?.[0]);
          }}
          style={{
            border: `2px dashed ${T.border}`,
            borderRadius: 6,
            padding: "16px 10px",
            textAlign: "center",
            cursor: "pointer",
          }}
        >
          <div style={{ fontSize: 11, color: T.muted, marginBottom: 4 }}>
            Drop or click — .csv
          </div>
          <div style={{ fontSize: 10, color: T.faint }}>{helper}</div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              onPick(e.target.files?.[0]);
              e.target.value = "";
            }}
            style={{ display: "none" }}
          />
        </div>
      )}
    </div>
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
        {TITLE}
      </div>
      <div style={{ fontSize: 12, color: T.faint, marginBottom: 14 }}>{SUBTITLE}</div>

      {step === "upload" && (
        <div
          style={{
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            padding: 14,
            background: T.surface,
          }}
        >
          <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
            {fileTile(
              productsFile,
              "Products CSV",
              "Shopify Products export",
              productsRef,
              pickProducts,
              true
            )}
            {fileTile(
              inventoryFile,
              "Inventory CSV",
              "Required if multi-location · Products → Inventory → Export",
              inventoryRef,
              pickInventory,
              false
            )}
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

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onContinue}
              disabled={!productsFile}
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                border: "none",
                background: productsFile ? T.accent : T.surface,
                color: productsFile ? "#fff" : T.faint,
                fontSize: 12,
                fontWeight: 600,
                cursor: productsFile ? "pointer" : "default",
                fontFamily: font,
              }}
            >
              Continue
            </button>
            {(productsFile || inventoryFile) && (
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
                Reset
              </button>
            )}
          </div>
        </div>
      )}

      {step === "locations" && preview && (
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
              fontSize: 10,
              fontWeight: 700,
              color: T.muted,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 6,
            }}
          >
            Locations to Include
          </div>
          <div style={{ fontSize: 11, color: T.faint, marginBottom: 10 }}>
            POD locations are unchecked by default — they represent virtual inventory.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
            {preview.allLocations.map((loc) => {
              const isPod = preview.podLocations.includes(loc);
              const checked = selected.has(loc);
              return (
                <label
                  key={loc}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: `1px solid ${checked ? T.accent : T.border}`,
                    background: checked ? T.accentDim : T.card,
                    cursor: "pointer",
                    fontSize: 12,
                    color: T.text,
                    fontFamily: font,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleLocation(loc)}
                    style={{ accentColor: T.accent }}
                  />
                  <span style={{ flex: 1 }}>{loc}</span>
                  {isPod && (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: T.muted,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: T.surface,
                        border: `1px solid ${T.border}`,
                      }}
                    >
                      POD
                    </span>
                  )}
                </label>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => generate(Array.from(selected))}
              disabled={selected.size === 0}
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                border: "none",
                background: selected.size > 0 ? T.accent : T.surface,
                color: selected.size > 0 ? "#fff" : T.faint,
                fontSize: 12,
                fontWeight: 600,
                cursor: selected.size > 0 ? "pointer" : "default",
                fontFamily: font,
              }}
            >
              Generate Report
            </button>
            <button
              onClick={() => setStep("upload")}
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
              Back
            </button>
          </div>
        </div>
      )}

      {step === "generating" && (
        <div style={{ textAlign: "center", padding: 24 }}>
          <div style={{ fontSize: 13, color: T.accent, fontWeight: 600, marginBottom: 4 }}>
            Generating…
          </div>
          <div style={{ fontSize: 11, color: T.muted }}>
            {productsFile?.name}
            {inventoryFile && ` + ${inventoryFile.name}`}
          </div>
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
