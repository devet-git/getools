import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Bỏ khoảng trắng và dấu ngoặc bao quanh (hay gặp khi dán `"xxx"` vào giao diện Vercel / file .env) */
function clean(v: string | undefined): string {
  return (v ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();
}

/**
 * Client ID OAuth cho tính năng đồng bộ Google Drive, đọc lúc chạy (đổi biến môi trường không cần build lại).
 * Client ID không phải bí mật — nó vốn hiển thị công khai trong cửa sổ đăng nhập Google.
 */
export async function GET() {
  const clientId = clean(process.env.GOOGLE_CLIENT_ID) || clean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);
  if (clientId) return NextResponse.json({ clientId }, { headers: { 'Cache-Control': 'no-store' } });

  // Chưa có: trả thêm thông tin chẩn đoán — chỉ TÊN biến gần giống, không bao giờ trả giá trị
  return NextResponse.json(
    {
      clientId: null,
      debug: {
        hint: 'Biến GOOGLE_CLIENT_ID không có trong môi trường của tiến trình đang chạy.',
        similarEnvNames: Object.keys(process.env).filter((k) => /google|client.?id/i.test(k)).sort(),
        vercelEnv: process.env.VERCEL_ENV ?? null,
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
