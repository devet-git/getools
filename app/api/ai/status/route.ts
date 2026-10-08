import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cho client biết máy chủ có sẵn khóa Gemini trong môi trường hay không (không bao giờ trả về giá trị khóa). */
export async function GET() {
  return NextResponse.json({ gemini: !!process.env.GEMINI_API_KEY?.trim() });
}
