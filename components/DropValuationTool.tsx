"use client";
import React from "react";
import CsvPdfTool from "./CsvPdfTool";

export default function DropValuationTool() {
  return (
    <CsvPdfTool
      title="Inventory Valuation"
      subtitle="Upload a Shopify product CSV export to calculate total retail value of inventory on hand."
      endpoint="/api/tools/drop-valuation"
      defaultStatus="draft"
    />
  );
}
