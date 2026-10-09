'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Tooltip dùng chung cho cả app, thay cho thuộc tính `title` của trình duyệt (hiện chậm, không chỉnh được giao diện,
 * không hiện khi dùng bàn phím). Phần tử nào cần chú thích thì gắn `data-tooltip="..."`; tùy chọn
 * `data-tooltip-side="top|bottom|left|right"` (mặc định top, tự lật khi thiếu chỗ). Gắn một lần trong AppShell.
 */

type Side = 'top' | 'bottom' | 'left' | 'right';

const SHOW_DELAY_MS = 350;
const GAP = 8;
const EDGE = 8;

interface Tip {
  el: Element;
  text: string;
  side: Side;
}

function tooltipTarget(node: EventTarget | null): Element | null {
  if (!(node instanceof Element)) return null;
  const el = node.closest('[data-tooltip]');
  return el && el.getAttribute('data-tooltip')?.trim() ? el : null;
}

function sideOf(el: Element): Side {
  const s = el.getAttribute('data-tooltip-side');
  return s === 'bottom' || s === 'left' || s === 'right' ? s : 'top';
}

/** Vị trí tooltip theo phía mong muốn, lật sang phía đối diện khi tràn màn hình, kẹp trong khung nhìn */
function place(rect: DOMRect, w: number, h: number, side: Side): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let s = side;
  if (s === 'top' && rect.top - h - GAP < EDGE) s = 'bottom';
  else if (s === 'bottom' && rect.bottom + h + GAP > vh - EDGE) s = 'top';
  else if (s === 'right' && rect.right + w + GAP > vw - EDGE) s = 'left';
  else if (s === 'left' && rect.left - w - GAP < EDGE) s = 'right';

  let top: number;
  let left: number;
  if (s === 'top' || s === 'bottom') {
    top = s === 'top' ? rect.top - h - GAP : rect.bottom + GAP;
    left = rect.left + rect.width / 2 - w / 2;
  } else {
    top = rect.top + rect.height / 2 - h / 2;
    left = s === 'left' ? rect.left - w - GAP : rect.right + GAP;
  }
  return {
    top: Math.min(Math.max(EDGE, top), vh - h - EDGE),
    left: Math.min(Math.max(EDGE, left), vw - w - EDGE),
  };
}

export function TooltipHost() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const current = useRef<Element | null>(null);
  /** Phần tử vừa bấm: không hiện lại tooltip của nó cho tới khi chuột rời đi */
  const suppressed = useRef<Element | null>(null);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    current.current = null;
    setTip(null);
    setPos(null);
  }, []);

  const showFor = useCallback((el: Element, delay: number) => {
    clearTimeout(timer.current);
    current.current = el;
    timer.current = setTimeout(() => {
      if (current.current !== el || !el.isConnected) return;
      setPos(null);
      setTip({ el, text: el.getAttribute('data-tooltip') ?? '', side: sideOf(el) });
    }, delay);
  }, []);

  useEffect(() => {
    // pointermove cũng xử lý: sau khi cuộn trang (tooltip bị ẩn), rê chuột trong cùng phần tử vẫn hiện lại
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return; // màn hình cảm ứng: không có hover
      const el = tooltipTarget(e.target);
      if (el !== suppressed.current) suppressed.current = null;
      if (el === current.current || (el && el === suppressed.current)) return;
      if (!el) {
        if (current.current) hide();
        return;
      }
      showFor(el, SHOW_DELAY_MS);
    };
    const onDown = (e: PointerEvent) => {
      suppressed.current = tooltipTarget(e.target);
      hide();
    };
    const onOut = (e: PointerEvent) => {
      if (!current.current) return;
      const to = e.relatedTarget;
      if (to instanceof Node && current.current.contains(to)) return;
      hide();
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = tooltipTarget(e.target);
      // Chỉ hiện khi focus bằng bàn phím (tránh bật tooltip sau mỗi cú click chuột)
      if (el && e.target instanceof Element && e.target.matches(':focus-visible')) showFor(el, 0);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointermove', onOver, true);
    document.addEventListener('pointerout', onOut, true);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', hide, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointermove', onOver, true);
      document.removeEventListener('pointerout', onOut, true);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', hide, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [hide, showFor]);

  // Nội dung đổi khi đang hiện (vd. "Sao chép" → "Đã chép"), hoặc phần tử bị gỡ khỏi trang
  useEffect(() => {
    if (!tip) return;
    const obs = new MutationObserver(() => {
      if (!tip.el.isConnected) return hide();
      const text = tip.el.getAttribute('data-tooltip')?.trim();
      if (!text) return hide();
      if (text !== tip.text) setTip({ ...tip, text });
    });
    obs.observe(tip.el, { attributes: true, attributeFilter: ['data-tooltip'] });
    const parent = tip.el.parentNode;
    if (parent) obs.observe(parent, { childList: true });
    return () => obs.disconnect();
  }, [tip, hide]);

  // Đo kích thước thật rồi mới đặt vị trí (lần vẽ đầu ẩn để tránh nhảy)
  useLayoutEffect(() => {
    const b = bubbleRef.current;
    if (!tip || !b) return;
    const next = place(tip.el.getBoundingClientRect(), b.offsetWidth, b.offsetHeight, tip.side);
    setPos(next);
  }, [tip]);

  if (!tip || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={bubbleRef}
      role="tooltip"
      className="app-tooltip"
      style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
