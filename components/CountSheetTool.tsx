"use client";
import React from "react";
import CsvPdfTool from "./CsvPdfTool";

export default function CountSheetTool() {
  return (
    <CsvPdfTool
      title="Inventory Count Sheet"
      subtitle="Upload a Shopify product CSV export to generate a printable warehouse count sheet."
      endpoint="/api/tools/count-sheet"
      defaultStatus="draft"
    />
  );
}
