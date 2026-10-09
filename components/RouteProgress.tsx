'use client';

import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { usePathname } from 'next/navigation';
import { beginNavigation, endNavigation, subscribeNavigation, getPendingPath, getServerPendingPath } from '@/lib/route-progress';

/** Trang đã prefetch thường mở gần như tức thì: chờ một chút mới hiện thanh để khỏi nháy. */
const SHOW_DELAY = 150;
/** Không bao giờ treo thanh mãi: quá thời gian này coi như đã xong. */
const GIVE_UP_AFTER = 12_000;

/**
 * Thanh tiến trình chuyển trang ở mép trên: vạch "nhánh" tím chạy dần, đầu vạch là chấm commit hổ phách
 * (như trong logo). Tự bắt click vào link nội bộ; router.push thì đi qua `useAppRouter`.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const pending = useSyncExternalStore(subscribeNavigation, getPendingPath, getServerPendingPath);
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  // Click vào link nội bộ (Link của Next lẫn <a> thường), bỏ qua mở tab mới / tải file
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]');
      if (!(a instanceof HTMLAnchorElement) || a.hasAttribute('download')) return;
      if (a.target && a.target !== '_self') return;
      beginNavigation(a.href);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  // Trang mới đã hiển thị
  useEffect(() => {
    endNavigation();
  }, [pathname]);

  // Đang tải: chạy nhanh lúc đầu rồi chậm dần, không bao giờ tự chạm 100%
  useEffect(() => {
    if (!pending) return;
    let p = 0;
    let trickle: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      p = p === 0 ? 0.18 : p + (0.92 - p) * 0.09;
      setVisible(true);
      setProgress(p);
    };
    const start = setTimeout(() => {
      tick();
      trickle = setInterval(tick, 220);
    }, SHOW_DELAY);
    const giveUp = setTimeout(endNavigation, GIVE_UP_AFTER);
    return () => {
      clearTimeout(start);
      clearInterval(trickle);
      clearTimeout(giveUp);
      // Xong: nếu thanh đã hiện thì chạy nốt tới cuối rồi mới mờ đi
      setProgress((cur) => (cur > 0 ? 1 : 0));
    };
  }, [pending]);

  useEffect(() => {
    if (progress !== 1) return;
    const fade = setTimeout(() => setVisible(false), 260);
    const reset = setTimeout(() => setProgress(0), 600);
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
