'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { KeyRound, Lock } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { useAiSettings } from '@/lib/use-ai-config';
import { findToolByHref } from '@/lib/tools';

/**
 * Bao quanh nội dung trang: nếu tool bắt buộc có AI mà chưa có khóa thì làm mờ, vô hiệu hóa
 * toàn bộ nội dung và hiện hướng dẫn nhập khóa.
 */
export function AiToolGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  const { openSettings } = useApp();
  const ai = useAiSettings();

  const tool = findToolByHref(pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname);
  const locked = ai.isToolLocked(tool);
  const active = locked && !!tool;

  // Khi bị khóa: đưa trang về đầu để thẻ hướng dẫn luôn nằm trong tầm nhìn
  useEffect(() => {
    if (!active) return;
    window.scrollTo(0, 0);
    // Khóa cuộn cả trang trong lúc bị khóa (trả lại như cũ khi mở khóa hoặc rời trang)
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prev;
    };
  }, [active]);

  if (!active || !tool) return <>{children}</>;

  const needsGemini = tool.requiresAi === 'gemini';
  const openKeySettings = () => {
    if (needsGemini) ai.setProvider('gemini');
    openSettings('ai');
  };

  // Chiều cao đúng bằng vùng nhìn thấy + ẩn phần tràn => trang không còn gì để cuộn
  return (
    <div className="relative overflow-hidden h-[calc(100dvh-5rem)] lg:h-[calc(100dvh-2rem)]">
      <div
        inert
        aria-hidden="true"
        className="opacity-35 blur-[1.5px] pointer-events-none select-none"
      >
        {children}
      </div>

      <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
        <div
          role="alert"
          className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-5 shadow-xl text-center space-y-3"
        >
          <div className="mx-auto h-11 w-11 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
            <Lock className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <h2 className="text-sm font-bold text-slate-900">
              {tool.name} cần khóa AI
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              {needsGemini
                ? 'Tool này dùng Google Gemini. Hãy nhập Gemini API Key của bạn để sử dụng.'
                : `Tool này cần một khóa AI để hoạt động (hiện đang chọn: ${ai.providerLabel}). Hãy nhập khóa của bạn — Gemini, OpenAI, Anthropic hoặc dịch vụ tương thích OpenAI đều được.`}
            </p>
          </div>
          <button
            type="button"
            onClick={openKeySettings}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition"
          >
            <KeyRound className="h-3.5 w-3.5" />
            Nhập khóa AI
          </button>
          <p className="text-[10px] text-slate-400">Khóa chỉ được lưu trong trình duyệt của bạn.</p>
        </div>
      </div>
    </div>
  );
}
