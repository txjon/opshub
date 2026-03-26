import { NextResponse } from 'next/server';
import { buildMockup } from '@/lib/mockup-engine';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('psd');

    if (!file) {
      return NextResponse.json({ error: 'No PSD file uploaded' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { png, printInfo } = buildMockup(buffer);

    return NextResponse.json({
      mockup: png.toString('base64'),
      printInfo,
    });
  } catch (err) {
    console.error('Mockup generation error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
