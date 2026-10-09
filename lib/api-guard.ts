/**
 * Lớp bảo vệ cho route API nội bộ (chỉ import từ route handler).
 *
 * - `rejectForeign`: chỉ phục vụ fetch từ chính trang GeTools. Request mở thẳng trên thanh địa chỉ, từ trang
 *   web khác hay công cụ không gửi đúng header đều nhận 404 như thể route không tồn tại.
 * - `rateLimit`: giới hạn tần suất theo IP cho các thao tác tốn tài nguyên của máy chủ (vd. khi dùng khóa
 *   Gemini của máy chủ) — vì client không phải trình duyệt vẫn có thể tự giả header.
 */
import { NextResponse } from 'next/server';
import { API_CLIENT_HEADER } from '@/lib/api-client';

const notFound = () =>
  NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** Trả về response 404 nếu request không đến từ trang GeTools cùng origin; null nếu hợp lệ. */
export function rejectForeign(req: Request): NextResponse | null {
  const h = req.headers;
  if (h.get(API_CLIENT_HEADER) !== '1') return notFound();
  // Trình duyệt hiện đại luôn gửi Sec-Fetch-Site: chỉ chấp nhận cùng origin
  const site = h.get('sec-fetch-site');
  if (site && site !== 'same-origin') return notFound();
  // Có Origin (POST, hoặc trình duyệt cũ) thì phải trùng host đang phục vụ
  const host = h.get('x-forwarded-host') || h.get('host');
  const origin = h.get('origin');
  if (origin && hostOf(origin) !== host) return notFound();
  return null;
}

/* ---------- Giới hạn tần suất (cửa sổ trượt, bộ nhớ trong tiến trình) ---------- */

const buckets = new Map<string, number[]>();
let lastSweep = 0;

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0] : req.headers.get('x-real-ip') || 'unknown').trim();
}

/**
 * Tối đa `limit` lần trong `windowMs` cho mỗi (tên, IP). Trả về response 429 khi vượt; null nếu còn lượt.
 * Lưu trong bộ nhớ của từng instance (serverless có thể có nhiều instance) — đủ để chặn lạm dụng thô,
 * không thay được hạn mức phía nhà cung cấp AI.
 */
export function rateLimit(req: Request, name: string, limit: number, windowMs: number): NextResponse | null {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [k, ts] of buckets) if (!ts.length || now - ts[ts.length - 1] > windowMs) buckets.delete(k);
  }
  const key = `${name}:${clientIp(req)}`;
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    const retry = Math.ceil((windowMs - (now - hits[0])) / 1000);
    return NextResponse.json(
      { error: `Bạn đã dùng hết lượt miễn phí của máy chủ, thử lại sau ${Math.ceil(retry / 60)} phút hoặc nhập khóa AI của riêng bạn trong Cài đặt.` },
      { status: 429, headers: { 'Retry-After': String(retry) } },
    );
  }
  hits.push(now);
  buckets.set(key, hits);
  return null;
}
