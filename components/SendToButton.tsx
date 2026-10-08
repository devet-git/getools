'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send, Bookmark, Copy, ChevronDown, ArrowRight, Check } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ALL_TOOLS, type ToolDef } from '@/lib/tools';
import { setHandoff, MAX_HANDOFF_CHARS } from '@/lib/handoff';
import { addHistory, addSnippet, defaultTitle } from '@/lib/snippets';
import { suggestTools } from '@/lib/smart-detect';

const GENERIC_TARGETS: { toolId: string; why: string }[] = [
  { toolId: 'text-tools', why: 'Đếm ký tự, làm sạch văn bản' },
  { toolId: 'compare', why: 'So sánh với nội dung khác' },
  { toolId: 'markdown-preview', why: 'Xem dưới dạng Markdown' },
];

interface Target { tool: ToolDef; why: string }

interface SendToButtonProps {
  text: string;
  fromToolId: string;
  className?: string;
}

export function SendToButton({ text, fromToolId, className = '' }: SendToButtonProps) {
  const router = useRouter();
  const { showToast } = useApp();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const empty = !text || !text.trim();
  const sourceTool = ALL_TOOLS.find((t) => t.id === fromToolId);

  const targets = useMemo<Target[]>(() => {
    if (!open || empty) return [];
    const out: Target[] = [];
    const seen = new Set<string>([fromToolId]);
    try {
      for (const s of suggestTools(text, 6)) {
        if (seen.has(s.toolId)) continue;
        const tool = ALL_TOOLS.find((t) => t.id === s.toolId);
        if (!tool) continue;
        seen.add(s.toolId);
        out.push({ tool, why: s.why });
      }
    } catch { /* gợi ý lỗi thì dùng danh sách chung */ }
    if (out.length < 4) {
      for (const g of GENERIC_TARGETS) {
        if (out.length >= 4) break;
        if (seen.has(g.toolId)) continue;
        const tool = ALL_TOOLS.find((t) => t.id === g.toolId);
        if (!tool) continue;
        seen.add(g.toolId);
        out.push({ tool, why: g.why });
      }
    }
    return out;
  }, [open, empty, text, fromToolId]);

  const close = (refocus = false) => {
    setOpen(false);
    setSaving(false);
    if (refocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSaving(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        setSaving(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const send = (t: Target) => {
    if (text.length > MAX_HANDOFF_CHARS) {
      showToast(`Nội dung quá lớn để gửi sang công cụ khác (tối đa ${MAX_HANDOFF_CHARS.toLocaleString('vi-VN')} ký tự).`);
      return;
    }
    if (!setHandoff({ toolId: t.tool.id, text, source: sourceTool?.name || 'công cụ khác' })) {
      showToast('Không thể chuyển dữ liệu sang công cụ khác.');
      return;
    }
    addHistory(fromToolId, text);
    close();
    router.push(t.tool.href);
  };

  const startSave = () => {
    setTitle(defaultTitle(text));
    setSaving(true);
  };

  const doSave = () => {
    const res = addSnippet({ toolId: fromToolId, title, text });
    if (res.ok) {
      showToast('Đã lưu vào Snippet.');
      close();
    } else {
      showToast(res.error);
    }
  };

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      showToast('Đã sao chép!');
      setTimeout(() => setCopied(false), 1500);
      close();
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  return (
    <div ref={rootRef} className={`relative inline-block ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={empty}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Gửi kết quả sang công cụ khác"
        className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-100 transition flex items-center gap-1 disabled:opacity-50"
      >
        <Send className="h-3.5 w-3.5" />
        <span>Gửi tới…</span>
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && !empty && (
        <div
          id={menuId}
          role="menu"
          aria-label="Gửi tới"
          className="absolute right-0 top-full mt-1 z-50 w-72 max-w-[85vw] rounded-xl border border-slate-200 bg-white shadow-lg p-1.5 text-left"
        >
          <div className="px-2 pt-1 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Gửi tới công cụ</div>
          {targets.map((t) => {
            const Icon = t.tool.icon;
            return (
              <button
                key={t.tool.id}
                type="button"
                role="menuitem"
                onClick={() => send(t)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-100 focus:bg-slate-100 focus:outline-hidden text-left"
              >
                <Icon className="h-4 w-4 text-indigo-600 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-slate-800 truncate">{t.tool.name}</span>
                  <span className="block text-[11px] text-slate-500 truncate">{t.why}</span>
                </span>
                <ArrowRight className="h-3 w-3 text-slate-400 shrink-0" />
              </button>
            );
          })}
          <div className="my-1 border-t border-slate-100" />
          {saving ? (
            <div className="px-2 py-1.5 space-y-1.5" role="group" aria-label="Lưu vào Snippet">
              <label className="block text-[11px] font-semibold text-slate-600" htmlFor={`${menuId}-title`}>Tiêu đề snippet</label>
              <input
                id={`${menuId}-title`}
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doSave(); } }}
                maxLength={120}
                className="w-full px-2 py-1 text-xs border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
              />
              <div className="flex justify-end gap-1.5">
                <button type="button" onClick={() => setSaving(false)} className="px-2 py-1 text-xs rounded-lg text-slate-600 hover:bg-slate-100">Hủy</button>
                <button type="button" onClick={doSave} className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white">Lưu</button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={startSave}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-100 focus:bg-slate-100 focus:outline-hidden text-xs font-semibold text-slate-700"
            >
              <Bookmark className="h-4 w-4 text-slate-500" /> Lưu vào Snippet…
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={doCopy}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-100 focus:bg-slate-100 focus:outline-hidden text-xs font-semibold text-slate-700"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4 text-slate-500" />} Sao chép
          </button>
        </div>
      )}
    </div>
  );
}
