/**
 * Chuyển dữ liệu giữa các tool: tool nguồn gọi `setHandoff`, điều hướng sang tool đích,
 * rồi `HandoffReceiver` điền dữ liệu vào ô nhập chính của tool đích.
 * Dữ liệu chỉ nằm trong sessionStorage của tab hiện tại và hết hạn sau 2 phút.
 */
const KEY = 'getools_handoff';
const MAX_AGE_MS = 2 * 60 * 1000;
export const MAX_HANDOFF_CHARS = 2_000_000;

export interface Handoff {
  /** id tool đích (xem lib/tools.ts) */
  toolId: string;
  text: string;
  /** Tên hiển thị của nguồn, dùng cho thông báo ("Đã nhận từ ...") */
  source?: string;
  ts: number;
}

export function setHandoff(h: Omit<Handoff, 'ts'>): boolean {
  if (typeof window === 'undefined' || h.text.length > MAX_HANDOFF_CHARS) return false;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...h, ts: Date.now() } satisfies Handoff));
    return true;
  } catch {
    return false;
  }
}

/** Lấy và xóa dữ liệu chờ nếu đúng tool đích và còn hạn. */
export function takeHandoff(toolId: string): Handoff | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const h = JSON.parse(raw) as Handoff;
    if (!h || typeof h.text !== 'string' || h.toolId !== toolId) return null;
    sessionStorage.removeItem(KEY);
    if (Date.now() - h.ts > MAX_AGE_MS) return null;
    return h;
  } catch {
    return null;
  }
}

/** Ghi đè nội dung một ô nhập do React quản lý (setter gốc + sự kiện input). */
export function setReactInputValue(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
