'use client';

import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { restoreSharedState } from '@/lib/share-link';

/**
 * Khôi phục trạng thái từ link chia sẻ nén (`#z=...`).
 * Render children ngay (không lệch SSR/hydration); nếu khôi phục được, đổi `key` để trang công cụ
 * mount lại và đọc query mới qua readShareParams().
 */
export function ShareBoot({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    restoreSharedState().then((restored) => {
      if (restored && !cancelled) setVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return <Fragment key={version}>{children}</Fragment>;
}
