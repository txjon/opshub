"use client";
import React from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { T, font } from "@/lib/theme";
import CountSheetTool from "@/components/CountSheetTool";
import DropValuationTool from "@/components/DropValuationTool";
import DropValuationMultiTool from "@/components/DropValuationMultiTool";

export default function ShopifyIntegrationPage() {
  return (
    <div style={{ fontFamily: font, color: T.text, maxWidth: 900, margin: "0 auto" }}>
      <Link
        href="/integrations"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 12,
          color: T.muted,
          textDecoration: "none",
          marginBottom: 10,
        }}
      >
        <ChevronLeft size={14} />
        Integrations
      </Link>

      <h1
        style={{
          fontSize: 22,
          fontWeight: 700,
          marginBottom: 4,
          letterSpacing: "-0.02em",
        }}
      >
        Shopify
      </h1>
      <p style={{ fontSize: 12, color: T.faint, marginBottom: 8 }}>
        Generate inventory reports and warehouse documents from Shopify CSV exports.
      </p>
      <p style={{ fontSize: 11, color: T.faint, marginBottom: 20 }}>
        Status: CSV upload only — no live API connection yet. Exports come from your Shopify
        admin → Products → Export (and Products → Inventory → Export for multi-location stores).
      </p>

      <CountSheetTool />
      <DropValuationTool />
      <DropValuationMultiTool />
    </div>
  );
}
