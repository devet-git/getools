'use client';

import { Link2 } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { buildShareUrlAsync } from '@/lib/share-link';

/** Nút "Chia sẻ link": chép URL trang hiện tại kèm trạng thái trong `params`. */
export function ShareLinkButton({
  params,
  className,
  label = 'Chia sẻ link',
}: {
  params: Record<string, string | undefined | null>;
  className?: string;
  label?: string;
}) {
  const { showToast } = useApp();

  const handleClick = async () => {
    const url = await buildShareUrlAsync(params);
    if (!url) {
      showToast('Nội dung quá dài để chia sẻ qua link.');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast(url.includes('#z=') ? 'Đã sao chép link chia sẻ (đã nén)' : 'Đã sao chép link chia sẻ!');
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title="Sao chép link giữ nguyên cấu hình hiện tại"
      className={
        className ??
        'px-2.5 py-1 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition flex items-center gap-1'
      }
    >
      <Link2 className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
