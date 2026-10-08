'use client';

import { Select } from '@/components/ui/searchable-select';
import { useEffect, useMemo, useState } from 'react';
import { Timer, Copy, Check, AlertTriangle, RefreshCw } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  CRON_PRESETS,
  FIELD_LABEL,
  breakdownCron,
  describeCron,
  nextRuns,
  parseCron,
  type FieldKey,
} from '@/lib/cron';
import {
  WEEKDAYS_VI,
  formatOffset,
  formatWall,
  getOffsetMs,
  isValidTimeZone,
  listTimeZones,
  localTimeZone,
  relativeTime,
  getWallParts,
} from '@/lib/time-tools';

const inputCls =
  'px-2 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-800 outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200';

type Mode = 'any' | 'step' | 'value' | 'range' | 'list';
interface BField { mode: Mode; a: string; b: string; step: string; list: string }

const BUILDER_KEYS: FieldKey[] = ['second', 'minute', 'hour', 'dom', 'month', 'dow'];
const RANGES: Record<FieldKey, [number, number]> = {
  second: [0, 59], minute: [0, 59], hour: [0, 23], dom: [1, 31], month: [1, 12], dow: [0, 6],
};
const DOW_LABELS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

function optionsFor(key: FieldKey): { v: string; l: string }[] {
  const [lo, hi] = RANGES[key];
  const out: { v: string; l: string }[] = [];
  for (let i = lo; i <= hi; i++) {
    out.push({
      v: String(i),
      l: key === 'dow' ? `${i} - ${DOW_LABELS[i]}` : key === 'month' ? `Tháng ${i}` : String(i),
    });
  }
  return out;
}

const defaultB = (key: FieldKey): BField => ({
  mode: 'any', a: String(RANGES[key][0]), b: String(RANGES[key][1]), step: '5', list: '',
});

function buildField(f: BField): string {
  switch (f.mode) {
    case 'any': return '*';
    case 'step': return `*/${Math.max(1, parseInt(f.step, 10) || 1)}`;
    case 'value': return f.a;
    case 'range': return `${f.a}-${f.b}`;
    case 'list': return f.list.replace(/\s+/g, '') || '*';
  }
}

const MODE_LABEL: Record<Mode, string> = {
  any: 'Mọi giá trị (*)',
  step: 'Mỗi n (*/n)',
  value: 'Giá trị cụ thể',
  range: 'Khoảng (a-b)',
  list: 'Danh sách (a,b,c)',
};

