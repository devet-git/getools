'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { findCategoryByPath, findToolByPath } from '@/lib/tools';
import { subscribeNavigation, getPendingPath, getServerPendingPath } from '@/lib/route-progress';

/** Câu chạy trong terminal mini: vài câu đùa cho vui, xen mẹo dùng app */
const LINES = [
  'git checkout -b công-cụ-xịn',
  'Đang pha cà phê cho CPU ☕',
  'npm install --save niềm-vui',
  'Mẹo: Ctrl+K để tìm nhanh mọi công cụ',
  'Đang rebase lên nhánh hạnh-phúc',
  'Đang đếm lại từng bit cho chắc ăn…',
  'Mẹo: Dán thông minh tự đoán công cụ cần mở',
  'Đang xếp pixel cho thẳng hàng',
  'Đang tính tiền điện cho server ⚡',
  'git commit -m "sắp xong rồi"',
].map((l) => Array.from(l));

const TYPE_MS = 38;
/** Số nhịp dừng lại sau khi gõ xong một câu */
const HOLD_TICKS = 28;

/** Gõ từng chữ, xong một câu thì dừng một nhịp rồi sang câu ngẫu nhiên khác. */
function useTypewriter(): string {
  const [{ line, typed }, setState] = useState({ line: 0, typed: 0 });
  useEffect(() => {
    const id = setInterval(() => {
      setState((s) => {
        if (s.typed < LINES[s.line].length + HOLD_TICKS) return { ...s, typed: s.typed + 1 };
        let next = Math.floor(Math.random() * (LINES.length - 1));
        if (next >= s.line) next++; // không lặp lại câu vừa gõ
        return { line: next, typed: 0 };
      });
    }, TYPE_MS);
    return () => clearInterval(id);
  }, []);
  return LINES[line].slice(0, typed).join('');
}

/** Đồ thị Git tự vẽ: nhánh chính → tách nhánh → commit → merge (chấm hổ phách như logo), lặp vô hạn. */
function GitGraph() {
  return (
    <svg viewBox="0 0 260 96" className="gl-graph" aria-hidden="true">
      <path className="gl-line gl-line--main" d="M16 70H244" pathLength={100} />
      <path className="gl-line gl-line--branch" d="M64 70C64 44 82 34 104 34H156C178 34 196 44 196 70" pathLength={100} />
      <circle className="gl-commit" cx={16} cy={70} r={6} style={{ animationDelay: '0.05s' }} />
      <circle className="gl-commit" cx={64} cy={70} r={6} style={{ animationDelay: '0.35s' }} />
      <circle className="gl-commit gl-commit--branch" cx={112} cy={34} r={6} style={{ animationDelay: '0.9s' }} />
      <circle className="gl-commit" cx={130} cy={70} r={6} style={{ animationDelay: '1.05s' }} />
      <circle className="gl-commit gl-commit--branch" cx={148} cy={34} r={6} style={{ animationDelay: '1.2s' }} />
      <circle className="gl-ring" cx={196} cy={70} r={7} style={{ animationDelay: '1.65s' }} />
      <circle className="gl-commit gl-commit--merge" cx={196} cy={70} r={7} style={{ animationDelay: '1.55s' }} />
      <circle className="gl-commit" cx={244} cy={70} r={6} style={{ animationDelay: '1.85s' }} />
    </svg>
  );
}

/** Màn hình chờ khi đang mở một trang (app/loading.tsx và lớp phủ khi chuyển trang chậm). */
export function AppLoader() {
  const pending = useSyncExternalStore(subscribeNavigation, getPendingPath, getServerPendingPath);
  // Biết trang đích (click link / router.push) thì hiện tên công cụ hoặc nhóm sắp mở
  const tool = pending ? findToolByPath(pending) : undefined;
  const category = !tool && pending ? findCategoryByPath(pending) : undefined;
  const label = tool?.name ?? category?.title;
  const Icon = tool?.icon ?? category?.icon;
  const text = useTypewriter();

  return (
    <div role="status" aria-live="polite" className="gl-loader">
      <GitGraph />

      <p className="gl-title">
        {label && Icon ? (
          <>
            Đang mở <Icon className="gl-title__icon" /> <strong>{label}</strong>
          </>
        ) : (
          'Đang tải công cụ…'
        )}
      </p>

      <div className="gl-terminal" aria-hidden="true">
        <span className="gl-terminal__prompt">~/getools $</span> {text}
        <span className="gl-terminal__caret" />
      </div>
    </div>
  );
}

/** Chuyển trang chậm hơn mức này mới phủ màn hình chờ (trang đã prefetch thì mở ngay, không nháy). */
const OVERLAY_DELAY = 450;

/**
 * Next giữ nguyên trang cũ trong lúc chờ trang mới (khi chưa prefetch xong) nên app/loading.tsx không phải lúc nào
 * cũng hiện. Lớp phủ này bảo đảm mạng chậm thì vẫn thấy màn hình chờ, phủ đúng vùng nội dung (chừa sidebar).
 */
export function NavigationOverlay({ sidebarCollapsed }: { sidebarCollapsed: boolean }) {
  const pending = useSyncExternalStore(subscribeNavigation, getPendingPath, getServerPendingPath);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setShow(true), OVERLAY_DELAY);
    return () => {
      clearTimeout(t);
      setShow(false);
    };
  }, [pending]);

  if (!show || !pending) return null;
  return (
    <div className={`gl-overlay ${sidebarCollapsed ? 'lg:left-20' : 'lg:left-72'}`}>
      <AppLoader />
    </div>
  );
}
