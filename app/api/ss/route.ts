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
  const styleId = searchParams.get("styleId") || "";
  const brand = searchParams.get("brand") || "";
  const category = searchParams.get("category") || "";

  if (!endpoint) return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });

  const headers = {
    "Authorization": getAuthHeader(),
    "Content-Type": "application/json",
  };

  try {
    let url = "";

    if (endpoint === "search") {
      const params = new URLSearchParams();
      if (query) params.set("term", query);
      if (brand) params.set("brand", brand);
      if (category) params.set("category", category);
      url = `${SS_BASE}/styles?${params.toString()}`;
    } else if (endpoint === "style") {
      url = `${SS_BASE}/styles/${styleId}`;
    } else if (endpoint === "products") {
      url = `${SS_BASE}/products?styleId=${styleId}`;
    } else if (endpoint === "brands") {
      url = `${SS_BASE}/brands`;
    } else if (endpoint === "categories") {
      url = `${SS_BASE}/categories`;
    } else {
      return NextResponse.json({ error: "Unknown endpoint" }, { status: 400 });
    }

    const res = await fetch(url, { headers, next: { revalidate: 300 } });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `S&S API error: ${res.status}`, detail: text }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: "Failed to fetch from S&S", detail: String(err) }, { status: 500 });
  }
}
