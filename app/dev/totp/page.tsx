'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  Fingerprint, Copy, Check, Download, RefreshCw, Trash2, ShieldAlert, Plus, ImageIcon,
} from 'lucide-react';
import { Select } from '@/components/ui/searchable-select';
import { useApp } from '@/components/AppContext';
import {
  ALGORITHMS, OtpAlgorithm, OtpType, base32Decode, base32Encode, buildOtpUri, formatSecret, generateSecret,
  groupDigits, hotp, parseOtpUri, parseSecretInput, stepProgress, totp, totpCounter, verifyTotp, effectiveTime,
  VerifyResult,
} from '@/lib/totp';

type Tab = 'gen' | 'verify' | 'uri' | 'hotp';
const TABS: { id: Tab; label: string }[] = [
  { id: 'gen', label: 'Sinh mã' },
  { id: 'verify', label: 'Xác minh' },
  { id: 'uri', label: 'URI & QR' },
  { id: 'hotp', label: 'HOTP' },
];

const inputCls = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-300';
const btnCls = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40';
const labelCls = 'block text-xs font-medium text-slate-500 mb-1';

function CopyButton({ text, k, label = 'Sao chép', copied, onCopy }: {
  text: string; k: string; label?: string; copied: boolean; onCopy: (t: string, k: string) => void;
}) {
  return (
    <button className={btnCls} disabled={!text} onClick={() => onCopy(text, k)}>
      {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />} {label}
    </button>
  );
}

const SAMPLE_SECRET = 'JBSWY3DPEHPK3PXP';

