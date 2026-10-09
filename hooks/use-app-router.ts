'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { beginNavigation } from '@/lib/route-progress';

/** `useRouter` của Next, nhưng `push` bật luôn thanh tiến trình chuyển trang (như khi click link). */
export function useAppRouter() {
  const router = useRouter();
  return useMemo(() => ({
    ...router,
    push: (href: string, options?: Parameters<typeof router.push>[1]) => {
      beginNavigation(href);
      router.push(href, options);
    },
  }), [router]);
}
