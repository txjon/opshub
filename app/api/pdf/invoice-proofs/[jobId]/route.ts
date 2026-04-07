export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { PDFDocument, rgb } from "pdf-lib";
import { getDriveToken } from "@/lib/drive-token";

export async function GET(req: NextRequest, { params }: { params: { jobId: string } }) {
  const internal = req.headers.get("x-internal-key") === process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!internal) {
    const authClient = await createAuthClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { jobId } = params;
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // 1. Generate invoice PDF by calling our invoice route
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
    const invoiceRes = await fetch(`${baseUrl}/api/pdf/invoice/${jobId}?download=1`, {
      headers: { "x-internal-key": process.env.SUPABASE_SERVICE_ROLE_KEY || "" },
    });
    if (!invoiceRes.ok) {
      return NextResponse.json({ error: "Invoice generation failed" }, { status: 500 });
    }
    const invoiceBuffer = await invoiceRes.arrayBuffer();

    // 2. Get all proof and mockup files for this job's items
    const { data: items } = await supabase
      .from("items")
      .select("id, name")
      .eq("job_id", jobId)
      .order("sort_order");

    const itemIds = (items || []).map(it => it.id);
    const { data: files } = await supabase
      .from("item_files")
      .select("item_id, file_name, mime_type, stage, drive_file_id")
      .in("item_id", itemIds)
      .eq("stage", "proof")
      .order("created_at");

    // 3. Get a Drive access token directly
    let accessToken: string | null = null;
    try { accessToken = await getDriveToken(); } catch (e) { console.error("Drive token error:", e); }

    console.log(`[Combined PDF] ${(files||[]).length} proof/mockup files found, token: ${accessToken ? "yes" : "no"}`);

    // 4. Merge into one PDF
    const mergedPdf = await PDFDocument.create();

    // Add invoice pages
    const invoicePdf = await PDFDocument.load(invoiceBuffer);
    const invoicePages = await mergedPdf.copyPages(invoicePdf, invoicePdf.getPageIndices());
    for (const page of invoicePages) {
      mergedPdf.addPage(page);
    }

    // Add proof/mockup files
    if (accessToken && files && files.length > 0) {
      for (const file of files) {
        try {
          // Download file from Google Drive
          const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.drive_file_id}?alt=media`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!driveRes.ok) continue;
          const fileBuffer = await driveRes.arrayBuffer();

          if (file.mime_type === "application/pdf") {
            // Merge PDF pages
            const proofPdf = await PDFDocument.load(fileBuffer);
            const pages = await mergedPdf.copyPages(proofPdf, proofPdf.getPageIndices());
            for (const page of pages) {
              mergedPdf.addPage(page);
            }
          } else if (file.mime_type?.startsWith("image/")) {
            // Embed image on a new letter-size page
            const page = mergedPdf.addPage([612, 792]);
            const uint8 = new Uint8Array(fileBuffer);
            let img;
            if (file.mime_type === "image/png") {
              img = await mergedPdf.embedPng(uint8);
            } else {
              img = await mergedPdf.embedJpg(uint8);
            }

            // Scale to fit page with margins
            const margin = 50;
            const maxW = 612 - margin * 2;
            const maxH = 792 - margin * 2 - 40; // extra space for label
            const scale = Math.min(maxW / img.width, maxH / img.height, 1);
            const drawW = img.width * scale;
            const drawH = img.height * scale;
            const x = (612 - drawW) / 2;
            const y = (792 - drawH) / 2;

            page.drawImage(img, { x, y, width: drawW, height: drawH });

            // Add item name label at top
            const itemName = (items || []).find(it => it.id === file.item_id)?.name || "";
            page.drawText(`${itemName} — ${file.stage === "proof" ? "Print Proof" : "Mockup"}`, {
              x: margin,
              y: 792 - 30,
              size: 10,
              color: rgb(0.5, 0.5, 0.5),
            });
          }
        } catch (e) {
          console.error("Failed to add file to combined PDF:", file.file_name, e);
        }
      }
    }

    const pdfBytes = await mergedPdf.save();

    const { data: job } = await supabase.from("jobs").select("job_number, title, type_meta").eq("id", jobId).single();
    const slug = (job?.title || jobId).replace(/\s+/g, "-");
    const displayNum = (job as any)?.type_meta?.qb_invoice_number || job?.job_number || jobId.slice(0, 8);
    const filename = `HPD-Invoice-Proofs-${displayNum}-${slug}.pdf`;

    const isDownload = req.nextUrl.searchParams.get("download");
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${isDownload ? "attachment" : "inline"}; filename="${filename}"`,
        "Content-Length": pdfBytes.byteLength.toString(),
      },
    });
  } catch (err: any) {
    console.error("[Combined PDF Error]", err);
    return NextResponse.json({ error: "PDF generation failed", detail: err.message }, { status: 500 });
  }
}
