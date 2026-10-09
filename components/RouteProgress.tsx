'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { beginNavigation, endNavigation, subscribeNavigation, getPendingPath, getServerPendingPath } from '@/lib/route-progress';
import { confirmLeave, pendingLeaveMessage } from '@/lib/leave-guard';

/** Thời gian tối thiểu thanh hiện trên màn hình, kể cả khi trang đã prefetch và mở tức thì */
const MIN_VISIBLE_MS = 380;
/** Không bao giờ treo thanh mãi: quá thời gian này coi như đã xong. */
const GIVE_UP_AFTER = 12_000;

/**
 * Thanh tiến trình chuyển trang ở mép trên: vạch "nhánh" tím chạy dần, đầu vạch là chấm commit hổ phách
 * (như trong logo). Tự bắt click vào link nội bộ; router.push thì đi qua `useAppRouter`.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const router = useRouter();
  const pending = useSyncExternalStore(subscribeNavigation, getPendingPath, getServerPendingPath);
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const finishAt = useRef(0);

  // Click vào link nội bộ (Link của Next lẫn <a> thường), bỏ qua mở tab mới / tải file
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]');
      if (!(a instanceof HTMLAnchorElement) || a.hasAttribute('download')) return;
      if (a.target && a.target !== '_self') return;
      const url = new URL(a.href, window.location.href);
      const leaving = url.origin === window.location.origin && url.pathname !== window.location.pathname;
      // Trang đang có việc dở: chặn link (Next bỏ qua click đã preventDefault), hỏi rồi mới chuyển
      if (leaving && pendingLeaveMessage()) {
        e.preventDefault();
        void confirmLeave().then((ok) => {
          if (!ok) return;
          beginNavigation(a.href);
          router.push(url.pathname + url.search + url.hash);
        });
        return;
      }
      beginNavigation(a.href);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [router]);

  // Trang mới đã hiển thị
  useEffect(() => {
    endNavigation();
  }, [pathname]);

  // Đang tải: hiện ngay, chạy nhanh lúc đầu rồi chậm dần, không bao giờ tự chạm 100%
  useEffect(() => {
    if (!pending) return;
    const startedAt = Date.now();
    let p = 0;
    let trickle: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      p = p === 0 ? 0.3 : p + (0.92 - p) * 0.09;
      setVisible(true);
      setProgress(p);
    };
    const start = setTimeout(() => {
      tick();
      trickle = setInterval(tick, 220);
    }, 0);
    const giveUp = setTimeout(endNavigation, GIVE_UP_AFTER);
    return () => {
      clearTimeout(start);
      clearInterval(trickle);
      clearTimeout(giveUp);
      // Xong: chạy nốt tới cuối; trang mở quá nhanh thì vẫn giữ thanh đủ lâu để người dùng thấy phản hồi
      finishAt.current = startedAt + MIN_VISIBLE_MS;
      setVisible(true);
      setProgress(1);
    };
  }, [pending]);

  useEffect(() => {
    if (progress !== 1) return;
    const fadeAfter = Math.max(260, finishAt.current - Date.now());
    const fade = setTimeout(() => setVisible(false), fadeAfter);
    const reset = setTimeout(() => setProgress(0), fadeAfter + 350); // đợi mờ hẳn mới thu thanh về 0
    return () => {
      clearTimeout(fade);
      clearTimeout(reset);
    };
  }, [progress]);

  return (
    <div
      aria-hidden="true"
      className="route-progress"
      data-visible={visible || undefined}
      style={{ '--rp': progress } as CSSProperties}
    >
      <div className="route-progress__bar" />
      <div className="route-progress__head" />
    </div>
  );
}
