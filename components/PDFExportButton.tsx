"use client";

import { useState } from "react";

interface PDFExportButtonProps {
  jobId: string;
  type: "quote" | "po";
  vendor?: string; // for PO: pass vendor name to get vendor-specific PO
  label?: string;
  className?: string;
}

export function PDFExportButton({
  jobId,
  type,
  vendor,
  label,
  className = "",
}: PDFExportButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setLoading(true);
    setError(null);

    try {
      const url =
        type === "quote"
          ? `/api/pdf/quote/${jobId}`
          : `/api/pdf/po/${jobId}${vendor ? `?vendor=${encodeURIComponent(vendor)}` : ""}`;

      const res = await fetch(url);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "PDF generation failed");
      }

      // Stream the PDF as a download
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download =
        res.headers.get("Content-Disposition")?.split('filename="')[1]?.replace('"', "") ??
        `${type}-${jobId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch (err: any) {
      setError(err.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        onClick={handleExport}
        disabled={loading}
        className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors
          ${loading
            ? "bg-gray-100 text-gray-400 cursor-not-allowed"
            : "bg-gray-900 text-white hover:bg-gray-700"
          } ${className}`}
      >
        {loading ? (
          <>
            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Generating PDF…
          </>
        ) : (
          <>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
            </svg>
            {label ?? (type === "quote" ? "Export Quote PDF" : "Export PO PDF")}
          </>
        )}
      </button>
      {error && (
        <p className="text-xs text-red-500">{error}</p>
      )}
    </div>
  );
}
