'use client';

import { useEffect, useState } from 'react';

/** Thời điểm hiện tại, tự cập nhật mỗi `intervalMs` khi `active` (dùng cho đồng hồ đang chạy). */
export function useNow(active: boolean, intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [active, intervalMs]);
  return now;
}
