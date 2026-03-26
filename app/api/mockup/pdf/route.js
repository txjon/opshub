import { NextResponse } from 'next/server';
import { generateProofPdf } from '@/lib/proof-pdf';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  try {
    const body = await request.json();
    const { mockupBase64, printInfo, clientName, itemName, blankVendor, blankStyle, blankColor, decoratorName } = body;

    const pdfBuffer = await generateProofPdf({
      mockupBase64,
      printInfo,
      clientName,
      itemName,
      blankVendor,
      blankStyle,
      blankColor,
      decoratorName,
    });

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${(itemName || 'Item')} — Print Proof.pdf"`,
        'Content-Length': pdfBuffer.byteLength.toString(),
      },
    });
  } catch (err) {
    console.error('Proof PDF generation error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
