/**
 * Hỏi xác nhận trước khi rời trang khi đang có việc dở (ghi âm, đang xử lý...).
 * - Chuyển trang trong app (link / router.push): hộp thoại của app (RouteProgress + useAppRouter gọi `confirmLeave`).
 * - Đóng / tải lại tab: hộp thoại `beforeunload` của trình duyệt (gồm cả khi còn tác vụ nền đang chạy).
 * Trang đăng ký bằng hook `useLeaveGuard` (hooks/use-leave-guard.ts).
 */
import { showConfirm } from '@/lib/dialog';
import { hasRunningJobs } from '@/lib/background-jobs';

const guards = new Map<number, string>();
let seq = 0;

export function addLeaveGuard(message: string): () => void {
  const id = ++seq;
  guards.set(id, message);
  return () => {
    guards.delete(id);
  };
}

/** Lời nhắc của việc dở gần nhất; null nếu rời trang an toàn */
export function pendingLeaveMessage(): string | null {
  const all = [...guards.values()];
  return all.length ? all[all.length - 1] : null;
}

/** true nếu được phép rời trang (không có việc dở, hoặc người dùng đồng ý) */
export async function confirmLeave(): Promise<boolean> {
  const msg = pendingLeaveMessage();
  if (!msg) return true;
  return showConfirm(`${msg}\n\nVẫn rời trang?`, { title: 'Rời trang?', confirmText: 'Rời trang', cancelText: 'Ở lại', danger: true });
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (!pendingLeaveMessage() && !hasRunningJobs()) return;
    e.preventDefault();
    e.returnValue = ''; // trình duyệt cũ cần gán để hiện hộp thoại
  });
}
