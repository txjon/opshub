"use client";
import { useEffect, useRef, useState } from "react";

// Cross-browser PDF preview that renders each page to a canvas via
// pdf.js. Replaces native <iframe src=pdf> embeds which iOS Safari (and
// iOS Chrome, which wraps WebKit) render at actual-size with no fit-
// width hint support — meaning content bleeds past the viewport on
// mobile. Canvas render scales naturally to the container width.

type Props = {
  /** Blob URL, data URL, or http(s) URL pointing at a PDF */
  src: string;
  /** Optional gap between pages on multi-page PDFs */
  pageGap?: number;
};

export function PdfCanvasPreview({ src, pageGap = 16 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        // Legacy build is transpiled to ES2020-compatible code that
        // iOS Safari/Chrome can actually run — the default modern
        // build uses Map.prototype.getOrInsertComputed which Safari
        // doesn't ship yet (TC39 stage 4 in 2024, browser landing
        // staggered through 2025).
        const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
          pdfjsLib.GlobalWorkerOptions.workerSrc =
            `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.min.mjs`;
        }

        const loadingTask = pdfjsLib.getDocument(src);
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        setPageCount(pdf.numPages);

        const container = containerRef.current;
        if (!container) return;
        // Wipe any prior canvases (when src changes)
        container.innerHTML = "";

        const containerWidth = container.clientWidth || 600;
        // High-DPI render so the canvas stays crisp when scaled to the
        // container's visual width.
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          if (cancelled) break;
          const page = await pdf.getPage(pageNum);
          const baseViewport = page.getViewport({ scale: 1 });
          const scale = (containerWidth / baseViewport.width) * dpr;
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          canvas.style.display = "block";
          canvas.style.background = "#fff";
          canvas.style.boxShadow = "0 1px 3px rgba(0,0,0,0.08)";
          if (pageNum > 1) canvas.style.marginTop = `${pageGap}px`;
          container.appendChild(canvas);

          const ctx = canvas.getContext("2d");
          await page.render({ canvasContext: ctx!, viewport }).promise;
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to render PDF");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src, pageGap]);

  return (
    <div style={{ width: "100%", height: "100%", overflowY: "auto", padding: "12px 0", boxSizing: "border-box" }}>
      {error && (
        <div style={{ fontSize: 12, color: "#a33", padding: "10px 14px" }}>{error}</div>
      )}
      <div ref={containerRef} style={{ display: "flex", flexDirection: "column", alignItems: "stretch", padding: "0 12px" }} />
      {pageCount === 0 && !error && (
        <div style={{ fontSize: 11, color: "#999", textAlign: "center", padding: 20 }}>Loading preview…</div>
      )}
    </div>
  );
}
