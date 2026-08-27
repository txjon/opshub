import { NextRequest, NextResponse } from "next/server";
import { getAccessToken } from "@/lib/drive-auth";

// URL: /api/files/view/My-Proof-File.pdf?id=driveFileId[&download=1]
// The filename is in the URL path so browsers use it for Save As.
// download=1 flips the disposition to attachment — a one-click direct save
// (lands wherever the browser's download location points).
export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  const fileId = req.nextUrl.searchParams.get("id");
  if (!fileId) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const fileName = decodeURIComponent(params.path.join("/")) || "file";

  try {
    const token = await getAccessToken();
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!res.ok || !res.body) return new NextResponse("Not found", { status: 404 });

    // Stream — buffering capped downloads at Vercel's 4.5MB response limit
    // (print PSDs are 50MB+; the Aug 26 designer-page 500).
    const contentType = res.headers.get("content-type") || "application/octet-stream";
    const asciiName = fileName.replace(/[^\x20-\x7E]/g, "_");
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Disposition": `${req.nextUrl.searchParams.get("download") ? "attachment" : "inline"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    };
    const len = res.headers.get("content-length"); if (len) headers["Content-Length"] = len;
    return new Response(res.body, { headers });
  } catch {
    return new NextResponse("Failed", { status: 500 });
  }
}
