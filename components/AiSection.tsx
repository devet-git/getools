'use client';

import { KeyRound, Lock, Sparkles } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { useAiSettings } from '@/lib/use-ai-config';

interface AiSectionProps {
  /** 'gemini' = bắt buộc khóa Gemini (vd. giọng đọc AI); mặc định dùng khóa của nhà cung cấp đang chọn */
  requires?: 'any' | 'gemini';
  /** Tên tính năng nâng cao, hiện trong thẻ hướng dẫn */
  title: string;
  /** Một câu nói rõ khi có khóa thì được thêm gì */
  description?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Bao quanh MỘT PHẦN tính năng cần AI. Chưa có khóa: phần đó bị làm mờ và vô hiệu hóa kèm hướng dẫn;
 * phần còn lại của trang (tính năng miễn phí) vẫn dùng bình thường. Có khóa: hiển thị bình thường.
 */
export function AiSection({ requires = 'any', title, description, children, className = '' }: AiSectionProps) {
  const { openSettings } = useApp();
  const ai = useAiSettings();

  if (ai.isAiReady(requires)) return <div className={className}>{children}</div>;

  const needsGemini = requires === 'gemini';
  const open = () => {
    if (needsGemini) ai.setProvider('gemini');
    openSettings('ai');
  };

  return (
    <div className={`relative ${className}`}>
      <div inert aria-hidden="true" className="opacity-40 blur-[1.5px] pointer-events-none select-none">
        {children}
      </div>
      <div className="absolute inset-0 z-10 flex items-start justify-center p-3">
        <div role="note" className="w-full max-w-sm rounded-xl border border-amber-200 bg-white p-3.5 shadow-lg text-center space-y-2">
          <div className="mx-auto h-9 w-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
            <Lock className="h-4 w-4" />
          </div>
          <div className="text-xs font-bold text-slate-900 flex items-center justify-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
            {title} <span className="font-medium text-slate-500">cần khóa AI</span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            {description ?? 'Phần này dùng AI. Thêm khóa của bạn để mở khóa.'}
            {needsGemini && ' Cần khóa Google Gemini.'}
          </p>
          <button
            type="button"
            onClick={open}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition"
          >
            <KeyRound className="h-3.5 w-3.5" />
            Nhập khóa AI
          </button>
        </div>
      </div>
    </div>
  );
}
