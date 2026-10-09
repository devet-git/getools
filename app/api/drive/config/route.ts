import { NextRequest, NextResponse } from 'next/server';
import { rejectForeign } from '@/lib/api-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Bỏ khoảng trắng và dấu ngoặc bao quanh (hay gặp khi dán `"xxx"` vào giao diện Vercel / file .env) */
function clean(v: string | undefined): string {
  return (v ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();
}

/**
 * Client ID OAuth cho tính năng đồng bộ Google Drive, đọc lúc chạy (đổi biến môi trường không cần build lại).
 * Chỉ trả cho chính trang GeTools (mở thẳng URL hay trang khác gọi sang nhận 404). Lưu ý: Client ID vẫn hiện trong
 * URL cửa sổ đăng nhập Google — đó là thiết kế của OAuth; an toàn dựa vào danh sách "Authorized JavaScript origins".
 */
export async function GET(req: NextRequest) {
  const foreign = rejectForeign(req);
  if (foreign) return foreign;
  const clientId = clean(process.env.GOOGLE_CLIENT_ID) || clean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);
  return NextResponse.json(
    { clientId: clientId || null },
    { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } },
  );
}
