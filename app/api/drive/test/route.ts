import { NextRequest, NextResponse } from "next/server";
import { getDriveToken } from "@/lib/drive-token";

export async function POST(req: NextRequest) {
  try {
    const token = await getDriveToken();
    const folderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    return NextResponse.json({ token, folderId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
