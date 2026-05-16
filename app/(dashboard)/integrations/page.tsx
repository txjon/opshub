"use client";
import React from "react";
import Link from "next/link";
import {
  ShoppingBag,
  Truck,
  Receipt,
  HardDrive,
  Shirt,
  CreditCard,
  Mail,
} from "lucide-react";
import { T, font } from "@/lib/theme";

type Status = "live" | "configured" | "csv" | "tenant";

type Service = {
  key: string;
  name: string;
  description: string;
  status: Status;
  Icon: any;
  href?: string;
};

const STATUS_LABEL: Record<Status, { label: string; color: string }> = {
  live: { label: "Live", color: T.green },
  configured: { label: "Configured", color: T.green },
  csv: { label: "CSV upload", color: T.amber },
  tenant: { label: "Tenant only", color: T.purple },
};

const SERVICES: Service[] = [
  {
    key: "shopify",
    name: "Shopify",
    description:
      "Generate inventory valuation reports and printable warehouse count sheets from product + inventory exports.",
    status: "csv",
    Icon: ShoppingBag,
    href: "/integrations/shopify",
  },
  {
    key: "shipstation",
    name: "ShipStation",
    description:
      "Fulfillment reports for postage, sales, and combined invoices. Pushes line items to QuickBooks.",
    status: "configured",
    Icon: Truck,
    href: "/integrations/shipstation",
  },
  {
    key: "quickbooks",
    name: "QuickBooks",
    description:
      "Invoice push, payment webhooks, customer + tax sync. Connected via OAuth 2.0.",
    status: "live",
    Icon: Receipt,
  },
  {
    key: "drive",
    name: "Google Drive",
    description:
      "Art file storage — service account creates per-job folders, manages proof + print-ready files.",
    status: "live",
    Icon: HardDrive,
  },
  {
    key: "ss",
    name: "S&S Activewear",
    description: "Blank garment catalog sync — pulls product, color, and size data on demand.",
    status: "live",
    Icon: Shirt,
  },
  {
    key: "stripe",
    name: "Stripe",
    description: "Client invoice payments for the IHM tenant. Webhook-driven.",
    status: "tenant",
    Icon: CreditCard,
  },
  {
    key: "resend",
    name: "Resend",
    description:
      "Outbound email delivery — quotes, POs, invoices, proof links, packing slips.",
    status: "live",
    Icon: Mail,
  },
];

export default function IntegrationsPage() {
  return (
    <div style={{ fontFamily: font, color: T.text, maxWidth: 1100, margin: "0 auto" }}>
      <h1
        style={{
          fontSize: 22,
          fontWeight: 700,
          marginBottom: 4,
          letterSpacing: "-0.02em",
        }}
      >
        Integrations
      </h1>
      <p style={{ fontSize: 12, color: T.faint, marginBottom: 20 }}>
        External services that feed into or out of OpsHub.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 12,
        }}
      >
        {SERVICES.map((s) => (
          <ServiceCard key={s.key} service={s} />
        ))}
      </div>
    </div>
  );
}

function ServiceCard({ service }: { service: Service }) {
  const { Icon, name, description, status, href } = service;
  const statusInfo = STATUS_LABEL[status];

  const card = (
    <div
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        padding: "16px 18px",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        cursor: href ? "pointer" : "default",
        transition: "border-color 0.15s, transform 0.15s",
      }}
      onMouseEnter={(e) => {
        if (href) {
          e.currentTarget.style.borderColor = T.accent;
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = T.border;
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: T.surface,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: T.text,
          }}
        >
          <Icon size={18} />
        </div>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: statusInfo.color,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            padding: "3px 8px",
            borderRadius: 4,
            border: `1px solid ${statusInfo.color}`,
            background: "transparent",
          }}
        >
          {statusInfo.label}
        </span>
      </div>

      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>
          {name}
        </div>
        <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.5 }}>{description}</div>
      </div>

      <div style={{ marginTop: "auto", paddingTop: 6 }}>
        {href ? (
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: T.accent,
            }}
          >
            Open →
          </span>
        ) : (
          <span style={{ fontSize: 11, color: T.faint, fontStyle: "italic" }}>
            No actions yet
          </span>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} style={{ textDecoration: "none", color: "inherit" }}>
        {card}
      </Link>
    );
  }
  return card;
}
