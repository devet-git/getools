'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { findToolByPath } from '@/lib/tools';
import { recordToolVisit } from '@/lib/recent-tools';

/** Không có giao diện: ghi nhận tool đang mở vào danh sách "dùng gần đây". */
export function ToolTracker() {
  const pathname = usePathname();
  useEffect(() => {
    const tool = findToolByPath(pathname);
    if (tool) recordToolVisit(tool.id);
  }, [pathname]);
  return null;
}
