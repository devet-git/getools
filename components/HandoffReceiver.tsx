'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useApp } from '@/components/AppContext';
import { findToolByHref } from '@/lib/tools';
import { setReactInputValue, takeHandoff, type Handoff } from '@/lib/handoff';

// Giữ dữ liệu đã lấy cho tới khi điền xong (effect có thể chạy lặp trong React StrictMode / dev)
let pending: Handoff | null = null;

/**
 * Không có giao diện. Khi vào một tool có dữ liệu chờ (từ "Gửi tới…", Smart Paste hay Snippet),
 * điền dữ liệu vào ô nhập chính: phần tử có `data-handoff`, nếu không có thì textarea đầu tiên có thể sửa.
 */
export function HandoffReceiver() {
  const pathname = usePathname() || '/';
  const { showToast } = useApp();

  useEffect(() => {
    const tool = findToolByHref(pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname);
    if (!tool) return;
    const h = pending && pending.toolId === tool.id ? pending : takeHandoff(tool.id);
    if (!h) return;
    pending = h;

    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      const el =
        document.querySelector<HTMLTextAreaElement | HTMLInputElement>('main [data-handoff]') ||
        document.querySelector<HTMLTextAreaElement>('main textarea:not([readonly]):not([disabled])');
      if (el) {
        pending = null;
        setReactInputValue(el, h.text);
        el.focus({ preventScroll: true });
        showToast(h.source ? `Đã nhận dữ liệu từ ${h.source}.` : 'Đã nhận dữ liệu.');
        return;
      }
      if (++tries < 30) timer = setTimeout(attempt, 100); // chờ trang (và AI gate) dựng xong, tối đa ~3 giây
      else pending = null;
    };
    timer = setTimeout(attempt, 80);
    return () => {
      if (timer) clearTimeout(timer);
    };
    // chỉ chạy khi đổi trang
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
}
