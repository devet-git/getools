'use client';

import { KeyRound, Sparkles } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { useAiSettings } from '@/lib/use-ai-config';
import { PROVIDER_INFO } from '@/lib/ai-providers';

/** Dải thông báo trên các trang AI: nhắc thêm khóa, hoặc cho biết đang dùng nhà cung cấp / model nào. */
export function AiKeyNotice() {
  const { openSettings } = useApp();
  const { config, ready, providerLabel } = useAiSettings();

  if (!ready) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-indigo-900 bg-indigo-50 border border-indigo-200 rounded-xl p-2.5">
        <Sparkles className="h-4 w-4 shrink-0 text-indigo-600" />
        <span className="flex-1 min-w-[200px]">
          Đang dùng <b>chế độ miễn phí</b> (xử lý ngay trên trình duyệt). Thêm khóa AI của bạn để mở thêm các tính năng nâng cao.
        </span>
        <button
          type="button"
          onClick={() => openSettings('ai')}
          className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition"
        >
          Thêm khóa AI
        </button>
      </div>
    );
  }

  const model = config.model || PROVIDER_INFO[config.provider].defaultModel;
  return (
    <div className="flex items-center gap-2 text-[11px] text-slate-500 px-1">
      <KeyRound className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
      <span>
        Đang dùng <b className="text-slate-700">{providerLabel}</b>
        {model && <> · model <code className="font-mono">{model}</code></>}
      </span>
      <button type="button" onClick={() => openSettings('ai')} className="underline hover:text-slate-800">
        Đổi
      </button>
    </div>
  );
}
