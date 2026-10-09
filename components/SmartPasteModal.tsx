'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppRouter } from '@/hooks/use-app-router';
import { ClipboardPaste, CornerDownLeft, ChevronRight, ShieldCheck, Wand2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useApp } from '@/components/AppContext';
import { getTool } from '@/lib/tools';
import { detect } from '@/lib/smart-detect';
import { setHandoff } from '@/lib/handoff';

export const OPEN_SMART_PASTE_EVENT = 'getools:open-smart-paste';

const SAMPLES: { label: string; text: string }[] = [
  { label: 'JWT', text: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c' },
  { label: 'cURL', text: "curl -X POST https://api.example.com/v1/users -H 'Content-Type: application/json' -d '{\"name\":\"An\",\"age\":30}'" },
  { label: 'cron', text: '*/15 9-17 * * 1-5' },
  { label: 'SQL', text: 'SELECT u.id, u.name, COUNT(o.id) AS total FROM users u LEFT JOIN orders o ON o.user_id = u.id WHERE u.active = 1 GROUP BY u.id ORDER BY total DESC LIMIT 10;' },
  { label: 'URL', text: 'https://github.com/vercel/next.js' },
  { label: 'JSON', text: '[{"id":1,"name":"An","tags":["a","b"]},{"id":2,"name":"Bình","tags":[]}]' },
  { label: 'Timestamp', text: '1700000000' },
  { label: '.env', text: 'DB_HOST=localhost\nDB_PORT=5432\nAPI_KEY=abc123' },
  { label: 'Dockerfile', text: 'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm ci\nEXPOSE 3000\nCMD ["node", "server.js"]' },
  { label: 'Log', text: '2024-05-01 10:00:00 INFO Server started\n2024-05-01 10:00:03 WARN Slow query\n2024-05-01 10:00:07 ERROR Connection refused' },
];

function byteLen(s: string): number {
  try { return new TextEncoder().encode(s).length; } catch { return s.length; }
}
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
function countLines(s: string): number {
  let n = 1;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

export function SmartPasteModal() {
  const router = useAppRouter();
  const { showToast } = useApp();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [di, setDi] = useState(0); // detection đang mở rộng
  const [ti, setTi] = useState(0); // -1 = tiêu đề, >=0 = tool
  const [clipMsg, setClipMsg] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const detections = useMemo(() => detect(text).filter((d) => d.confidence >= 0.2).slice(0, 8), [text]);
  const bytes = useMemo(() => byteLen(text), [text]);
  const lineCount = useMemo(() => (text ? countLines(text) : 0), [text]);

  useEffect(() => {
    const onOpen = (ev: Event) => {
      const d = (ev as CustomEvent<{ text?: string } | undefined>).detail;
      setText(typeof d?.text === 'string' ? d.text : '');
      setDi(0); setTi(0); setClipMsg('');
      setOpen(true);
    };
    window.addEventListener(OPEN_SMART_PASTE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SMART_PASTE_EVENT, onOpen);
  }, []);

  const updateText = (v: string) => { setText(v); setDi(0); setTi(0); setClipMsg(''); };

  const openTarget = useCallback((d: number, t: number) => {
    const det = detections[d];
    const target = det?.targets[Math.max(0, t)];
    const tool = target && getTool(target.toolId);
    if (!tool) return;
    if (!setHandoff({ toolId: tool.id, text, source: 'Smart Paste' })) {
      showToast('Dữ liệu quá lớn để chuyển sang tool khác (tối đa khoảng 2 triệu ký tự).');
      return;
    }
    setOpen(false);
    router.push(tool.href);
  }, [detections, text, router, showToast]);

  const pasteFromClipboard = async () => {
    try {
      if (!navigator.clipboard?.readText) throw new Error('unsupported');
      const v = await navigator.clipboard.readText();
      if (!v) { setClipMsg('Clipboard đang trống.'); return; }
      updateText(v);
      taRef.current?.focus();
    } catch {
      setClipMsg('Trình duyệt không cho đọc clipboard. Hãy nhấn Ctrl+V (⌘+V) trong ô bên trên.');
      taRef.current?.focus();
    }
  };

  const move = (dir: 1 | -1) => {
    if (!detections.length) return;
    const n = detections[di]?.targets.length ?? 0;
    let d = di, t = ti;
    if (dir === 1) {
      if (t < n - 1) t++;
      else if (d < detections.length - 1) { d++; t = -1; }
    } else {
      if (t > -1 && !(t === 0 && d === 0)) t--;
      else if (t === -1 && d > 0) { d--; t = detections[d].targets.length - 1; }
    }
    setDi(d); setTi(t);
  };

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.nativeEvent.isComposing) return;
    const inTextarea = ev.target === taRef.current;
    const multiline = text.includes('\n');
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      if (inTextarea && multiline && !ev.altKey && !ev.ctrlKey && !ev.metaKey) return; // để con trỏ di chuyển trong văn bản
      ev.preventDefault();
      move(ev.key === 'ArrowDown' ? 1 : -1);
    } else if (ev.key === 'Enter') {
      if (inTextarea && multiline && !ev.ctrlKey && !ev.metaKey) return;
      if ((ev.target as HTMLElement).tagName === 'BUTTON' && !inTextarea && !(ev.target as HTMLElement).dataset.smartRow) return;
      if (!detections.length) return;
      ev.preventDefault();
      openTarget(di, ti);
    }
  };

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [di, ti]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="sm:max-w-2xl p-0 gap-0 max-h-[90vh] flex flex-col overflow-hidden"
        onKeyDown={onKeyDown}
        initialFocus={taRef}
      >
        <div className="px-5 pt-4 pb-3 shrink-0 border-b border-slate-200">
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
            <span className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Wand2 className="h-4 w-4" />
            </span>
            Smart Paste
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 mt-1">
            Dán bất cứ thứ gì, ứng dụng sẽ đoán đó là gì và mở đúng công cụ với dữ liệu điền sẵn.
          </DialogDescription>
        </div>

        <div className="px-5 py-3 space-y-3 overflow-y-auto min-h-0">
          <div>
            <textarea
              ref={taRef}
              autoFocus
              value={text}
              onChange={(e) => updateText(e.target.value)}
              spellCheck={false}
              placeholder="Dán JWT, cURL, JSON, SQL, URL, cron, log, Dockerfile... vào đây"
              className="w-full h-36 resize-y rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400"
            />
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <button
                type="button"
                onClick={pasteFromClipboard}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50"
              >
                <ClipboardPaste className="h-3.5 w-3.5" /> Dán từ clipboard
              </button>
              {text && (
                <button type="button" onClick={() => { updateText(''); taRef.current?.focus(); }} className="rounded-md px-2 py-1 hover:bg-slate-100">
                  Xóa
                </button>
              )}
              {text && <span className="ml-auto tabular-nums">{fmtBytes(bytes)} · {lineCount.toLocaleString('vi-VN')} dòng · {text.length.toLocaleString('vi-VN')} ký tự</span>}
            </div>
            {clipMsg && <p className="mt-1 text-[11px] text-amber-600">{clipMsg}</p>}
          </div>

          {!text.trim() ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-4">
              <p className="text-xs font-medium text-slate-600 mb-2">Thử mẫu: JWT, cURL, cron, SQL, URL...</p>
              <div className="flex flex-wrap gap-1.5">
                {SAMPLES.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => { updateText(s.text); taRef.current?.focus(); }}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:border-indigo-300 hover:text-indigo-600"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div ref={listRef} className="space-y-1.5" role="listbox" aria-label="Kết quả nhận diện">
              {detections.map((d, i) => {
                const expanded = i === di;
                const pct = Math.round(d.confidence * 100);
                const headerActive = expanded && ti === -1;
                return (
                  <div key={d.kind} className={`rounded-lg border ${expanded ? 'border-indigo-300 bg-indigo-50/40' : 'border-slate-200 bg-white'}`}>
                    <button
                      type="button"
                      data-smart-row="1"
                      data-active={headerActive}
                      onClick={() => { setDi(i); setTi(expanded ? -1 : 0); }}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-left rounded-lg ${headerActive ? 'ring-2 ring-indigo-400' : ''}`}
                    >
                      <ChevronRight className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-800">{d.label}</span>
                          {i === 0 && d.confidence >= 0.5 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Khả năng cao nhất</span>}
                        </span>
                        <span className="block text-xs text-slate-500 truncate">{d.reason}</span>
                      </span>
                      <span className="shrink-0 flex items-center gap-2" title={`Độ tin cậy ${pct}%`}>
                        <span className="h-1.5 w-16 rounded-full bg-slate-200 overflow-hidden">
                          <span className={`block h-full rounded-full ${pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-indigo-500' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} />
                        </span>
                        <span className="w-8 text-right text-[11px] tabular-nums text-slate-500">{pct}%</span>
                      </span>
                    </button>
                    {expanded && (
                      <div className="px-3 pb-3 grid gap-1.5 sm:grid-cols-2">
                        {d.targets.map((tg, j) => {
                          const tool = getTool(tg.toolId);
                          if (!tool) return null;
                          const Icon = tool.icon;
                          const active = ti === j;
                          return (
                            <button
                              key={tg.toolId}
                              type="button"
                              role="option"
                              aria-selected={active}
                              data-smart-row="1"
                              data-active={active}
                              onMouseEnter={() => setTi(j)}
                              onClick={() => openTarget(i, j)}
                              className={`flex items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${active ? 'border-indigo-400 bg-white ring-2 ring-indigo-300' : 'border-slate-200 bg-white hover:border-indigo-300'}`}
                            >
                              <span className="mt-0.5 h-7 w-7 shrink-0 rounded-md bg-indigo-50 text-indigo-600 flex items-center justify-center">
                                <Icon className="h-4 w-4" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-medium text-slate-800 truncate">{tool.name}</span>
                                <span className="block text-xs text-slate-500">{tg.why}</span>
                              </span>
                              {active && <CornerDownLeft className="h-3.5 w-3.5 mt-1 shrink-0 text-indigo-500" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              {detections.length === 0 && <p className="text-xs text-slate-500 py-2">Chưa nhận diện được loại dữ liệu này.</p>}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2 border-t border-slate-200 bg-slate-50 text-[10px] text-slate-500 shrink-0">
          <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-emerald-600" /> Dữ liệu chỉ xử lý trong trình duyệt</span>
          <span className="sm:ml-auto">↑↓ để chọn</span>
          <span>Enter để mở (Ctrl+Enter nếu nhiều dòng)</span>
          <span>Esc để đóng</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