export default function CronPage() {
  const { showToast } = useApp();
  const zones = useMemo(() => listTimeZones(), []);
  const [expr, setExpr] = useState('30 9 * * 1-5');
  const [withSeconds, setWithSeconds] = useState(false);
  const [tz, setTz] = useState('Asia/Ho_Chi_Minh');
  const [count, setCount] = useState(10);
  const [from, setFrom] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [builder, setBuilder] = useState<Record<FieldKey, BField>>(() => ({
    second: { ...defaultB('second'), mode: 'value', a: '0' },
    minute: defaultB('minute'), hour: defaultB('hour'), dom: defaultB('dom'),
    month: defaultB('month'), dow: defaultB('dow'),
  }));

  useEffect(() => {
    const sp = readShareParams();
    const e = sp.get('expr');
    const z = sp.get('tz');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (e) setExpr(e.slice(0, 200));
    if (sp.get('sec') === '1') setWithSeconds(true);
    setTz(z && isValidTimeZone(z) ? z : localTimeZone());
    setFrom(Date.now());
  }, []);

  const parsed = useMemo(() => parseCron(expr, withSeconds), [expr, withSeconds]);
  const n = Math.max(1, Math.min(50, count || 1));
  const runs = useMemo(
    () => (parsed.ok && from !== null ? nextRuns(parsed.spec, tz, from, n) : []),
    [parsed, tz, from, n]
  );
  const explanation = parsed.ok ? describeCron(parsed.spec) : null;
  const breakdown = parsed.ok ? breakdownCron(parsed.spec) : [];

  const tokens = expr.trim().split(/\s+/);
  const errorFields = new Set(parsed.ok ? [] : parsed.errors.map((e) => e.field));
  const keysShown: FieldKey[] = withSeconds ? BUILDER_KEYS : BUILDER_KEYS.slice(1);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(expr.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
    }
  };

  const applyBuilder = (next: Record<FieldKey, BField>, sec = withSeconds) => {
    setBuilder(next);
    const keys = sec ? BUILDER_KEYS : BUILDER_KEYS.slice(1);
    setExpr(keys.map((k) => buildField(next[k])).join(' '));
  };

  const updateB = (key: FieldKey, patch: Partial<BField>) =>
    applyBuilder({ ...builder, [key]: { ...builder[key], ...patch } });

  const toggleSeconds = (v: boolean) => {
    setWithSeconds(v);
    const t = expr.trim().split(/\s+/);
    if (expr.trim().startsWith('@')) return;
    if (v && t.length === 5) setExpr(`0 ${expr.trim()}`);
    else if (!v && t.length === 6) setExpr(t.slice(1).join(' '));
  };

  const offsetNow = from !== null && isValidTimeZone(tz) ? formatOffset(getOffsetMs(from, tz)) : '';

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <Timer className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">Cron Expression</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Giải thích biểu thức cron bằng tiếng Việt, kiểm tra lỗi và xem các lần chạy kế tiếp theo múi giờ (có tính DST).
            </p>
          </div>
        </div>
        <ShareLinkButton
          params={{ expr: expr.trim(), tz, sec: withSeconds ? '1' : '' }}
          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1"
        />
      </div>

      <section className="bg-white rounded-xl border border-slate-200 shadow-xs p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={expr}
            onChange={(e) => setExpr(e.target.value.slice(0, 200))}
            spellCheck={false}
            placeholder={withSeconds ? '0 30 9 * * 1-5' : '30 9 * * 1-5'}
            className={`flex-1 min-w-[220px] px-3 py-2 text-base font-mono rounded-lg border bg-white text-slate-800 outline-hidden focus:ring-1 ${
              parsed.ok ? 'border-slate-200 focus:border-indigo-500 focus:ring-indigo-200' : 'border-red-300 focus:border-red-500 focus:ring-red-200'
            }`}
          />
          <button
            type="button"
            onClick={copy}
            className="px-2.5 py-2 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition flex items-center gap-1"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            Sao chép
          </button>
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
            <input type="checkbox" checked={withSeconds} onChange={(e) => toggleSeconds(e.target.checked)} />
            Có trường giây (6 trường)
          </label>
        </div>

        {/* Nhãn trường căn theo token */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono">
          {(withSeconds ? BUILDER_KEYS : BUILDER_KEYS.slice(1)).map((k, i) => {
            const bad = errorFields.has(k);
            return (
              <span key={k} className={bad ? 'text-red-600' : 'text-slate-500'}>
                <span className={`px-1 rounded-sm ${bad ? 'bg-red-100' : 'bg-slate-100'}`}>{tokens[i] ?? '·'}</span>{' '}
                {FIELD_LABEL[k]}
              </span>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {CRON_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setWithSeconds(!!p.seconds);
                setExpr(p.expr);
              }}
              title={p.expr}
              className="px-2 py-1 rounded-lg text-[11px] font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition"
            >
              {p.label}
            </button>
          ))}
        </div>

        {!parsed.ok && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 space-y-1">
            {parsed.errors.map((e, i) => (
              <p key={i} className="text-xs text-red-700 flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
                <span>
                  {e.field !== 'all' && <b>{FIELD_LABEL[e.field]}: </b>}
                  {e.message}
                </span>
              </p>
            ))}
          </div>
        )}

        {parsed.ok && explanation && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
            <p className="text-sm font-semibold text-emerald-900">{explanation}</p>
            {!parsed.spec.dom.star && !parsed.spec.dow.star && !parsed.spec.dom.isAll && !parsed.spec.dow.isAll && (
              <p className="text-[11px] text-emerald-800 mt-1">
                Lưu ý: khi cả ngày-trong-tháng và thứ đều bị giới hạn, cron (Vixie) chạy khi MỘT TRONG HAI điều kiện khớp.
              </p>
            )}
          </div>
        )}
      </section>

      <div className="grid lg:grid-cols-2 gap-3.5">
        {/* Breakdown */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/60">
            <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Phân tích từng trường</h2>
          </div>
          <div className="p-3">
            {parsed.ok ? (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-1 pr-2">Trường</th>
                    <th className="py-1 pr-2">Giá trị</th>
                    <th className="py-1">Ý nghĩa</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.map((b) => (
                    <tr key={b.key} className="border-b border-slate-100 last:border-0 align-top">
                      <td className="py-1.5 pr-2 font-medium text-slate-700 whitespace-nowrap">{b.label}</td>
                      <td className="py-1.5 pr-2 font-mono text-indigo-700">{b.raw}</td>
                      <td className="py-1.5 text-slate-600">
                        {b.meaning}
                        <div className="text-[11px] text-slate-400">{b.values}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-xs text-slate-400">Sửa lỗi biểu thức để xem phân tích.</p>
            )}
          </div>
        </section>

        {/* Builder */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/60">
            <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Trình tạo cron</h2>
          </div>
          <div className="p-3 space-y-2">
            {keysShown.map((key) => {
              const b = builder[key];
              const opts = optionsFor(key);
              return (
                <div key={key} className="flex flex-wrap items-center gap-2">
                  <span className="w-28 text-xs font-medium text-slate-700 shrink-0">{FIELD_LABEL[key]}</span>
                  <Select
                    value={b.mode}
                    onChange={(e) => updateB(key, { mode: e.target.value as Mode })}
                    className={inputCls}
                  >
                    {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
                      <option key={m} value={m}>{MODE_LABEL[m]}</option>
                    ))}
                  </Select>
                  {b.mode === 'step' && (
                    <input
                      type="number" min={1} max={RANGES[key][1] + 1} value={b.step}
                      onChange={(e) => updateB(key, { step: e.target.value })}
                      className={inputCls + ' w-16'}
                    />
                  )}
                  {(b.mode === 'value' || b.mode === 'range') && (
                    <Select value={b.a} onChange={(e) => updateB(key, { a: e.target.value })} className={inputCls}>
                      {opts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                    </Select>
                  )}
                  {b.mode === 'range' && (
                    <>
                      <span className="text-xs text-slate-400">đến</span>
                      <Select value={b.b} onChange={(e) => updateB(key, { b: e.target.value })} className={inputCls}>
                        {opts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                      </Select>
                    </>
                  )}
                  {b.mode === 'list' && (
                    <input
                      value={b.list} placeholder="vd: 1,15,30"
                      onChange={(e) => updateB(key, { list: e.target.value.slice(0, 80) })}
                      className={inputCls + ' w-36 font-mono'}
                    />
                  )}
                </div>
              );
            })}
            <p className="text-[11px] text-slate-400">Thay đổi ở đây sẽ ghi trực tiếp vào ô biểu thức phía trên.</p>
          </div>
        </section>
      </div>

      {/* Next runs */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Các lần chạy kế tiếp</h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            Múi giờ
            <Select searchThreshold={0} aria-label="Múi giờ" value={tz} onChange={(e) => setTz(e.target.value)} className={inputCls + ' w-[220px]'}>
              {(zones.includes(tz) ? zones : [tz, ...zones]).map((z) => <option key={z} value={z}>{z}</option>)}
            </Select>
            {offsetNow && <span className="font-mono text-slate-400">UTC{offsetNow}</span>}
            Số lần
            <input
              type="number" min={1} max={50} value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 1)))}
              className={inputCls + ' w-16'}
            />
            <button
              type="button"
              title="Tính lại từ bây giờ"
              onClick={() => setFrom(Date.now())}
              className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 border border-slate-200 transition"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="p-3">
          {!parsed.ok ? (
            <p className="text-xs text-slate-400">Biểu thức chưa hợp lệ.</p>
          ) : runs.length === 0 ? (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Không tìm thấy lần chạy nào trong 13 năm tới (ví dụ ngày 31 của tháng chỉ có 30 ngày).
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-1 pr-3 w-8">#</th>
                    <th className="py-1 pr-3">Thời điểm ({tz})</th>
                    <th className="py-1 pr-3">Thứ</th>
                    <th className="py-1 pr-3">Offset</th>
                    <th className="py-1">Còn lại</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r, i) => (
                    <tr key={r} className="border-b border-slate-100 last:border-0">
                      <td className="py-1 pr-3 text-slate-400">{i + 1}</td>
                      <td className="py-1 pr-3 font-mono text-slate-800">{formatWall(r, tz)}</td>
                      <td className="py-1 pr-3 text-slate-600">{WEEKDAYS_VI[getWallParts(r, tz).weekday]}</td>
                      <td className="py-1 pr-3 font-mono text-slate-500">{formatOffset(getOffsetMs(r, tz))}</td>
                      <td className="py-1 text-slate-500">{relativeTime(r, from ?? r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-slate-400 mt-2">
            Giờ rơi vào khoảng trống DST (đồng hồ nhảy tới) bị bỏ qua; giờ bị lặp khi lùi đồng hồ chỉ chạy một lần.
          </p>
        </div>
      </section>
    </div>
  );
}
