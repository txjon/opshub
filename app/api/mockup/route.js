import { NextResponse } from 'next/server';
import { buildMockup } from '@/lib/mockup-engine';
import { generateProofPdf } from '@/lib/proof-pdf';
import { uploadFile, getItemFolderId } from '@/lib/google-drive';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('psd');
    const itemId = formData.get('itemId');
    const clientName = formData.get('clientName') || '';
    const itemName = formData.get('itemName') || '';
    const blankVendor = formData.get('blankVendor') || '';
    const blankStyle = formData.get('blankStyle') || '';
    const blankColor = formData.get('blankColor') || '';
    const decoratorName = formData.get('decoratorName') || '';
    const projectTitle = formData.get('projectTitle') || '';
    const saveToDrive = formData.get('saveToDrive') === 'true';

    if (!file) {
      return NextResponse.json({ error: 'No PSD file uploaded' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Generate mockup
    const { png, printInfo } = buildMockup(buffer);

    // Generate proof PDF
    const mockupBase64 = png.toString('base64');
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

    const result = {
      mockup: png.toString('base64'),
      proof: pdfBuffer.toString('base64'),
      printInfo,
    };

    // Save to Google Drive if requested
    if (saveToDrive && itemId && clientName) {
      try {
        const folderId = await getItemFolderId(clientName, projectTitle || 'General', itemName || 'Untitled Item');

        // Upload mockup PNG
        const mockupFileName = `${itemName || 'Item'} — Mockup.png`;
        const mockupFile = await uploadFile(folderId, mockupFileName, 'image/png', png);

        // Upload proof PDF
        const proofFileName = `${itemName || 'Item'} — Print Proof.pdf`;
        const proofFile = await uploadFile(folderId, proofFileName, 'application/pdf', pdfBuffer);

        // Create item_files records
        if (itemId) {
          const supabase = createClient();

          await supabase.from('item_files').insert([
            {
              item_id: itemId,
              file_name: mockupFileName,
              drive_file_id: mockupFile.fileId,
              drive_link: mockupFile.webViewLink,
              stage: 'mockup',
              mime_type: 'image/png',
              file_size: png.length,
            },
            {
              item_id: itemId,
              file_name: proofFileName,
              drive_file_id: proofFile.fileId,
              drive_link: proofFile.webViewLink,
              stage: 'proof',
              mime_type: 'application/pdf',
              file_size: pdfBuffer.length,
              approval: 'pending',
            },
          ]);

          result.driveLinks = { mockup: mockupFile.webViewLink, proof: proofFile.webViewLink };
        }
      } catch (driveErr) {
        console.error('Drive upload error:', driveErr);
        result.driveError = driveErr.message;
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('Mockup generation error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
