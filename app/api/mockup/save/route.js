import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getItemFolderId, uploadFile } from '@/lib/google-drive';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { mockupBase64, pdfBase64, itemId, clientName, projectTitle, itemName, stage } = await request.json();

    if (!itemId || !clientName || !projectTitle || !itemName) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const folderId = await getItemFolderId(clientName, projectTitle, itemName);
    const safeName = (itemName || 'Item').replace(/[^\w\s-]/g, '');
    const results = {};

    // Upload mockup PNG if provided
    if (mockupBase64) {
      const buffer = Buffer.from(mockupBase64, 'base64');
      const fileName = `${safeName} - Mockup.jpg`;
      const driveFile = await uploadFile(folderId, fileName, 'image/jpeg', buffer);

      await supabase.from('item_files').insert({
        item_id: itemId,
        file_name: fileName,
        stage: 'mockup',
        drive_file_id: driveFile.fileId,
        drive_link: driveFile.webViewLink,
        mime_type: 'image/jpeg',
        file_size: buffer.length,
        approval: 'none',
        uploaded_by: user.id,
      });

      results.mockup = driveFile.webViewLink;
    }

    // Upload proof PDF if provided
    if (pdfBase64) {
      const buffer = Buffer.from(pdfBase64, 'base64');
      const fileName = `${safeName} - Print Proof.pdf`;
      const driveFile = await uploadFile(folderId, fileName, 'application/pdf', buffer);

      await supabase.from('item_files').insert({
        item_id: itemId,
        file_name: fileName,
        stage: 'proof',
        drive_file_id: driveFile.fileId,
        drive_link: driveFile.webViewLink,
        mime_type: 'application/pdf',
        file_size: buffer.length,
        approval: 'pending',
        uploaded_by: user.id,
      });

      results.proof = driveFile.webViewLink;
    }

    return NextResponse.json({ success: true, ...results });
  } catch (e) {
    console.error('Mockup save error:', e);
    return NextResponse.json({ error: e.message || 'Save failed' }, { status: 500 });
  }
}
