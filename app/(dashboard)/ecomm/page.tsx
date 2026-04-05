"use client";
import { T, font } from "@/lib/theme";

export default function EcommPage() {
  return (
    <div style={{ fontFamily: font, color: T.text }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 8px" }}>E-Commerce</h1>
      <p style={{ fontSize: 13, color: T.muted, marginBottom: 24 }}>Client-facing storefront management</p>

      <div style={{
        background: T.card, border: `1px solid ${T.border}`, borderRadius: 10,
        padding: "3rem", textAlign: "center",
      }}>
        <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>🛒</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 4 }}>Coming Soon</div>
        <div style={{ fontSize: 12, color: T.faint }}>Storefront management, webstore orders, and e-commerce integrations</div>
      </div>
    </div>
  );
}
