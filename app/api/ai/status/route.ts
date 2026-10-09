import { NextRequest, NextResponse } from 'next/server';
import { rejectForeign } from '@/lib/api-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cho client biết máy chủ có sẵn khóa Gemini trong môi trường hay không (không bao giờ trả về giá trị khóa). */
export async function GET(req: NextRequest) {
  const foreign = rejectForeign(req);
  if (foreign) return foreign;
  return NextResponse.json({ gemini: !!process.env.GEMINI_API_KEY?.trim() }, { headers: { 'Cache-Control': 'no-store' } });
}
