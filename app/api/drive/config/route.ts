import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Client ID OAuth cho tính năng đồng bộ Google Drive, đọc lúc chạy (đổi biến môi trường không cần build lại).
 * Client ID không phải bí mật — nó vốn hiển thị công khai trong cửa sổ đăng nhập Google.
 */
export async function GET() {
  const clientId = (process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '').trim();
  return NextResponse.json({ clientId: clientId || null });
}
