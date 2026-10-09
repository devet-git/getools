'use client';

import { useState } from 'react';
import { LockKeyhole, Copy, RefreshCw } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ToolHeader } from '@/components/ToolHeader';
import { DEFAULT_PASSWORD_OPTIONS, generatePassword, passwordEntropyBits, type PasswordOptions } from '@/lib/encoders';
import {
  DEFAULT_PASSPHRASE, WORD_LIST, crackTimeLabel, estimateStrength, generatePassphrase, passphraseEntropyBits, type PassphraseOptions,
} from '@/lib/passphrase';

const card = 'bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5';
const field = 'px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-800 outline-hidden focus:border-indigo-500';
const BAR = ['bg-slate-300', 'bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-emerald-500'];

function Meter({ bits, level, label }: { bits: number; level: number; label: string }) {
  return (
    <div className="space-y-1">
      <div className="flex gap-1">{[1, 2, 3, 4].map((i) => <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= level ? BAR[level] : 'bg-slate-200'}`} />)}</div>
      <p className="text-xs text-slate-600">{label} · ~{bits} bit · thử hết trong {crackTimeLabel(bits)} <span className="text-slate-400">(giả định 10 tỷ lượt thử/giây)</span></p>
    </div>
  );
}

function Generator() {
  const { showToast } = useApp();
  const [kind, setKind] = useState<'random' | 'phrase'>('random');
  const [po, setPo] = useState<PasswordOptions>({ ...DEFAULT_PASSWORD_OPTIONS, length: 20 });
  const [ph, setPh] = useState<PassphraseOptions>(DEFAULT_PASSPHRASE);
  const make = (k = kind, a = po, b = ph) => {
    try { return { v: k === 'random' ? generatePassword(a) : generatePassphrase(b), err: '' }; }
    catch (e) { return { v: '', err: e instanceof Error ? e.message : 'Lỗi' }; }
  };
  const [res, setRes] = useState(() => make());
  const regen = (k = kind, a = po, b = ph) => setRes(make(k, a, b));
  const bits = kind === 'random' ? passwordEntropyBits(po) : passphraseEntropyBits(ph);
  const level = bits < 28 ? 1 : bits < 50 ? 2 : bits < 75 ? 3 : 4;
  const copy = async () => { try { await navigator.clipboard.writeText(res.v); showToast('Đã sao chép'); } catch { showToast('Không sao chép được'); } };
  const chk = (key: 'lower' | 'upper' | 'digits' | 'symbols' | 'excludeAmbiguous', label: string) => (
    <label className="flex items-center gap-2"><input type="checkbox" checked={po[key]} onChange={(e) => { const n = { ...po, [key]: e.target.checked }; setPo(n); regen(kind, n); }} /> {label}</label>
  );
  return (
    <div className="grid lg:grid-cols-2 gap-3.5 items-start">
      <section className={`${card} space-y-3`}>
        <div className="flex gap-1.5">
          {([['random', 'Ký tự ngẫu nhiên'], ['phrase', 'Cụm từ dễ nhớ']] as const).map(([id, l]) => (
            <button key={id} onClick={() => { setKind(id); regen(id); }} className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${kind === id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{l}</button>
          ))}
        </div>
        {kind === 'random' ? (
          <div className="space-y-2.5 text-sm text-slate-600">
            <label className="flex items-center gap-3">Độ dài <b className="w-8 text-slate-900">{po.length}</b>
              <input type="range" min={8} max={64} value={po.length} onChange={(e) => { const n = { ...po, length: +e.target.value }; setPo(n); regen(kind, n); }} className="flex-1" />
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {chk('lower', 'Chữ thường')}{chk('upper', 'Chữ hoa')}{chk('digits', 'Chữ số')}{chk('symbols', 'Ký hiệu')}{chk('excludeAmbiguous', 'Bỏ ký tự dễ nhầm (I l 1 O 0)')}
            </div>
          </div>
        ) : (
          <div className="space-y-2.5 text-sm text-slate-600">
            <label className="flex items-center gap-3">Số từ <b className="w-8 text-slate-900">{ph.words}</b>
              <input type="range" min={3} max={10} value={ph.words} onChange={(e) => { const n = { ...ph, words: +e.target.value }; setPh(n); regen(kind, po, n); }} className="flex-1" />
            </label>
            <label className="flex items-center gap-2">Ngăn cách
              <select value={ph.separator} onChange={(e) => { const n = { ...ph, separator: e.target.value }; setPh(n); regen(kind, po, n); }} className={field}>
                <option value="-">gạch ngang -</option><option value=".">chấm .</option><option value="_">gạch dưới _</option><option value=" ">khoảng trắng</option><option value="">không có</option>
              </select>
            </label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={ph.capitalize} onChange={(e) => { const n = { ...ph, capitalize: e.target.checked }; setPh(n); regen(kind, po, n); }} /> Viết hoa chữ đầu mỗi từ</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={ph.appendNumber} onChange={(e) => { const n = { ...ph, appendNumber: e.target.checked }; setPh(n); regen(kind, po, n); }} /> Thêm số cuối cụm</label>
            <p className="text-xs text-slate-500">Chọn ngẫu nhiên từ {WORD_LIST.length} từ tiếng Việt không dấu (~{(Math.log2(WORD_LIST.length)).toFixed(1)} bit/từ). Cụm từ dễ nhớ và dễ gõ trên điện thoại; mỗi từ thêm ~8 bit, muốn mạnh hơn hãy tăng số từ.</p>
          </div>
        )}
      </section>
      <section className={`${card} space-y-3`}>
        {res.err ? <p className="text-sm text-red-600">{res.err}</p> : (
          <>
            {/* giá trị ngẫu nhiên: bản prerender trên server luôn khác bản trên trình duyệt */}
            <div suppressHydrationWarning className="rounded-lg bg-slate-900 text-emerald-300 font-mono text-lg p-3 break-all select-all">{res.v}</div>
            <div className="flex gap-2">
              <button onClick={copy} className="px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-1.5"><Copy className="h-3.5 w-3.5" /> Sao chép</button>
              <button onClick={() => regen()} className="px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-200 hover:bg-slate-50 flex items-center gap-1.5"><RefreshCw className="h-3.5 w-3.5" /> Tạo mới</button>
            </div>
            <Meter bits={bits} level={level} label={['', 'Rất yếu', 'Yếu', 'Khá', 'Mạnh'][level]} />
            <p className="text-xs text-slate-500">Sinh bằng bộ ngẫu nhiên mật mã của trình duyệt, ngay trên máy bạn; không gửi đi đâu và không lưu lại.</p>
          </>
        )}
      </section>
    </div>
  );
}

function Checker() {
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const s = estimateStrength(pw);
  return (
    <section className={`${card} space-y-3 max-w-2xl`}>
      <h2 className="text-sm font-bold text-slate-800">Kiểm tra độ mạnh mật khẩu</h2>
      <div className="flex gap-2">
        <input type={show ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" spellCheck={false} placeholder="Nhập mật khẩu để kiểm tra" className={`${field} flex-1 font-mono`} />
        <button onClick={() => setShow(!show)} className="px-3 rounded-lg text-sm border border-slate-200 hover:bg-slate-50">{show ? 'Ẩn' : 'Hiện'}</button>
      </div>
      <Meter bits={s.bits} level={s.level} label={s.label} />
      {s.warnings.length > 0 && <ul className="list-disc pl-5 text-sm text-amber-700 space-y-0.5">{s.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      <p className="text-xs text-slate-500">Chỉ là ước lượng thô theo độ dài, loại ký tự và vài mẫu dễ đoán. Mật khẩu được xử lý hoàn toàn trên trình duyệt, không gửi đi. Không dùng lại một mật khẩu cho nhiều tài khoản và nên bật xác thực 2 bước.</p>
    </section>
  );
}

export default function PasswordGenPage() {
  return (
    <div className="space-y-3.5">
      <ToolHeader icon={LockKeyhole} title="Tạo mật khẩu & cụm từ bảo mật" desc="Sinh mật khẩu ngẫu nhiên hoặc cụm từ dễ nhớ, và kiểm tra độ mạnh. Chạy hoàn toàn trên trình duyệt." />
      <Generator />
      <Checker />
    </div>
  );
}
