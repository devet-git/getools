'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { findToolByHref } from '@/lib/tools';
import { recordToolVisit } from '@/lib/recent-tools';

/** Không có giao diện: ghi nhận tool đang mở vào danh sách "dùng gần đây". */
export function ToolTracker() {
  const pathname = usePathname();
  useEffect(() => {
    const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
    const tool = findToolByHref(normalized);
    if (tool) recordToolVisit(tool.id);
  }, [pathname]);
  return null;
}
