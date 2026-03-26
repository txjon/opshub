import { NextResponse } from 'next/server';
import { generateProofPdf } from '@/lib/proof-pdf';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  try {
    const formData = await request.formData();
    const mockupBase64 = formData.get('mockupBase64') || '';
    const printInfo = JSON.parse(formData.get('printInfo') || '[]');
    const clientName = formData.get('clientName') || '';
    const itemName = formData.get('itemName') || '';
    const blankVendor = formData.get('blankVendor') || '';
    const blankStyle = formData.get('blankStyle') || '';
    const blankColor = formData.get('blankColor') || '';
    const decoratorName = formData.get('decoratorName') || '';

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
