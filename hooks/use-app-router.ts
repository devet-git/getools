'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { beginNavigation } from '@/lib/route-progress';
import { confirmLeave, pendingLeaveMessage } from '@/lib/leave-guard';

/**
 * `useRouter` của Next, nhưng `push` bật luôn thanh tiến trình chuyển trang (như khi click link) và hỏi xác nhận
 * nếu trang hiện tại đang có việc dở (lib/leave-guard.ts).
 */
export function useAppRouter() {
  const router = useRouter();
  return useMemo(() => ({
    ...router,
    push: (href: string, options?: Parameters<typeof router.push>[1]) => {
      const go = () => {
        beginNavigation(href);
        router.push(href, options);
      };
      if (!pendingLeaveMessage()) return go();
      void confirmLeave().then((ok) => ok && go());
    },
  }), [router]);
}
