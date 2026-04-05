import { NextRequest, NextResponse } from "next/server";

const SS_BASE = "https://api.ssactivewear.com/v2";

function getAuthHeader() {
  const username = process.env.SS_USERNAME!;
  const password = process.env.SS_PASSWORD!;
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get("endpoint");
  const query = searchParams.get("q") || "";
  const brand = searchParams.get("brand") || "";
  const styleId = searchParams.get("styleId") || "";

  if (!endpoint) return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });

  const headers = {
    "Authorization": getAuthHeader(),
    "Content-Type": "application/json",
  };

  try {
    let url = "";

    if (endpoint === "search") {
      if (query && brand) {
        url = `${SS_BASE}/styles?search=${encodeURIComponent(brand + " " + query)}`;
      } else if (brand) {
        url = `${SS_BASE}/styles?search=${encodeURIComponent(brand)}`;
      } else if (query) {
        url = `${SS_BASE}/styles?search=${encodeURIComponent(query)}`;
      } else {
        url = `${SS_BASE}/styles`;
      }
    } else if (endpoint === "products") {
      url = `${SS_BASE}/products?styleId=${styleId}`;
    } else if (endpoint === "brands") {
      url = `${SS_BASE}/brands`;
    } else if (endpoint === "orders") {
      // Fetch recent orders — optionally filter by PO number
      const po = searchParams.get("po") || "";
      if (po) {
        url = `${SS_BASE}/orders?poNumber=${encodeURIComponent(po)}`;
      } else {
        // Last 90 days of orders
        const since = new Date(Date.now() - 90 * 86400000).toISOString().split("T")[0];
        url = `${SS_BASE}/orders?startDate=${since}`;
      }
    } else if (endpoint === "order") {
      // Single order by order number
      const orderNum = searchParams.get("orderNumber") || "";
      if (!orderNum) return NextResponse.json({ error: "Missing orderNumber" }, { status: 400 });
      url = `${SS_BASE}/orders/${encodeURIComponent(orderNum)}`;
    } else {
      return NextResponse.json({ error: "Unknown endpoint" }, { status: 400 });
    }

    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `S&S API error: ${res.status}`, detail: text }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: "Failed to fetch", detail: String(err) }, { status: 500 });
  }
}