'use client';

import { useState } from 'react';
import { fmtMoney, parseMoney } from '@/lib/split-bill';

/** Ô nhập tiền: gõ "25tr", "1.200.000", "500k"... và hiện số đã hiểu bên dưới. */
export function MoneyInput({ value, onChange, placeholder, className, suffix = 'đ' }: {
  value: number;
  onChange: (v: number) => void;
  placeholder?: string;
  className?: string;
  suffix?: string;
}) {
  const [text, setText] = useState(value ? String(value) : '');
  const [focused, setFocused] = useState(false);
  return (
    <div>
      <input
        inputMode="decimal"
        className={className ?? 'w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-800 outline-hidden focus:border-indigo-500'}
        placeholder={placeholder}
        value={focused ? text : value ? value.toLocaleString('vi-VN') : text}
        onFocus={() => { setFocused(true); setText(value ? String(value) : ''); }}
        onBlur={() => { setFocused(false); setText(value ? String(value) : ''); }}
        onChange={(e) => { setText(e.target.value); onChange(parseMoney(e.target.value)); }}
      />
      {focused && value > 0 && <div className="text-[11px] text-slate-500 mt-0.5">= {fmtMoney(value).replace('đ', suffix)}</div>}
    </div>
  );
}
