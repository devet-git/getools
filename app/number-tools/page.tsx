'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, Copy, Check, Upload, ArrowLeftRight, AlertTriangle, Sparkles } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ShareLinkButton } from '@/components/ShareLinkButton';
import { readShareParams } from '@/lib/share-link';
import {
  BIT_OPS,
  CLASS_LABEL,
  DUR_UNITS,
  FLOAT_FORMATS,
  IEC_UNITS,
  MAX_HEX_BYTES,
  NUM_TYPES,
  SI_UNITS,
  SPEED_UNITS,
  WIDTHS,
  applyBitOp,
  bigintToBytes,
  bitsToNumber,
  byteSwap,
  bytesToBigint,
  bytesToHex,
  decomposeBits,
  divideDecimal,
  encodeNumber,
  exactValueString,
  extractField,
  formatDuration,
  formatFloatBits,
  getBit,
  groupDigits,
  hexdump,
  hexdumpText,
  humanSize,
  interpretBytes,
  isPowerOfTwo,
  leadingZeros,
  mask,
  minBits,
  nextDown,
  nextPowerOfTwo,
  nextUp,
  numberToBits,
  parseDuration,
  parseFlags,
  parseHexBytes,
  parseHumanSize,
  parseFloatInput,
  parseInteger,
  popCount,
  reconstructionFormula,
  shortestDecimal,
  toBase,
  toggleBit,
  trailingZeros,
  transferSeconds,
  ulpString,
  utf8Decode,
  utf8Encode,
  widthInfo,
  type BitOp,
  type FloatFormatId,
  type NumType,
} from '@/lib/number-tools';

type Tab = 'base' | 'bits' | 'float' | 'size' | 'bytes';
const TABS: { id: Tab; label: string }[] = [
  { id: 'base', label: 'Đổi cơ số' },
  { id: 'bits', label: 'Bit viewer' },
  { id: 'float', label: 'IEEE-754' },
  { id: 'size', label: 'Dung lượng & thời gian' },
  { id: 'bytes', label: 'Endian & bytes' },
];

const B0 = BigInt(0);
const inputCls =
  'w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-sm font-mono outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';
const selectCls = 'px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-sm outline-hidden focus:border-indigo-500';
const btnCls =
  'px-2.5 py-1 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition flex items-center gap-1';

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const { showToast } = useApp();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title="Sao chép"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          showToast('Lỗi khi sao chép vào bộ nhớ tạm.');
        }
      }}
      className="shrink-0 p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-slate-100 transition flex items-center gap-1 text-xs"
    >
      {done ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}

function Panel({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2">
        <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">{title}</h2>
        {right}
      </div>
      <div className="p-3 space-y-2.5">{children}</div>
    </section>
  );
}

function Row({ label, value, mono = true, warn }: { label: string; value: string; mono?: boolean; warn?: boolean }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="w-24 sm:w-32 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500 pt-0.5">{label}</span>
      <span className={`flex-1 min-w-0 break-all ${mono ? 'font-mono text-xs sm:text-sm' : ''} ${warn ? 'text-amber-600' : 'text-slate-800'}`}>{value}</span>
      <CopyBtn text={value} />
    </div>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-xs px-2.5 py-1.5">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs px-2.5 py-1.5">{children}</div>;
}

