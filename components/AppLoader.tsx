'use client';

import { useEffect, useMemo, useState, useSyncExternalStore, type ComponentType } from 'react';
import { TOOL_CATEGORIES, findCategoryByPath, findToolByPath, getCategory } from '@/lib/tools';
import { subscribeNavigation, getPendingPath, getServerPendingPath } from '@/lib/route-progress';

type Icon = ComponentType<{ className?: string }>;

/** Câu vui xen mẹo dùng app, chạy bên dưới tên công cụ */
const PHRASES = [
  'Đang lắp ráp bánh răng…',
  'Đang mài sắc dao kéo…',
  'Pha cà phê cho CPU ☕',
  'Mẹo: Ctrl+K để tìm nhanh mọi công cụ',
  'Đang xếp pixel cho thẳng hàng…',
  'Gọi các hành tinh về quỹ đạo…',
  'Mẹo: Dán thông minh tự đoán công cụ cần mở',
  'Đang lên dây cót…',
];

/** Ký tự "nhiễu" khi giải mã chữ */
const NOISE = '▖▘▝▗▚▞░▒▓<>/\\{}[]#*+=~01';
const FRAME_MS = 32;

/**
 * Chữ hiện ra kiểu "giải mã": ký tự ngẫu nhiên nhấp nháy rồi lần lượt chốt thành chữ thật từ trái sang phải.
 * Lần vẽ đầu (cả trên máy chủ) là chữ thật, hiệu ứng chỉ chạy sau khi gắn vào trang.
 */
function ScrambleText({ text, className }: { text: string; className?: string }) {
  const chars = useMemo(() => Array.from(text), [text]);
  const [shown, setShown] = useState(text);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const total = chars.length + 6; // vài khung đầu toàn nhiễu
    const id = setInterval(() => {
      frame++;
      const settled = Math.max(0, frame - 6);
      setShown(chars.map((c, i) => (i < settled || c === ' ' ? c : NOISE[(Math.random() * NOISE.length) | 0])).join(''));
      if (frame >= total) clearInterval(id);
    }, FRAME_MS);
    return () => clearInterval(id);
  }, [chars]);
  return <span className={className} aria-label={text}>{shown}</span>;
}

/** Câu vui đổi lần lượt, mỗi câu hiện bằng hiệu ứng giải mã */
function RotatingPhrase() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1 + ((Math.random() * (PHRASES.length - 1)) | 0)) % PHRASES.length), 2600);
    return () => clearInterval(id);
  }, []);
  return <ScrambleText key={i} text={PHRASES[i]} className="orbit-phrase" />;
}

const G_PATH = 'M45.86 24A16 16 0 1 0 48 32H35';
/** Nhịp vẽ nét: vẽ (0 → 55%), giữ (→ 75%), xóa dần từ đầu nét (→ 100%) */
const DRAW = { dur: '2.4s', keyTimes: '0;0.55;0.75;1' };

const subscribeMotion = (cb: () => void) => {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
const getReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Logo "G" tự vẽ nét, chấm hổ phách (như logo) chạy theo đúng đầu nét đang vẽ */
function DrawingLogo() {
  // SMIL thay vì CSS để chấm và nét dùng chung một nhịp, khớp nhau tuyệt đối
  const reduced = useSyncExternalStore(subscribeMotion, getReducedMotion, () => false);
  return (
    <svg viewBox="0 0 64 64" className="orbit-logo" aria-hidden="true">
      <defs>
        <linearGradient id="orbit-logo-bg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4f46e5" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#orbit-logo-bg)" />
      <path className="orbit-logo__ghost" d={G_PATH} />
      <path className="orbit-logo__stroke" d={G_PATH} pathLength={100} strokeDashoffset={reduced ? 0 : 100}>
        {!reduced && <animate attributeName="stroke-dashoffset" values="100;0;0;-100" keyTimes={DRAW.keyTimes} dur={DRAW.dur} repeatCount="indefinite" />}
      </path>
      <circle className="orbit-logo__dot" r="4.5" cx={reduced ? 45.86 : 0} cy={reduced ? 24 : 0}>
        {!reduced && (
          <>
            <animateMotion path={G_PATH} keyPoints="0;1;1;1" keyTimes={DRAW.keyTimes} calcMode="linear" dur={DRAW.dur} repeatCount="indefinite" />
            <animate attributeName="opacity" values="1;1;1;0" keyTimes={DRAW.keyTimes} dur={DRAW.dur} repeatCount="indefinite" />
          </>
        )}
      </circle>
    </svg>
  );
}

function Ring({ icons, radius, duration, reverse }: { icons: Icon[]; radius: number; duration: number; reverse?: boolean }) {
  return (
    <div className={`orbit-ring${reverse ? ' orbit-ring--reverse' : ''}`} style={{ ['--r' as string]: `${radius}px`, ['--d' as string]: `${duration}s` }}>
      <div className="orbit-ring__path" />
      {icons.map((Ic, i) => (
        <div key={i} className="orbit-ring__slot" style={{ ['--a' as string]: `${(360 / icons.length) * i}deg` }}>
          <div className="orbit-ring__item">
            <Ic className="h-4 w-4" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Icon cho hai vòng quỹ đạo: ưu tiên các tool cùng nhóm với trang đích, thiếu thì lấy đại diện các nhóm khác */
function orbitIcons(categoryId?: string): [Icon[], Icon[]] {
  const own = categoryId ? getCategory(categoryId)?.items.map((t) => t.icon) ?? [] : [];
  const others = TOOL_CATEGORIES.flatMap((c) => c.items.slice(0, 2).map((t) => t.icon));
  const pool = [...own, ...others.filter((x) => !own.includes(x))];
  return [pool.slice(0, 4), pool.slice(4, 10)];
}

/** Màn hình chờ khi đang mở một trang (app/loading.tsx và lớp phủ khi chuyển trang chậm). */
export function AppLoader() {
  const pending = useSyncExternalStore(subscribeNavigation, getPendingPath, getServerPendingPath);
  // Biết trang đích (click link / router.push) thì hiện tên công cụ hoặc nhóm sắp mở
  const tool = pending ? findToolByPath(pending) : undefined;
  const category = pending ? findCategoryByPath(pending) : undefined;
  const label = tool?.name ?? category?.title;
  const Icon = tool?.icon ?? category?.icon;
  const [inner, outer] = useMemo(() => orbitIcons(category?.id), [category?.id]);

  return (
    <div role="status" aria-live="polite" className="orbit-loader">
      <div className="orbit-scene" aria-hidden="true">
        <div className="orbit-plane">
          <Ring icons={inner} radius={78} duration={9} />
          <Ring icons={outer} radius={124} duration={16} reverse />
          {/* Logo nằm trong cùng không gian 3D để icon bay phía sau bị che, phía trước thì đè lên */}
          <div className="orbit-core">
            <DrawingLogo />
          </div>
        </div>
      </div>

      <div className="orbit-caption">
        <span className="orbit-caption__hint">{label ? 'Đang mở' : 'Đang tải'}</span>
        <span className="orbit-caption__title">
          {Icon && <Icon className="h-4 w-4 shrink-0" />}
          <ScrambleText key={label ?? 'GeTools'} text={label ?? 'GeTools'} />
        </span>
        <RotatingPhrase />
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
    <div className={`orbit-overlay ${sidebarCollapsed ? 'lg:left-20' : 'lg:left-72'}`}>
      <AppLoader />
    </div>
  );
}
