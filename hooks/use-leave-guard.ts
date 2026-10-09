'use client';

import { useEffect } from 'react';
import { addLeaveGuard } from '@/lib/leave-guard';

/** Khi `active`: hỏi xác nhận trước khi người dùng rời trang (chuyển công cụ, đóng hoặc tải lại tab). */
export function useLeaveGuard(active: boolean, message: string) {
  useEffect(() => (active ? addLeaveGuard(message) : undefined), [active, message]);
}