export default function TotpPage() {
  const { showToast } = useApp();
  const [tab, setTab] = useState<Tab>('gen');
  const [secret, setSecret] = useState('');
  const [algorithm, setAlgorithm] = useState<OtpAlgorithm>('SHA-1');
  const [digits, setDigits] = useState(6);
  const [period, setPeriod] = useState(30);
  const [offset, setOffset] = useState(0);
  const [bits, setBits] = useState(160);
  const [copied, setCopied] = useState('');

  // thời gian hiện tại (cập nhật mượt, dừng khi tab ẩn)
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last > 50) {
        last = t;
        setNow(Date.now());
      }
      raf = requestAnimationFrame(loop);
    };
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (document.visibilityState === 'visible') {
        setNow(Date.now());
        raf = requestAnimationFrame(loop);
      }
    };
    onVis();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const decoded = useMemo(() => (secret.trim() ? base32Decode(secret) : null), [secret]);
  const bytes = decoded && decoded.ok ? decoded.bytes : null;
  const secretError = decoded && !decoded.ok ? decoded.error : '';
  const b32 = bytes ? base32Encode(bytes, false) : '';

  const eff = effectiveTime(now, offset);
  const counter = totpCounter(eff, period);
  const counterKey = counter.toString();

  const copy = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? '' : c)), 1500);
      showToast('Đã sao chép');
    } catch {
      showToast('Không thể sao chép');
    }
  }, [showToast]);

  const onSecretChange = (v: string) => {
    if (/otpauth:\/\/|secret=/i.test(v)) {
      const r = parseSecretInput(v);
      if (r.ok) {
        setSecret(r.secret);
        if (r.uri) {
          setAlgorithm(r.uri.algorithm);
          setDigits(r.uri.digits);
          setPeriod(r.uri.period);
          setIssuer(r.uri.issuer);
          setAccount(r.uri.account);
          setOtpType(r.uri.type);
          setHCounter(String(r.uri.counter));
        }
        showToast('Đã đọc secret từ chuỗi dán vào');
        return;
      }
      showToast(r.error);
    }
    setSecret(v);
  };

  const newSecret = () => {
    setSecret(base32Encode(generateSecret(bits), false));
    showToast('Đã tạo secret ngẫu nhiên mới');
  };

  // ----- Sinh mã -----
  const [codes, setCodes] = useState<{ prev: string; cur: string; next: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!bytes) { Promise.resolve().then(() => !cancelled && setCodes(null)); return () => { cancelled = true; }; }
    const c = BigInt(counterKey);
    Promise.all([
      c > BigInt(0) ? hotp(bytes, c - BigInt(1), algorithm, digits) : Promise.resolve('—'),
      hotp(bytes, c, algorithm, digits),
      hotp(bytes, c + BigInt(1), algorithm, digits),
    ]).then(([prev, cur, next]) => !cancelled && setCodes({ prev, cur, next })).catch(() => !cancelled && setCodes(null));
    return () => { cancelled = true; };
  }, [bytes, algorithm, digits, counterKey]);

  const { remaining, fraction } = stepProgress(eff, period);
  const lowTime = remaining <= 5;

  // ----- Xác minh -----
  const [vCode, setVCode] = useState('');
  const [win, setWin] = useState(1);
  const [vRes, setVRes] = useState<VerifyResult | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!bytes || !vCode.trim()) { Promise.resolve().then(() => !cancelled && setVRes(null)); return () => { cancelled = true; }; }
    verifyTotp(bytes, vCode, eff, { algorithm, digits, period }, win).then((r) => !cancelled && setVRes(r));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes, vCode, win, algorithm, digits, period, counterKey]);

  // ----- URI & QR -----
  const [otpType, setOtpType] = useState<OtpType>('totp');
  const [issuer, setIssuer] = useState('');
  const [account, setAccount] = useState('');
  const [uriIn, setUriIn] = useState('');
  const [uriInErr, setUriInErr] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hCounter, setHCounter] = useState('0');
  const uriRes = useMemo(
    () => (secret.trim()
      ? buildOtpUri({ type: otpType, issuer, account, secret, algorithm, digits, period, counter: Number(hCounter) || 0 })
      : null),
    [otpType, issuer, account, secret, algorithm, digits, period, hCounter],
  );
  const uri = uriRes && uriRes.ok ? uriRes.value : '';
  const uriErr = uriRes && !uriRes.ok ? uriRes.error : '';

  useEffect(() => {
    if (tab !== 'uri') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!uri) { canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height); return; }
    QRCode.toCanvas(canvas, uri, { errorCorrectionLevel: 'M', width: 240, margin: 2 }).catch(() => {});
  }, [uri, tab]);

  const parseUriIn = (v: string) => {
    setUriIn(v);
    if (!v.trim()) { setUriInErr(''); return; }
    const r = parseOtpUri(v);
    if (!r.ok) { setUriInErr(r.error); return; }
    setUriInErr('');
    const u = r.value;
    setOtpType(u.type); setIssuer(u.issuer); setAccount(u.account); setSecret(u.secret);
    setAlgorithm(u.algorithm); setDigits(u.digits); setPeriod(u.period); setHCounter(String(u.counter));
  };

  const downloadQr = () => {
    const c = canvasRef.current;
    if (!c || !uri) return;
    c.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'totp-qr.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  };
  const copyQr = () => {
    const c = canvasRef.current;
    if (!c || !uri) return;
    c.toBlob(async (blob) => {
      try {
        if (!blob) throw new Error();
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        showToast('Đã sao chép ảnh QR');
      } catch {
        showToast('Trình duyệt không cho sao chép ảnh');
      }
    });
  };

  // ----- HOTP -----
  const hc = /^\d{1,19}$/.test(hCounter) ? BigInt(hCounter) : null;
  const [hCodes, setHCodes] = useState<{ c: bigint; code: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!bytes || hc === null) { Promise.resolve().then(() => !cancelled && setHCodes([])); return () => { cancelled = true; }; }
    Promise.all([0, 1, 2, 3, 4].map(async (i) => {
      const c = hc + BigInt(i);
      return { c, code: await hotp(bytes, c, algorithm, digits) };
    })).then((r) => !cancelled && setHCodes(r)).catch(() => !cancelled && setHCodes([]));
    return () => { cancelled = true; };
  }, [bytes, hc, algorithm, digits]);

  const clearAll = () => {
    setSecret(''); setAlgorithm('SHA-1'); setDigits(6); setPeriod(30); setOffset(0);
    setVCode(''); setWin(1); setIssuer(''); setAccount(''); setUriIn(''); setUriInErr('');
    setHCounter('0'); setOtpType('totp'); setCodes(null); setCopied('');
    showToast('Đã xóa toàn bộ dữ liệu');
  };

  const cb = (text: string, k: string, label?: string) => (
    <CopyButton text={text} k={k} label={label} copied={copied === k} onCopy={copy} />
  );

  const paramsPanel = (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div>
        <label className={labelCls}>Thuật toán</label>
        <Select className={inputCls} value={algorithm} onChange={(e) => setAlgorithm(e.target.value as OtpAlgorithm)}>
          {ALGORITHMS.map((a) => <option key={a} value={a}>{a}</option>)}
        </Select>
      </div>
      <div>
        <label className={labelCls}>Số chữ số</label>
        <Select className={inputCls} value={digits} onChange={(e) => setDigits(Number(e.target.value))}>
          {[6, 7, 8].map((d) => <option key={d} value={d}>{d}</option>)}
        </Select>
      </div>
      <div>
        <label className={labelCls}>Chu kỳ (giây)</label>
        <input type="number" min={15} max={120} className={inputCls} value={period}
          onChange={(e) => setPeriod(Math.max(15, Math.min(120, Math.trunc(Number(e.target.value)) || 30)))} />
      </div>
      <div>
        <label className={labelCls}>Lệch giờ (giây)</label>
        <input type="number" min={-3600} max={3600} className={inputCls} value={offset}
          onChange={(e) => setOffset(Math.max(-3600, Math.min(3600, Math.trunc(Number(e.target.value)) || 0)))} />
      </div>
    </div>
  );

  const R = 44;
  const C = 2 * Math.PI * R;

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="bg-slate-900 text-white rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Fingerprint size={18} className="text-emerald-400" />
          <h1 className="font-semibold text-sm">TOTP / Mã 2FA</h1>
          <span className="text-xs text-slate-400 hidden sm:inline">RFC 4226 · RFC 6238 · Base32</span>
        </div>
        <button onClick={clearAll} className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/90 hover:bg-red-500 px-3 py-1.5 text-xs font-medium">
          <Trash2 size={14} /> Xóa tất cả
        </button>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 flex gap-2.5">
        <ShieldAlert size={18} className="shrink-0 mt-0.5 text-amber-600" />
        <div className="space-y-1">
          <p><b>Mọi thứ chỉ chạy trong trình duyệt của bạn</b> — secret không được gửi đi đâu, không lưu vào localStorage và không bao giờ nằm trong link chia sẻ.</p>
          <p><b>Không dán secret 2FA thật của tài khoản quan trọng</b> vào bất kỳ công cụ web nào. Hãy dùng secret thử nghiệm khi debug. Tải lại trang sẽ xóa toàn bộ dữ liệu.</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-60">
            <label className={labelCls}>Secret (Base32) — hoặc dán URI otpauth:// / chuỗi secret=…</label>
            <input
              className={`${inputCls} font-mono`}
              value={secret}
              spellCheck={false}
              autoComplete="off"
              placeholder="vd. JBSW Y3DP EHPK 3PXP"
              onChange={(e) => onSecretChange(e.target.value)}
            />
          </div>
          <Select className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs" value={bits} onChange={(e) => setBits(Number(e.target.value))} title="Độ dài secret">
            {[128, 160, 256, 384, 512].map((b) => <option key={b} value={b}>{b} bit</option>)}
          </Select>
          <button className={btnCls} onClick={newSecret}><RefreshCw size={14} /> Tạo secret mới</button>
          <button className={btnCls} onClick={() => setSecret(SAMPLE_SECRET)}>Mẫu</button>
        </div>
        {secretError && <p className="text-xs text-red-600">{secretError}</p>}
        {bytes && <p className="text-xs text-slate-500">Hợp lệ: {bytes.length * 8} bit · <span className="font-mono">{formatSecret(b32)}</span></p>}
        {paramsPanel}
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${tab === t.id ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'gen' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          {!bytes ? (
            <p className="text-sm text-slate-500 text-center py-8">Nhập secret Base32 hoặc bấm “Tạo secret mới” để xem mã.</p>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-center gap-6">
                <div className="relative w-28 h-28">
                  <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                    <circle cx="50" cy="50" r={R} fill="none" strokeWidth="8" className="stroke-slate-100" />
                    <circle cx="50" cy="50" r={R} fill="none" strokeWidth="8" strokeLinecap="round"
                      className={lowTime ? 'stroke-red-500' : 'stroke-emerald-500'}
                      strokeDasharray={C} strokeDashoffset={C * fraction} />
                  </svg>
                  <div className={`absolute inset-0 flex items-center justify-center text-lg font-semibold tabular-nums ${lowTime ? 'text-red-600' : 'text-slate-700'}`}>
                    {Math.ceil(remaining)}s
                  </div>
                </div>
                <div className="text-center">
                  <div className={`font-mono text-5xl sm:text-6xl font-bold tracking-wider tabular-nums ${lowTime ? 'text-red-600' : 'text-slate-900'}`}>
                    {codes ? groupDigits(codes.cur) : '······'}
                  </div>
                  <div className="mt-3">{cb(codes?.cur ?? '', 'cur', 'Sao chép mã')}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 max-w-md mx-auto">
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-center">
                  <div className="text-xs text-slate-500">Mã trước</div>
                  <div className="font-mono text-lg text-slate-600 tabular-nums">{codes ? groupDigits(codes.prev) : '—'}</div>
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-center">
                  <div className="text-xs text-slate-500">Mã kế tiếp</div>
                  <div className="font-mono text-lg text-slate-600 tabular-nums">{codes ? groupDigits(codes.next) : '—'}</div>
                </div>
              </div>
              <p className="text-xs text-slate-500 text-center">
                Bước (counter) {counterKey} · giờ dùng để tính: {new Date(eff).toLocaleTimeString('vi-VN')}
                {offset !== 0 && ` (lệch ${offset > 0 ? '+' : ''}${offset}s so với đồng hồ máy)`}
              </p>
            </div>
          )}
        </div>
      )}

      {tab === 'verify' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Mã cần kiểm tra</label>
              <input className={`${inputCls} font-mono text-lg tracking-widest`} inputMode="numeric" autoComplete="off"
                value={vCode} onChange={(e) => setVCode(e.target.value.slice(0, 12))} placeholder={'0'.repeat(digits)} />
            </div>
            <div>
              <label className={labelCls}>Cửa sổ ± số bước: {win} (≈ ±{win * period}s)</label>
              <input type="range" min={0} max={10} value={win} onChange={(e) => setWin(Number(e.target.value))} className="w-full accent-indigo-500" />
            </div>
          </div>
          {!bytes && <p className="text-sm text-slate-500">Cần nhập secret hợp lệ ở phía trên.</p>}
          {bytes && vRes && (
            vRes.error ? (
              <p className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2">{vRes.error}</p>
            ) : vRes.valid ? (
              <p className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-3 py-2">
                Hợp lệ. {vRes.drift === 0 ? 'Khớp với bước hiện tại (không lệch).' : `Lệch ${vRes.drift! > 0 ? '+' : ''}${vRes.drift} bước (${vRes.drift! > 0 ? '+' : ''}${vRes.drift! * period}s) — đồng hồ của bên tạo mã ${vRes.drift! < 0 ? 'chậm' : 'nhanh'} hơn máy này.`}
              </p>
            ) : (
              <p className="rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm px-3 py-2">Không hợp lệ trong cửa sổ ±{win} bước.</p>
            )
          )}
          <p className="text-xs text-slate-500">Mẹo: mở rộng cửa sổ để dò độ lệch đồng hồ; sau đó nhập “Lệch giờ” ở trên để bù.</p>
        </div>
      )}

      {tab === 'uri' && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Issuer</label>
                <input className={inputCls} value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="Công ty ABC" />
              </div>
              <div>
                <label className={labelCls}>Tài khoản</label>
                <input className={inputCls} value={account} onChange={(e) => setAccount(e.target.value)} placeholder="user@example.com" />
              </div>
              <div>
                <label className={labelCls}>Loại</label>
                <Select className={inputCls} value={otpType} onChange={(e) => setOtpType(e.target.value as OtpType)}>
                  <option value="totp">TOTP (theo thời gian)</option>
                  <option value="hotp">HOTP (theo bộ đếm)</option>
                </Select>
              </div>
              {otpType === 'hotp' && (
                <div>
                  <label className={labelCls}>Counter</label>
                  <input className={inputCls} inputMode="numeric" value={hCounter} onChange={(e) => setHCounter(e.target.value.replace(/\D/g, '').slice(0, 15))} />
                </div>
              )}
            </div>
            <p className="text-xs text-slate-500">Secret, thuật toán, số chữ số và chu kỳ lấy từ phần phía trên.</p>
            <div>
              <label className={labelCls}>Phân tích một otpauth:// URI có sẵn</label>
              <textarea className={`${inputCls} font-mono h-20`} value={uriIn} spellCheck={false} onChange={(e) => parseUriIn(e.target.value)} placeholder="otpauth://totp/Issuer:account?secret=…" />
              {uriInErr && <p className="text-xs text-red-600 mt-1">{uriInErr}</p>}
              {uriIn && !uriInErr && <p className="text-xs text-emerald-600 mt-1">Đã điền các trường từ URI.</p>}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
            {!secret.trim() ? (
              <p className="text-sm text-slate-500 py-8 text-center">Nhập secret để tạo URI và mã QR.</p>
            ) : uriErr ? (
              <p className="text-sm text-red-600">{uriErr}</p>
            ) : null}
            <div className="flex justify-center">
              <canvas ref={canvasRef} className={`rounded-lg border border-slate-200 bg-white ${uri ? '' : 'hidden'}`} width={240} height={240} />
            </div>
            {uri && (
              <>
                <div className="rounded-lg bg-slate-900 text-slate-100 p-3 font-mono text-xs break-all">{uri}</div>
                <div className="flex flex-wrap gap-2">
                  {cb(uri, 'uri', 'Sao chép URI')}
                  <button className={btnCls} onClick={downloadQr}><Download size={14} /> Tải PNG</button>
                  <button className={btnCls} onClick={copyQr}><ImageIcon size={14} /> Sao chép ảnh</button>
                </div>
                <p className="text-xs text-slate-500">Mã QR chứa secret — chỉ quét bằng thiết bị của bạn và đừng chia sẻ ảnh.</p>
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'hotp' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-56">
              <label className={labelCls}>Counter (64-bit)</label>
              <input className={`${inputCls} font-mono`} inputMode="numeric" value={hCounter}
                onChange={(e) => setHCounter(e.target.value.replace(/\D/g, '').slice(0, 19))} />
            </div>
            <button className={btnCls} disabled={hc === null} onClick={() => hc !== null && setHCounter((hc + BigInt(1)).toString())}>
              <Plus size={14} /> Tăng 1
            </button>
            <button className={btnCls} onClick={() => setHCounter('0')}>Về 0</button>
          </div>
          {hc === null && <p className="text-xs text-red-600">Counter phải là số nguyên không âm.</p>}
          {hc !== null && hc > (BigInt(1) << BigInt(64)) - BigInt(1) && <p className="text-xs text-red-600">Counter vượt quá 2^64−1.</p>}
          {!bytes && <p className="text-sm text-slate-500">Cần nhập secret hợp lệ ở phía trên.</p>}
          {bytes && hCodes.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {hCodes.map(({ c, code }, i) => (
                <li key={c.toString()} className={`flex items-center justify-between px-3 py-2 ${i === 0 ? 'bg-emerald-50' : ''}`}>
                  <span className="text-xs text-slate-500 font-mono">#{c.toString()}</span>
                  <span className={`font-mono tabular-nums ${i === 0 ? 'text-2xl font-bold text-slate-900' : 'text-lg text-slate-600'}`}>{groupDigits(code)}</span>
                  {cb(code, `h${i}`, '')}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-slate-500">HOTP dùng bộ đếm thay cho thời gian: mỗi lần dùng mã, phía máy chủ và thiết bị cùng tăng counter. Hiển thị 5 mã từ counter hiện tại.</p>
        </div>
      )}
    </div>
  );
}
