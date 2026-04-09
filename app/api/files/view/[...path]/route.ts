import { NextRequest, NextResponse } from "next/server";
import { getAccessToken } from "@/lib/drive-auth";

// URL: /api/files/view/My-Proof-File.pdf?id=driveFileId
// The filename is in the URL path so browsers use it for Save As
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

    if (!res.ok) return new NextResponse("Not found", { status: 404 });

    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") || "application/octet-stream";

    return new NextResponse(buf, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
      },
    });
  } catch {
    return new NextResponse("Failed", { status: 500 });
  }
}
