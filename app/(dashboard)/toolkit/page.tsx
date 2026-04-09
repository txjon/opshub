"use client";
import React, { useState, useRef, useEffect } from "react";
import { T, font, mono } from "@/lib/theme";
import { buildMockupClient, preloadTemplate } from "@/lib/mockup-client";
import { generateProofPdfClient, preloadLogo } from "@/lib/proof-client";

export default function ToolKitPage() {
  useEffect(() => { preloadLogo(); preloadTemplate(); }, []);

  return (
    <div style={{ fontFamily: font, color: T.text, maxWidth: 800, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4, letterSpacing: "-0.02em" }}>Tool Kit</h1>
      <p style={{ fontSize: 12, color: T.faint, marginBottom: 20 }}>Standalone tools for quick tasks</p>

      <MockupTool />
    </div>
  );
}

function MockupTool() {
  const [mockupData, setMockupData] = useState<any>(null);
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragover, setDragover] = useState(false);
  const [fileName, setFileName] = useState("");
  const [downloading, setDownloading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Manual mode state
  const [mode, setMode] = useState<string | null>(null);
  const manualMockupRef = useRef<HTMLInputElement>(null);
  const manualPsdRef = useRef<HTMLInputElement>(null);
  const [manualMockupFile, setManualMockupFile] = useState<File | null>(null);
  const [manualMockupPreview, setManualMockupPreview] = useState<string | null>(null);
  const [manualPsdFile, setManualPsdFile] = useState<File | null>(null);
  const [manualPrintInfo, setManualPrintInfo] = useState<any[] | null>(null);

  // Labels for proof PDF
  const [itemName, setItemName] = useState("");
  const [clientName, setClientName] = useState("");

  async function processFile(file: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".psd")) {
      setError("Only .psd files are supported.");
      return;
    }
    setMode("auto");
    setFileName(file.name);
    setGenerating(true);
    setError(null);
    setMockupData(null);

    try {
      setGenStatus("Reading PSD...");
      const arrayBuffer = await file.arrayBuffer();
      setGenStatus("Building mockup...");
      const result = await buildMockupClient(arrayBuffer);
      setGenStatus("Done");
      setMockupData({ mockup: result.mockupBase64, dataUrl: result.dataUrl, uploadDataUrl: result.uploadDataUrl, printInfo: result.printInfo, psdFile: file });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGenerating(false);
      setGenStatus("");
    }
  }

  function handleManualMockup(file: File) {
    if (!file || !file.type.startsWith("image/")) { setError("Please upload an image file (JPG, PNG)"); return; }
    setManualMockupFile(file);
    const reader = new FileReader();
    reader.onload = (e: any) => setManualMockupPreview(e.target.result);
    reader.readAsDataURL(file);
  }

  async function handleManualPsd(file: File) {
    if (!file || !file.name.toLowerCase().endsWith(".psd")) { setError("Please upload a .psd file"); return; }
    setManualPsdFile(file);
    setError(null);
    try {
      setGenStatus("Reading PSD print data...");
      setGenerating(true);
      const { readPsd } = await import("ag-psd");
      const arrayBuffer = await file.arrayBuffer();
      const psd = readPsd(new Uint8Array(arrayBuffer));
      const PLACEMENT_MAP: Record<string, string> = { 'Front':'Full Front','Full Front':'Full Front','Back':'Full Back','Full Back':'Full Back','Left Chest':'Left Chest' };
      const SKIP_GROUPS = ['Shirt Color', 'Shadows', 'Highlights', 'Mask'];
      const printInfo: any[] = [];
      const groups = [...(psd.children || [])].reverse();
      for (const group of groups) {
        if (!group.children) continue;
        if (SKIP_GROUPS.includes(group.name || "")) continue;
        const zoneName = PLACEMENT_MAP[group.name || ""];
        const isTag = (group.name || "").toLowerCase() === "tag" || (group.name || "").toLowerCase() === "tags";
        const colors: any[] = [];
        let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
        for (const layer of group.children) {
          if (isTag) {
            if (minL === Infinity) { minL = layer.left || 0; minT = layer.top || 0; maxR = layer.right || 0; maxB = layer.bottom || 0; }
          } else {
            minL = Math.min(minL, layer.left || 0); minT = Math.min(minT, layer.top || 0);
            maxR = Math.max(maxR, layer.right || 0); maxB = Math.max(maxB, layer.bottom || 0);
          }
          let hex = "#888888";
          if (layer.canvas) {
            const ctx = layer.canvas.getContext("2d");
            if (ctx) {
              const data = ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height).data;
              let rS = 0, gS = 0, bS = 0, cnt = 0;
              for (let i = 0; i < data.length; i += 40) { if (data[i + 3] > 128) { rS += data[i]; gS += data[i + 1]; bS += data[i + 2]; cnt++; } }
              if (cnt > 0) hex = "#" + [rS, gS, bS].map(v => Math.round(v / cnt).toString(16).padStart(2, "0")).join("");
            }
          }
          colors.push({ name: layer.name, hex });
        }
        const artW = maxR - minL;
        const artH = maxB - minT;
        if (artW <= 0 || artH <= 0) continue;
        printInfo.push({ placement: zoneName || group.name, groupName: group.name, widthInches: (artW / 300).toFixed(2), heightInches: (artH / 300).toFixed(2), colors });
      }
      setManualPrintInfo(printInfo);
    } catch (err: any) {
      setError("Failed to read PSD: " + err.message);
    } finally {
      setGenerating(false);
      setGenStatus("");
    }
  }

  function finalizeManual() {
    if (!manualMockupFile || !manualMockupPreview) return;
    const canvas = document.createElement("canvas");
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      const uploadDataUrl = canvas.toDataURL("image/jpeg", 0.85);
      const pngDataUrl = canvas.toDataURL("image/png");
      const base64 = pngDataUrl.split(",")[1];
      setMockupData({ mockup: base64, dataUrl: pngDataUrl, uploadDataUrl, printInfo: manualPrintInfo || [], psdFile: manualPsdFile });
      setMode("manual");
    };
    img.src = manualMockupPreview;
  }

  function downloadMockup() {
    if (!mockupData) return;
    const a = document.createElement("a");
    a.href = mockupData.dataUrl || mockupData.uploadDataUrl;
    a.download = `${itemName || "Mockup"}.png`;
    a.click();
  }

  function downloadPdf() {
    if (!mockupData) return;
    setDownloading(true);
    try {
      const doc = generateProofPdfClient({
        mockupDataUrl: mockupData.uploadDataUrl,
        printInfo: mockupData.printInfo,
        clientName: clientName || "",
        itemName: itemName || "",
        blankVendor: "",
        blankStyle: "",
        blankColor: "",
      });
      doc.save(`${itemName || "Item"} — Product Proof.pdf`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  }

  function reset() {
    setMockupData(null);
    setError(null);
    setFileName("");
    setMode(null);
    setManualMockupFile(null);
    setManualMockupPreview(null);
    setManualPsdFile(null);
    setManualPrintInfo(null);
  }

  const s = {
    input: { width: "100%", padding: "8px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, outline: "none", fontFamily: font, boxSizing: "border-box" as const },
  };

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "16px 18px" }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 12 }}>Mockup Generator</div>

      {/* Initial state: two options */}
      {!mockupData && !generating && !mode && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: T.muted, marginBottom: 4, display: "block" }}>Item name</label>
              <input value={itemName} onChange={e => setItemName(e.target.value)} style={s.input} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: T.muted, marginBottom: 4, display: "block" }}>Client</label>
              <input value={clientName} onChange={e => setClientName(e.target.value)} style={s.input} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div
              onDragOver={e => { e.preventDefault(); setDragover(true); }}
              onDragLeave={() => setDragover(false)}
              onDrop={e => { e.preventDefault(); setDragover(false); const f = e.dataTransfer.files[0]; if (f) processFile(f); }}
              onClick={() => fileInputRef.current?.click()}
              style={{ flex: 1, border: `2px dashed ${dragover ? T.accent : T.border}`, borderRadius: 8, padding: "24px 16px", textAlign: "center", cursor: "pointer", background: dragover ? T.accentDim : "transparent", transition: "all 0.15s" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.accent, marginBottom: 4 }}>Auto Mockup</div>
              <div style={{ fontSize: 11, color: T.muted }}>Drop a .psd — generates tee mockup + proof</div>
              <input ref={fileInputRef} type="file" accept=".psd" onChange={e => { processFile(e.target.files?.[0]!); e.target.value = ""; }} style={{ display: "none" }} />
            </div>
            <div
              onClick={() => setMode("manual-setup")}
              onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = T.purple; }}
              onDragLeave={e => { e.currentTarget.style.borderColor = T.border; }}
              onDrop={e => {
                e.preventDefault(); e.currentTarget.style.borderColor = T.border;
                const files = Array.from(e.dataTransfer.files);
                const imageFile = files.find(f => f.type.startsWith("image/"));
                const psdFile = files.find(f => f.name.toLowerCase().endsWith(".psd"));
                if (imageFile) handleManualMockup(imageFile);
                if (psdFile) handleManualPsd(psdFile);
                if (imageFile || psdFile) setMode("manual-setup");
              }}
              style={{ flex: 1, border: `2px dashed ${T.border}`, borderRadius: 8, padding: "24px 16px", textAlign: "center", cursor: "pointer", transition: "all 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = T.purple; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.purple, marginBottom: 4 }}>Custom Mockup</div>
              <div style={{ fontSize: 11, color: T.muted }}>Upload a mockup image + optional .psd</div>
            </div>
          </div>
        </>
      )}

      {/* Manual setup */}
      {mode === "manual-setup" && !mockupData && !generating && (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: 14, background: T.surface }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.purple }}>Custom Mockup</div>
            <button onClick={reset} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 14 }}>×</button>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>1. Mockup Image</div>
              {manualMockupPreview ? (
                <div style={{ position: "relative" }}>
                  <img src={manualMockupPreview} style={{ width: "100%", borderRadius: 6, border: `1px solid ${T.border}` }} />
                  <button onClick={() => { setManualMockupFile(null); setManualMockupPreview(null); }}
                    style={{ position: "absolute", top: 4, right: 4, background: T.card, border: `1px solid ${T.border}`, borderRadius: 4, color: T.muted, cursor: "pointer", fontSize: 10, padding: "2px 6px" }}>×</button>
                </div>
              ) : (
                <div onClick={() => manualMockupRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={e => { e.preventDefault(); e.stopPropagation(); const f = Array.from(e.dataTransfer.files).find(f => f.type.startsWith("image/")); if (f) handleManualMockup(f); }}
                  style={{ border: `2px dashed ${T.border}`, borderRadius: 6, padding: "20px 10px", textAlign: "center", cursor: "pointer" }}>
                  <div style={{ fontSize: 11, color: T.muted }}>Drop or click — JPG/PNG</div>
                  <input ref={manualMockupRef} type="file" accept="image/*" onChange={e => { handleManualMockup(e.target.files?.[0]!); e.target.value = ""; }} style={{ display: "none" }} />
                </div>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>2. PSD File (optional)</div>
              {manualPsdFile ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", background: T.card, borderRadius: 6, border: `1px solid ${T.border}` }}>
                  <span style={{ fontSize: 11, color: T.text, flex: 1 }}>{manualPsdFile.name}</span>
                  <button onClick={() => { setManualPsdFile(null); setManualPrintInfo(null); }}
                    style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 10 }}>×</button>
                </div>
              ) : (
                <div onClick={() => manualPsdRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={e => { e.preventDefault(); e.stopPropagation(); const f = Array.from(e.dataTransfer.files).find(f => f.name.toLowerCase().endsWith(".psd")); if (f) handleManualPsd(f); }}
                  style={{ border: `2px dashed ${T.border}`, borderRadius: 6, padding: "20px 10px", textAlign: "center", cursor: "pointer" }}>
                  <div style={{ fontSize: 11, color: T.muted }}>Drop or click — .psd for print data</div>
                  <input ref={manualPsdRef} type="file" accept=".psd" onChange={e => { handleManualPsd(e.target.files?.[0]!); e.target.value = ""; }} style={{ display: "none" }} />
                </div>
              )}
            </div>
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button onClick={finalizeManual} disabled={!manualMockupFile}
              style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: manualMockupFile ? T.purple : T.surface, color: manualMockupFile ? "#fff" : T.faint, fontSize: 12, fontWeight: 600, cursor: manualMockupFile ? "pointer" : "default", fontFamily: font }}>
              Generate
            </button>
            <button onClick={reset}
              style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.muted, fontSize: 12, cursor: "pointer", fontFamily: font }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Generating */}
      {generating && (
        <div style={{ textAlign: "center", padding: 24 }}>
          <div style={{ fontSize: 13, color: T.accent, fontWeight: 600, marginBottom: 4 }}>{genStatus || "Processing..."}</div>
          <div style={{ fontSize: 11, color: T.muted }}>{fileName}</div>
        </div>
      )}

      {/* Result */}
      {mockupData && (
        <div>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            <img src={mockupData.dataUrl || mockupData.uploadDataUrl} style={{ width: 300, borderRadius: 8, border: `1px solid ${T.border}` }} />
            <div style={{ flex: 1 }}>
              {/* Print info */}
              {mockupData.printInfo?.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Print Locations</div>
                  {mockupData.printInfo.map((pi: any, i: number) => (
                    <div key={i} style={{ padding: "6px 8px", background: T.surface, borderRadius: 6, marginBottom: 4 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{pi.placement}</div>
                      <div style={{ fontSize: 10, color: T.muted }}>{pi.widthInches}" × {pi.heightInches}" · {pi.colors?.length || 0} color{(pi.colors?.length || 0) !== 1 ? "s" : ""}</div>
                      {pi.colors?.length > 0 && (
                        <div style={{ display: "flex", gap: 4, marginTop: 3 }}>
                          {pi.colors.map((c: any, j: number) => (
                            <div key={j} style={{ width: 14, height: 14, borderRadius: 3, background: c.hex, border: `1px solid ${T.border}` }} title={c.name} />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={downloadMockup}
                  style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: T.accent, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
                  Download Mockup
                </button>
                <button onClick={downloadPdf} disabled={downloading}
                  style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: T.green, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font, opacity: downloading ? 0.5 : 1 }}>
                  {downloading ? "Generating..." : "Download Proof PDF"}
                </button>
                <button onClick={reset}
                  style={{ padding: "8px 14px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.muted, fontSize: 12, cursor: "pointer", fontFamily: font }}>
                  Start Over
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && <div style={{ marginTop: 10, padding: "8px 12px", background: T.redDim, borderRadius: 6, fontSize: 12, color: T.red }}>{error}</div>}
    </div>
  );
}