function Tip({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-slate-500">Mẹo: {children}</p>;
}

/** Cắt chuỗi quá dài khi hiển thị. */
function clip(s: string, n = 4000) {
  return s.length > n ? s.slice(0, n) + `… (+${s.length - n} ký tự, dùng nút sao chép để lấy đủ)` : s;
}

/* ================================================================ */
/* TAB 1: Đổi cơ số                                                 */
/* ================================================================ */

function BaseTab({ initial, onShare }: { initial: URLSearchParams; onShare: (p: Record<string, string>) => void }) {
  const [text, setText] = useState(initial.get('v') ?? '0xDEADBEEF');
  const [baseSel, setBaseSel] = useState(initial.get('b') ?? '16');
  const [custom, setCustom] = useState('7');
  const [width, setWidth] = useState(Number(initial.get('w')) || 32);
  const base = baseSel === 'custom' ? Number(custom) : Number(baseSel);

  const parsed = useMemo(() => parseInteger(text, base), [text, base]);
  useEffect(() => onShare({ v: text, b: baseSel === 'custom' ? custom : baseSel, w: String(width) }), [text, baseSel, custom, width, onShare]);

  const v = parsed.ok ? parsed.value : B0;
  const info = parsed.ok ? widthInfo(v, width) : null;
  const mb = parsed.ok ? minBits(v) : null;
  const neg = parsed.ok && v < B0;

  return (
    <div className="grid lg:grid-cols-2 gap-3">
      <div className="space-y-3">
        <Panel title="Nhập số">
          <div className="flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              placeholder="vd: 0xFF, 0b1010_1010, -123, 1 000 000"
              aria-label="Số cần đổi"
              className={inputCls}
            />
            <select value={baseSel} onChange={(e) => setBaseSel(e.target.value)} className={selectCls} aria-label="Cơ số nhập">
              {['2', '8', '10', '16', '32', '36'].map((b) => (
                <option key={b} value={b}>
                  Cơ số {b}
                </option>
              ))}
              <option value="custom">Tuỳ chọn…</option>
            </select>
            {baseSel === 'custom' && (
              <input type="number" min={2} max={36} value={custom} onChange={(e) => setCustom(e.target.value)} className={`${inputCls} w-20`} aria-label="Cơ số tuỳ chọn" />
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {['0x7fffffffffffffff', '-1', '255', '0b1111_0000', '123456789012345678901234567890'].map((s) => (
              <button key={s} onClick={() => { setText(s); if (!s.startsWith('0') || s.length === 1) setBaseSel('10'); }} className={btnCls}>
                {s.length > 16 ? s.slice(0, 14) + '…' : s}
              </button>
            ))}
          </div>
          {!parsed.ok && text.trim() !== '' && <ErrorBox>{parsed.error}</ErrorBox>}
          {parsed.ok && parsed.prefix && <p className="text-xs text-slate-500">Tiền tố {parsed.prefix} → đọc theo cơ số {parsed.base}.</p>}
          <Tip>chấp nhận tiền tố 0x/0b/0o, dấu _ hoặc khoảng trắng ngăn cách, số âm, độ dài tuỳ ý (tối đa 20.000 chữ số).</Tip>
        </Panel>

        {parsed.ok && (
          <Panel title="Các cơ số">
            <Row label="Nhị phân (2)" value={clip(groupDigits(toBase(v, 2), 4))} />
            <Row label="Bát phân (8)" value={clip(groupDigits(toBase(v, 8), 3))} />
            <Row label="Thập phân (10)" value={clip(groupDigits(toBase(v, 10), 3, ','))} />
            <Row label="Thập lục (16)" value={clip(groupDigits(toBase(v, 16).toUpperCase(), 2))} />
            <Row label="Base32 (0-9a-v)" value={clip(toBase(v, 32))} />
            <Row label="Base36 (0-9a-z)" value={clip(toBase(v, 36))} />
            {baseSel === 'custom' && base >= 2 && base <= 36 && <Row label={`Cơ số ${base}`} value={clip(toBase(v, base))} />}
          </Panel>
        )}
      </div>

      {parsed.ok && info && mb && (
        <div className="space-y-3">
          <Panel
            title="Bù hai & kiểu có/không dấu"
            right={
              <select value={width} onChange={(e) => setWidth(Number(e.target.value))} className={selectCls} aria-label="Độ rộng bit">
                {WIDTHS.map((w) => (
                  <option key={w} value={w}>
                    {w} bit
                  </option>
                ))}
              </select>
            }
          >
            <Row label={`Bù 2 (${width} bit)`} value={groupDigits(info.bin, 4)} />
            <Row label="Hex" value={groupDigits(info.hex, 2)} />
            <Row label="Không dấu" value={info.unsigned.toString()} />
            <Row label="Có dấu" value={info.signed.toString()} />
            {info.overflow && (
              <Warn>
                Tràn: giá trị {clip(v.toString(), 60)} không vừa {width} bit (cả có dấu lẫn không dấu); kết quả ở trên đã bị cắt bớt.
              </Warn>
            )}
            {!info.overflow && !(info.fitsSigned && info.fitsUnsigned) && (
              <Warn>
                {neg || !info.fitsSigned
                  ? info.fitsSigned
                    ? 'Số âm: chỉ hợp lệ khi hiểu theo kiểu có dấu; kiểu không dấu sẽ đọc thành số dương lớn.'
                    : `Chỉ vừa kiểu không dấu ${width} bit; hiểu theo kiểu có dấu sẽ thành số âm (${info.signed}).`
                  : ''}
              </Warn>
            )}
            <p className="text-xs text-slate-500">
              Cần tối thiểu {mb.unsigned} bit (không dấu) hoặc {mb.signed} bit (có dấu, bù 2). Tổng {Math.ceil(mb.unsigned / 8)} byte.
            </p>
          </Panel>
          <Panel title="Tất cả độ rộng">
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="pr-2 font-semibold">Bit</th>
                    <th className="pr-2 font-semibold">Hex</th>
                    <th className="pr-2 font-semibold">Không dấu</th>
                    <th className="font-semibold">Có dấu</th>
                  </tr>
                </thead>
                <tbody>
                  {WIDTHS.map((w) => {
                    const i = widthInfo(v, w);
                    return (
                      <tr key={w} className={`border-t border-slate-100 ${i.overflow ? 'text-amber-600' : 'text-slate-800'}`}>
                        <td className="pr-2 py-1">{w}</td>
                        <td className="pr-2 break-all">{i.hex}</td>
                        <td className="pr-2 break-all">{i.unsigned.toString()}</td>
                        <td className="break-all">{i.signed.toString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

/* ================================================================ */
/* TAB 2: Bit viewer                                                */
/* ================================================================ */

function BitsTab({ initial, onShare }: { initial: URLSearchParams; onShare: (p: Record<string, string>) => void }) {
  const [width, setWidth] = useState(Number(initial.get('w')) || 32);
  const [val, setVal] = useState<bigint>(() => {
    const r = parseInteger(initial.get('v') ?? '0xA5', 16);
    return r.ok ? BigInt.asUintN(64, r.value) : B0;
  });
  const [opB, setOpB] = useState('0x0F');
  const [op, setOp] = useState<BitOp>('and');
  const [fStart, setFStart] = useState('4');
  const [fLen, setFLen] = useState('4');
  const [flagsText, setFlagsText] = useState('READ=0\nWRITE=1\nEXEC=2\nHIDDEN=7');
  const [hexIn, setHexIn] = useState('');
  const [decIn, setDecIn] = useState('');
  const [binIn, setBinIn] = useState('');
  const [editing, setEditing] = useState<'hex' | 'dec' | 'bin' | null>(null);

  const m = mask(width);
  const a = val & m;
  useEffect(() => onShare({ v: '0x' + a.toString(16), w: String(width) }), [a, width, onShare]);

  const sync = (nv: bigint) => {
    setVal(nv & mask(width));
    setEditing(null);
  };
  const edit = (kind: 'hex' | 'dec' | 'bin', raw: string) => {
    if (kind === 'hex') setHexIn(raw);
    if (kind === 'dec') setDecIn(raw);
    if (kind === 'bin') setBinIn(raw);
    setEditing(kind);
    const r = parseInteger(raw, kind === 'hex' ? 16 : kind === 'dec' ? 10 : 2);
    if (r.ok) setVal(BigInt.asUintN(width, r.value));
  };
  const shownHex = editing === 'hex' ? hexIn : a.toString(16).toUpperCase().padStart(width / 4, '0');
  const shownDec = editing === 'dec' ? decIn : a.toString();
  const shownBin = editing === 'bin' ? binIn : a.toString(2).padStart(width, '0');

  const bParsed = parseInteger(opB, 10);
  const bVal = bParsed.ok ? BigInt.asUintN(Math.max(width, 64), bParsed.value) : B0;
  const spec = BIT_OPS.find((o) => o.id === op)!;
  const result = bParsed.ok || spec.unary ? applyBitOp(op, a, bVal, width) : null;

  const field = extractField(a, Number(fStart), Number(fLen), width);
  const flags = parseFlags(flagsText, width);
  const bytes = width / 8;

  return (
    <div className="grid lg:grid-cols-5 gap-3">
      <div className="lg:col-span-3 space-y-3">
        <Panel
          title="Lưới bit (bấm để đảo)"
          right={
            <div className="flex gap-1">
              {[8, 16, 32, 64].map((w) => (
                <button
                  key={w}
                  onClick={() => { setWidth(w); setVal((x) => x & mask(w)); setEditing(null); }}
                  className={`px-2 py-0.5 rounded-md text-xs font-medium border transition ${width === w ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'}`}
                >
                  {w}
                </button>
              ))}
            </div>
          }
        >
          <div className="flex flex-wrap gap-x-3 gap-y-2">
            {Array.from({ length: bytes }, (_, bi) => {
              const byteIdx = bytes - 1 - bi;
              return (
                <div key={bi} className="flex gap-0.5 rounded-lg bg-slate-50 border border-slate-100 p-1">
                  {Array.from({ length: 8 }, (_, k) => {
                    const idx = byteIdx * 8 + 7 - k;
                    const on = getBit(a, idx);
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => sync(toggleBit(a, idx))}
                        aria-label={`Bit ${idx} = ${on ? 1 : 0}`}
                        aria-pressed={on}
                        className="flex flex-col items-center"
                      >
                        <span className="text-[9px] text-slate-400 leading-none mb-0.5">{idx}</span>
                        <span
                          className={`h-7 w-6 sm:w-7 rounded-md flex items-center justify-center text-xs font-mono font-bold border transition ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-400 border-slate-200 hover:border-indigo-400'}`}
                        >
                          {on ? 1 : 0}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button className={btnCls} onClick={() => sync(B0)}>Xoá hết</button>
            <button className={btnCls} onClick={() => sync(m)}>Bật hết</button>
            <button className={btnCls} onClick={() => sync(applyBitOp('not', a, B0, width))}>Đảo (~)</button>
          </div>
          <div className="grid sm:grid-cols-3 gap-2">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Hex
              <input className={inputCls} value={shownHex} onChange={(e) => edit('hex', e.target.value)} onBlur={() => setEditing(null)} spellCheck={false} />
            </label>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Thập phân
              <input className={inputCls} value={shownDec} onChange={(e) => edit('dec', e.target.value)} onBlur={() => setEditing(null)} spellCheck={false} />
            </label>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Nhị phân
              <input className={inputCls} value={shownBin} onChange={(e) => edit('bin', e.target.value)} onBlur={() => setEditing(null)} spellCheck={false} />
            </label>
          </div>
          <Row label="Có dấu" value={BigInt.asIntN(width, a).toString()} />
          <Row label="Không dấu" value={a.toString()} />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            {[
              ['Số bit 1', popCount(a, width)],
              ['Zero đầu (clz)', leadingZeros(a, width)],
              ['Zero cuối (ctz)', trailingZeros(a, width)],
              ['Luỹ thừa của 2?', isPowerOfTwo(a) ? `Có (2^${trailingZeros(a, width)})` : 'Không'],
            ].map(([k, v2]) => (
              <div key={String(k)} className="rounded-lg bg-slate-50 border border-slate-100 py-1.5">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">{k}</div>
                <div className="text-sm font-mono font-bold text-slate-800">{v2}</div>
              </div>
            ))}
          </div>
          <Row label="Luỹ thừa 2 kế tiếp" value={nextPowerOfTwo(a).toString() + (nextPowerOfTwo(a) > m ? ' (vượt độ rộng)' : '')} />
        </Panel>
      </div>

      <div className="lg:col-span-2 space-y-3">
        <Panel title="Phép toán bit">
          <div className="flex gap-2">
            <select value={op} onChange={(e) => setOp(e.target.value as BitOp)} className={selectCls} aria-label="Phép toán">
              {BIT_OPS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            {!spec.unary && (
              <input className={inputCls} value={opB} onChange={(e) => setOpB(e.target.value)} placeholder={spec.shift ? 'n (số bit)' : 'B (0x…, 0b…, thập phân)'} aria-label="Toán hạng B" spellCheck={false} />
            )}
          </div>
          {!spec.unary && !bParsed.ok && <ErrorBox>{bParsed.error}</ErrorBox>}
          {result !== null && (
            <>
              <Row label="Nhị phân" value={groupDigits(result.toString(2).padStart(width, '0'), 4)} />
              <Row label="Hex" value={'0x' + result.toString(16).toUpperCase().padStart(width / 4, '0')} />
              <Row label="Không dấu" value={result.toString()} />
              <Row label="Có dấu" value={BigInt.asIntN(width, result).toString()} />
              <button className={btnCls} onClick={() => sync(result)}>
                <ArrowLeftRight className="h-3 w-3" /> Dùng kết quả làm A
              </button>
            </>
          )}
          <Tip>với phép dịch/xoay, B là số bit cần dịch; &gt;&gt; giữ bit dấu, &gt;&gt;&gt; điền 0.</Tip>
        </Panel>

        <Panel title="Trích trường bit">
          <div className="flex gap-2 items-center text-xs text-slate-600">
            Bit bắt đầu
            <input className={`${inputCls} w-16`} value={fStart} onChange={(e) => setFStart(e.target.value)} inputMode="numeric" aria-label="Bit bắt đầu" />
            Độ dài
            <input className={`${inputCls} w-16`} value={fLen} onChange={(e) => setFLen(e.target.value)} inputMode="numeric" aria-label="Độ dài" />
          </div>
          {field.ok ? (
            <>
              <Row label="Giá trị" value={`${field.value} (0x${field.value.toString(16).toUpperCase()})`} />
              <Row label="Có dấu" value={field.signed.toString()} />
              <Row label="Nhị phân" value={field.value.toString(2).padStart(Number(fLen), '0')} />
            </>
          ) : (
            <ErrorBox>{field.error}</ErrorBox>
          )}
        </Panel>

        <Panel title="Cờ có tên (flags)">
          <textarea
            value={flagsText}
            onChange={(e) => setFlagsText(e.target.value)}
            rows={4}
            spellCheck={false}
            aria-label="Định nghĩa cờ"
            placeholder="READ=0, WRITE=1…"
            className={inputCls}
          />
          {flags.ok ? (
            <div className="flex flex-wrap gap-1.5">
              {flags.flags.length === 0 && <span className="text-xs text-slate-500">Chưa có cờ nào. Cú pháp: TÊN=số_bit (mỗi dòng hoặc ngăn bằng dấu phẩy).</span>}
              {[...flags.flags].sort((x, y) => x.bit - y.bit).map((f) => {
                const on = getBit(a, f.bit);
                return (
                  <button
                    key={f.name}
                    onClick={() => sync(toggleBit(a, f.bit))}
                    className={`px-2 py-0.5 rounded-md text-xs font-mono border transition ${on ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'bg-slate-50 text-slate-500 border-slate-200'}`}
                  >
                    {f.name} <span className="opacity-60">[{f.bit}]</span> = {on ? 1 : 0}
                  </button>
                );
              })}
            </div>
          ) : (
            <ErrorBox>{flags.error}</ErrorBox>
          )}
        </Panel>
      </div>
    </div>
  );
}

/* ================================================================ */
/* TAB 3: IEEE-754                                                  */
/* ================================================================ */

function FloatTab({ initial, onShare }: { initial: URLSearchParams; onShare: (p: Record<string, string>) => void }) {
  const [fid, setFid] = useState<FloatFormatId>((['f16', 'f32', 'f64'].includes(initial.get('f') ?? '') ? initial.get('f') : 'f64') as FloatFormatId);
  const [text, setText] = useState(initial.get('v') ?? '0.1');
  const fmt = FLOAT_FORMATS[fid];
  useEffect(() => onShare({ v: text, f: fid }), [text, fid, onShare]);

  const input = useMemo(() => parseFloatInput(text, fmt), [text, fmt]);
  const bits = input.ok ? input.bits : B0;
  const p = decomposeBits(bits, fmt);
  const fb = formatFloatBits(bits, fmt);
  const up = nextUp(bits, fmt);
  const down = nextDown(bits, fmt);
  const ulp = ulpString(p);

  const demoSum = 0.1 + 0.2;
  const demo64 = numberToBits(demoSum, FLOAT_FORMATS.f64);
  const demo3 = numberToBits(0.3, FLOAT_FORMATS.f64);

  const nb = (b: bigint | null) =>
    b === null ? '—' : `${formatFloatBits(b, fmt).hex}  →  ${shortestDecimal(b, fmt)}`;

  return (
    <div className="grid lg:grid-cols-2 gap-3">
      <div className="space-y-3">
        <Panel
          title="Nhập giá trị"
          right={
            <div className="flex gap-1">
              {(['f16', 'f32', 'f64'] as FloatFormatId[]).map((id) => (
                <button
                  key={id}
                  onClick={() => setFid(id)}
                  className={`px-2 py-0.5 rounded-md text-xs font-medium border transition ${fid === id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'}`}
                >
                  {id === 'f16' ? 'float16' : id === 'f32' ? 'float32' : 'float64'}
                </button>
              ))}
            </div>
          }
        >
          <input value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="Giá trị" placeholder="0.1, 1e-5, NaN, -Infinity hoặc 0x3FB999999999999A" className={inputCls} />
          <div className="flex flex-wrap gap-1.5">
            {['0.1', '0.3', '1', '-0', '5e-324', '1e308', 'NaN', 'Infinity', '16777217'].map((s) => (
              <button key={s} onClick={() => setText(s)} className={btnCls}>
                {s}
              </button>
            ))}
          </div>
          {!input.ok && text.trim() !== '' && <ErrorBox>{input.error}</ErrorBox>}
          {input.ok && input.source === 'decimal' && input.typed !== undefined && fid !== 'f64' && (
            <p className="text-[11px] text-slate-500">Chuỗi thập phân được đọc qua double rồi làm tròn về {fid}.</p>
          )}
          <Tip>nhập mẫu bit dạng hex (0x…) hoặc nhị phân (0b…) để xem chính xác số đó biểu diễn gì.</Tip>
        </Panel>

        {input.ok && (
          <Panel title="Bit: dấu | mũ | mantissa">
            <div className="font-mono text-sm break-all leading-relaxed">
              <span className="text-red-600 font-bold" title="Dấu">{fb.sign}</span>{' '}
              <span className="text-emerald-600 font-bold" title="Số mũ">{fb.exp}</span>{' '}
              <span className="text-indigo-600" title="Mantissa">{fb.mant}</span>
            </div>
            <div className="flex gap-3 text-[11px]">
              <span className="text-red-600">■ dấu (1 bit)</span>
              <span className="text-emerald-600">■ mũ ({fmt.expBits} bit)</span>
              <span className="text-indigo-600">■ mantissa ({fmt.mantBits} bit)</span>
            </div>
            <Row label="Hex" value={fb.hex} />
            <Row label="Loại" value={CLASS_LABEL[p.cls] + (p.cls === 'nan' ? (p.quietNaN ? ' — quiet' : ' — signaling') : '')} mono={false} />
            <Row label="Dấu" value={`${p.sign} (${p.sign ? 'âm' : 'dương'})`} />
            <Row label="Mũ (thiên lệch)" value={`${p.expField} (0b${p.expField.toString(2).padStart(fmt.expBits, '0')})`} />
            <Row label="Mũ (thực)" value={p.unbiased === null ? '—' : `${p.unbiased} = ${p.expField} − ${fmt.bias}${p.cls === 'subnormal' ? ' (subnormal dùng 1 − bias)' : ''}`} />
            <Row label="Mantissa" value={`${p.mantissa} (0x${p.mantissa.toString(16).toUpperCase()})`} />
            {p.cls === 'nan' && <Row label="Payload NaN" value={`0x${(p.mantissa & mask(fmt.mantBits - 1)).toString(16).toUpperCase()}`} />}
          </Panel>
        )}
      </div>

      <div className="space-y-3">
        {input.ok && (
          <Panel title="Giá trị">
            <Row label="Công thức" value={reconstructionFormula(p)} mono={false} />
            <Row label="Ngắn nhất" value={shortestDecimal(bits, fmt)} />
            <Row label="Chính xác" value={clip(exactValueString(p))} />
            {p.cls !== 'nan' && p.cls !== 'infinity' && (
              <p className="text-[11px] text-slate-500">
                Giá trị lưu thực sự là số thập phân chính xác ở trên ({exactValueString(p).replace(/^-/, '').replace('.', '').length} chữ số), không phải chuỗi bạn gõ.
              </p>
            )}
            {p.cls === 'normal' || p.cls === 'subnormal' || p.cls === 'zero' ? (
              <Row label="ULP" value={ulp ? `2^${p.q} = ${clip(ulp, 300)}` : '—'} />
            ) : null}
            <Row label="Số kế tiếp (↑)" value={nb(up)} />
            <Row label="Số liền trước (↓)" value={nb(down)} />
            <Row label="Kiểm chứng" value={`DataView: ${String(bitsToNumber(bits, fmt))}`} />
          </Panel>
        )}
        <Panel title="Ví dụ kinh điển: 0.1 + 0.2">
          <div className="text-sm font-mono space-y-1 break-all">
            <div>0.1 + 0.2 = <b>{String(demoSum)}</b></div>
            <div>0.3 = <b>{String(0.3)}</b></div>
            <div>0.1 + 0.2 === 0.3 → <b className="text-red-600">{String(demoSum === 0.3)}</b></div>
            <div className="text-xs text-slate-600">bit (0.1+0.2): {formatFloatBits(demo64, FLOAT_FORMATS.f64).hex}</div>
            <div className="text-xs text-slate-600">bit (0.3): &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{formatFloatBits(demo3, FLOAT_FORMATS.f64).hex}</div>
            <div className="text-xs text-slate-600">
              chênh nhau {String(demo64 - demo3)} ULP; giá trị chính xác của tổng: {exactValueString(decomposeBits(demo64, FLOAT_FORMATS.f64))}
            </div>
          </div>
          <div className="flex gap-1.5">
            <button className={btnCls} onClick={() => { setFid('f64'); setText('0.30000000000000004'); }}>
              <Sparkles className="h-3 w-3 text-amber-500" /> Phân tích 0.1+0.2
            </button>
            <button className={btnCls} onClick={() => { setFid('f64'); setText('0.3'); }}>
              Phân tích 0.3
            </button>
          </div>
          <Tip>so sánh số thực nên dùng sai số (epsilon) hoặc số nguyên (vd. đếm bằng xu thay vì đồng).</Tip>
        </Panel>
      </div>
    </div>
  );
}

/* ================================================================ */
/* TAB 4: Dung lượng & thời gian                                    */
/* ================================================================ */

function SizeTab({ initial, onShare }: { initial: URLSearchParams; onShare: (p: Record<string, string>) => void }) {
  const [text, setText] = useState(initial.get('v') ?? '1.5 GiB');
  const [speed, setSpeed] = useState('100');
  const [speedUnit, setSpeedUnit] = useState('mbps');
  const [eff, setEff] = useState('90');
  const [dur, setDur] = useState('1h30m');
  useEffect(() => onShare({ v: text }), [text, onShare]);

  const size = useMemo(() => parseHumanSize(text), [text]);
  const bytes = size.ok ? size.bytes : B0;
  const unit = SPEED_UNITS.find((u) => u.id === speedUnit)!;
  const secs = size.ok ? transferSeconds(bytes, Number(speed), unit, Number(eff) / 100) : NaN;
  const d = useMemo(() => parseDuration(dur), [dur]);

  return (
    <div className="grid lg:grid-cols-2 gap-3">
      <div className="space-y-3">
        <Panel title="Dung lượng: SI (1000) và IEC (1024)">
          <input value={text} onChange={(e) => setText(e.target.value)} className={inputCls} spellCheck={false} aria-label="Dung lượng" placeholder="1.5 GiB, 300kb, 2 MB, 512 bytes" />
          {!size.ok && text.trim() !== '' && <ErrorBox>{size.error}</ErrorBox>}
          {size.ok && (
            <>
              <Row label="Byte" value={bytes.toString()} />
              <Row label="Bit" value={(size.exactBits ?? bytes * BigInt(8)).toString()} />
              <Row label="Dễ đọc (SI)" value={humanSize(bytes, 'SI')} />
              <Row label="Dễ đọc (IEC)" value={humanSize(bytes, 'IEC')} />
              <div className="grid grid-cols-2 gap-x-3 text-xs font-mono">
                <div>
                  {SI_UNITS.slice(1).map((u) => (
                    <div key={u.name} className="flex justify-between border-t border-slate-100 py-1">
                      <span className="text-slate-500">{u.name}</span>
                      <span className="break-all text-right">{divideDecimal(bytes, u.factor, 9)}</span>
                    </div>
                  ))}
                </div>
                <div>
                  {IEC_UNITS.slice(1).map((u) => (
                    <div key={u.name} className="flex justify-between border-t border-slate-100 py-1">
                      <span className="text-slate-500">{u.name}</span>
                      <span className="break-all text-right">{divideDecimal(bytes, u.factor, 9)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          <Tip>&quot;kb&quot;, &quot;MB&quot; đọc không phân biệt hoa/thường và hiểu là byte (KB = 1000, KiB = 1024). Thêm &quot;bit&quot; để tính theo bit: &quot;8 Mbit&quot;.</Tip>
        </Panel>
      </div>
      <div className="space-y-3">
        <Panel title="Ước tính thời gian truyền">
          <div className="flex flex-wrap gap-2 items-center text-xs text-slate-600">
            Tốc độ
            <input className={`${inputCls} w-24`} value={speed} onChange={(e) => setSpeed(e.target.value)} inputMode="decimal" aria-label="Tốc độ" />
            <select value={speedUnit} onChange={(e) => setSpeedUnit(e.target.value)} className={selectCls} aria-label="Đơn vị tốc độ">
              {SPEED_UNITS.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
            Hiệu suất
            <input className={`${inputCls} w-16`} value={eff} onChange={(e) => setEff(e.target.value)} inputMode="decimal" aria-label="Hiệu suất (%)" />%
          </div>
          {size.ok ? (
            Number.isFinite(secs) ? (
              <>
                <Row label="Thời gian" value={formatDuration(secs * 1000)} mono={false} />
                <Row label="Tổng giây" value={String(+secs.toFixed(3))} />
                <Row label="Tốc độ thực" value={`${+((Number(speed) * unit.bps * (Number(eff) / 100)) / 8e6).toFixed(3)} MB/s`} />
              </>
            ) : (
              <ErrorBox>Tốc độ và hiệu suất phải là số dương.</ErrorBox>
            )
          ) : (
            <p className="text-xs text-slate-500">Nhập dung lượng ở khung bên trái.</p>
          )}
          <Tip>Mbps là megabit/giây; chia 8 để ra MB/s. Hiệu suất ~90% mô phỏng overhead giao thức.</Tip>
        </Panel>
        <Panel title="Thời lượng">
          <input value={dur} onChange={(e) => setDur(e.target.value)} className={inputCls} spellCheck={false} aria-label="Thời lượng" placeholder="1h30m, 90 phút, 1.5d, 2d 3h, 1500ms" />
          {d.ok ? (
            <>
              <Row label="Dễ đọc" value={formatDuration(d.ms)} mono={false} />
              {DUR_UNITS.map((u) => (
                <Row key={u.id} label={u.label} value={String(+(d.ms / u.ms).toPrecision(12))} />
              ))}
            </>
          ) : (
            dur.trim() !== '' && <ErrorBox>{d.error}</ErrorBox>
          )}
        </Panel>
      </div>
    </div>
  );
}

/* ================================================================ */
/* TAB 5: Endian & bytes                                            */
/* ================================================================ */

const PAGE_BYTES = 4096;

function BytesTab({ initial, onShare }: { initial: URLSearchParams; onShare: (p: Record<string, string>) => void }) {
  const { showToast } = useApp();
  const [numText, setNumText] = useState(initial.get('v') ?? '0x12345678');
  const [ntype, setNtype] = useState<NumType>('u32');
  const [strText, setStrText] = useState('Xin chào, thế giới!');
  const [hexIn, setHexIn] = useState('78 56 34 12');
  const [little, setLittle] = useState(true);
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [page, setPage] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => onShare({ v: numText }), [numText, onShare]);

  const nt = NUM_TYPES.find((t) => t.id === ntype)!;
  const numBE = useMemo(() => encodeNumber(numText, ntype, false), [numText, ntype]);
  const numLE = useMemo(() => encodeNumber(numText, ntype, true), [numText, ntype]);

  const strBytes = useMemo(() => utf8Encode(strText.slice(0, 100000)), [strText]);
  const hexParsed = useMemo(() => parseHexBytes(hexIn), [hexIn]);
  const hb = hexParsed.ok ? hexParsed.bytes : null;
  const dumpSource = file ? file.bytes : strBytes;
  const pages = Math.max(1, Math.ceil(dumpSource.length / PAGE_BYTES));
  const pg = Math.min(page, pages - 1);
  const lines = useMemo(() => hexdump(dumpSource, { start: pg * PAGE_BYTES, length: PAGE_BYTES }), [dumpSource, pg]);

  const loadFile = async (f: File) => {
    if (f.size > MAX_HEX_BYTES) {
      showToast('File quá lớn (tối đa 5MB).');
      return;
    }
    try {
      setFile({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
      setPage(0);
    } catch {
      showToast('Không đọc được file.');
    }
  };

  const decoded = hb ? utf8Decode(hb) : null;

  return (
    <div className="grid lg:grid-cols-2 gap-3">
      <div className="space-y-3">
        <Panel
          title="Số → byte"
          right={
            <select value={ntype} onChange={(e) => setNtype(e.target.value as NumType)} className={selectCls} aria-label="Kiểu số">
              {NUM_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.id}
                </option>
              ))}
            </select>
          }
        >
          <input value={numText} onChange={(e) => setNumText(e.target.value)} className={inputCls} spellCheck={false} aria-label="Số" placeholder="0x12345678, -1, 3.14" />
          {numBE.ok && numLE.ok ? (
            <>
              <Row label="Big-endian" value={bytesToHex(numBE.bytes)} />
              <Row label="Little-endian" value={bytesToHex(numLE.bytes)} />
              <Row label="Đảo byte" value={bytesToHex(byteSwap(numBE.bytes))} />
              <p className="text-[11px] text-slate-500">
                {nt.size} byte. Big-endian: byte quan trọng nhất đứng trước (thứ tự mạng). Little-endian: x86/ARM thường dùng.
              </p>
            </>
          ) : (
            numText.trim() !== '' && <ErrorBox>{numBE.ok ? (numLE.ok ? '' : numLE.error) : numBE.error}</ErrorBox>
          )}
        </Panel>

        <Panel title="Chuỗi UTF-8 → byte">
          <textarea value={strText} onChange={(e) => setStrText(e.target.value)} rows={2} className={inputCls} aria-label="Chuỗi" />
          <Row label="Số byte" value={`${strBytes.length} byte (${[...strText].length} ký tự)`} mono={false} />
          <Row label="Hex" value={clip(bytesToHex(strBytes.subarray(0, 2000)))} />
          <Tip>chữ có dấu tiếng Việt chiếm 2–3 byte trong UTF-8; emoji 4 byte.</Tip>
        </Panel>
      </div>

      <div className="space-y-3">
        <Panel
          title="Chuỗi hex → giá trị"
          right={
            <div className="flex gap-1">
              {[true, false].map((l) => (
                <button
                  key={String(l)}
                  onClick={() => setLittle(l)}
                  className={`px-2 py-0.5 rounded-md text-xs font-medium border transition ${little === l ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'}`}
                >
                  {l ? 'Little' : 'Big'}-endian
                </button>
              ))}
            </div>
          }
        >
          <input value={hexIn} onChange={(e) => setHexIn(e.target.value)} className={inputCls} spellCheck={false} aria-label="Chuỗi hex" placeholder="DE AD BE EF, 0xDEADBEEF, \xDE\xAD" />
          {!hexParsed.ok && hexIn.trim() !== '' && <ErrorBox>{hexParsed.error}</ErrorBox>}
          {hb && decoded && (
            <>
              <Row label="Số byte" value={String(hb.length)} />
              <Row label="Đảo byte" value={bytesToHex(byteSwap(hb))} />
              {hb.length <= 64 && <Row label="Số nguyên lớn" value={`${bytesToBigint(hb, little)}`} />}
              {NUM_TYPES.map((t) => {
                const out = hb.length >= t.size ? interpretBytes(hb, t.id, little) : null;
                return out === null ? null : (
                  <Row
                    key={t.id}
                    label={t.id}
                    value={out}
                    warn={hb.length > t.size}
                  />
                );
              })}
              {hb.length > 1 && <p className="text-[11px] text-slate-500">Các kiểu ngắn hơn số byte nhập chỉ đọc phần đầu (dòng cam).</p>}
              <Row label="Văn bản UTF-8" value={clip(decoded.text, 500) + (decoded.valid ? '' : '  (có byte không hợp lệ → �)')} mono={false} warn={!decoded.valid} />
            </>
          )}
        </Panel>
      </div>

      <div className="lg:col-span-2">
        <Panel
          title={`Hexdump${file ? ` — ${file.name} (${file.bytes.length} byte)` : ' của chuỗi UTF-8'}`}
          right={
            <div className="flex gap-1.5">
              <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadFile(f); e.target.value = ''; }} />
              <button className={btnCls} onClick={() => fileRef.current?.click()}>
                <Upload className="h-3 w-3" /> Chọn file (≤5MB)
              </button>
              {file && (
                <button className={btnCls} onClick={() => { setFile(null); setPage(0); }}>
                  Dùng chuỗi
                </button>
              )}
              <CopyBtn text={hexdumpText(dumpSource, { start: pg * PAGE_BYTES, length: PAGE_BYTES })} label="Chép trang" />
            </div>
          }
        >
          <pre className="bg-slate-900 text-slate-100 rounded-lg p-3 text-xs font-mono overflow-x-auto leading-relaxed max-h-[420px] overflow-y-auto">
            {lines.length === 0
              ? '(rỗng)'
              : lines.map((l, i) => (
                  <div key={i} className="whitespace-pre">
                    <span className="text-slate-500">{l.offset}</span>
                    {'  '}
                    <span className="text-emerald-300">{l.hex.padEnd(49)}</span>
                    {' '}
                    <span className="text-amber-200">|{l.ascii}|</span>
                  </div>
                ))}
          </pre>
          {pages > 1 && (
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <button className={btnCls} disabled={pg === 0} onClick={() => setPage(pg - 1)}>‹ Trước</button>
              Trang {pg + 1}/{pages} ({PAGE_BYTES} byte/trang)
              <button className={btnCls} disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>Sau ›</button>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

/* ================================================================ */

export default function NumberToolsPage() {
  const [tab, setTab] = useState<Tab>('base');
  const [ready, setReady] = useState(false);
  const [initial, setInitial] = useState<URLSearchParams>(() => new URLSearchParams());
  const [shareParams, setShareParams] = useState<Record<string, string>>({});

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const sp = readShareParams();
    const t = sp.get('tab') as Tab | null;
    if (t && TABS.some((x) => x.id === t)) setTab(t);
    setInitial(sp);
    setReady(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const switchTab = (t: Tab) => {
    setTab(t);
    setInitial(new URLSearchParams());
    setShareParams({});
  };
  const shareRef = useRef(setShareParams);
  const onShare = useMemo(() => (p: Record<string, string>) => shareRef.current(p), []);

  const short = (p: Record<string, string>) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(p)) if (v.length <= 200) out[k] = v;
    return out;
  };

  return (
    <div className="space-y-3.5">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center shrink-0">
            <Calculator className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">Hệ cơ số, Bit &amp; IEEE-754</h1>
            <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
              Đổi cơ số số nguyên lớn tuỳ ý, bật/tắt từng bit, phân tích số thực, dung lượng và byte. Tính toán chính xác bằng BigInt, ngay trên trình duyệt.
            </p>
          </div>
        </div>
        <ShareLinkButton params={{ tab, ...short(shareParams) }} />
      </div>

      <div className="flex flex-wrap gap-1 bg-white rounded-xl border border-slate-200/90 p-1 shadow-xs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => switchTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition ${tab === t.id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {ready && (
        <div key={tab}>
          {tab === 'base' && <BaseTab initial={initial} onShare={onShare} />}
          {tab === 'bits' && <BitsTab initial={initial} onShare={onShare} />}
          {tab === 'float' && <FloatTab initial={initial} onShare={onShare} />}
          {tab === 'size' && <SizeTab initial={initial} onShare={onShare} />}
          {tab === 'bytes' && <BytesTab initial={initial} onShare={onShare} />}
        </div>
      )}
    </div>
  );
}
