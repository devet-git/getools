'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { QrCode as QrIcon, Download, Copy } from 'lucide-react';
import { useApp } from '@/components/AppContext';
import { ToolHeader } from '@/components/ToolHeader';
import { Select } from '@/components/ui/searchable-select';
import { BANKS, buildVietQr, sanitizeMemo } from '@/lib/vietqr';
import { parseMoney } from '@/lib/split-bill';

const card = 'bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5';
const field = 'w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-800 outline-hidden focus:border-indigo-500';
const OTHER = 'other';

export default function VietQrPage() {
  const { showToast } = useApp();
  const [bank, setBank] = useState('970436');
  const [bin, setBin] = useState('');
  const [account, setAccount] = useState('');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);

  const realBin = bank === OTHER ? bin.trim() : bank;
  const amt = amount.trim() ? parseMoney(amount) : 0;
  let payload = '', error = '';
  if (account.trim()) {
    try { payload = buildVietQr({ bin: realBin, account: account.trim(), amount: amt, memo }); }
    catch (e) { error = e instanceof Error ? e.message : 'Lỗi'; }
  }

  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !payload) return;
    QRCode.toCanvas(cv, payload, { errorCorrectionLevel: 'M', width: 300, margin: 2 }).catch(() => {});
  }, [payload]);

  const bankName = bank === OTHER ? `BIN ${bin}` : BANKS.find((b) => b.bin === bank)?.name ?? '';
  const download = () => {
    const cv = canvas.current; if (!cv) return;
    const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = `vietqr-${account.trim()}.png`; a.click();
  };
  const copy = async () => { try { await navigator.clipboard.writeText(payload); showToast('Đã sao chép chuỗi VietQR'); } catch { showToast('Không sao chép được'); } };

  return (
    <div className="space-y-3.5">
      <ToolHeader icon={QrIcon} title="Mã QR chuyển khoản VietQR" desc="Tạo mã QR chuẩn VietQR để nhận tiền: nhập ngân hàng, số tài khoản, số tiền và nội dung." />
      <div className="grid lg:grid-cols-2 gap-3.5 items-start">
        <section className={`${card} space-y-3`}>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 space-y-1">Ngân hàng
            <Select value={bank} onChange={(e) => setBank(e.target.value)}>
              {BANKS.map((b) => <option key={b.bin} value={b.bin}>{b.name} ({b.code})</option>)}
              <option value={OTHER}>Ngân hàng khác (nhập mã BIN)</option>
            </Select>
          </label>
          {bank === OTHER && <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 space-y-1">Mã BIN (6 chữ số)<input inputMode="numeric" value={bin} onChange={(e) => setBin(e.target.value)} className={field} /></label>}
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 space-y-1">Số tài khoản<input inputMode="text" value={account} onChange={(e) => setAccount(e.target.value)} className={`${field} font-mono`} placeholder="vd. 0123456789" /></label>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 space-y-1">Tên người nhận (chỉ để hiển thị trên ảnh, không có trong mã)<input value={name} onChange={(e) => setName(e.target.value)} className={field} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 space-y-1">Số tiền (tùy chọn)<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={field} placeholder="vd. 150k, 1.200.000" /></label>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 space-y-1">Nội dung<input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={80} className={field} placeholder="vd. Tien an toi" /></label>
          </div>
          {memo && sanitizeMemo(memo) !== memo && <p className="text-xs text-amber-700">Nội dung sẽ được bỏ dấu và ký tự đặc biệt: &quot;{sanitizeMemo(memo)}&quot;</p>}
          <p className="text-xs text-slate-500">Chỉ xử lý trên trình duyệt, không gửi thông tin đi đâu. Để trống số tiền thì người chuyển tự nhập khi quét. Hãy quét thử bằng app ngân hàng và kiểm tra tên người nhận trước khi chia sẻ.</p>
        </section>
        <section className={`${card} space-y-3 text-center`}>
          {!account.trim() ? <p className="text-sm text-slate-500 text-left">Nhập số tài khoản để tạo mã.</p>
            : error ? <p className="text-sm text-red-600 text-left">{error}</p> : (
              <>
                <canvas ref={canvas} className="mx-auto rounded-lg border border-slate-200" />
                <div className="text-sm text-slate-700">
                  <div className="font-semibold">{name || 'Người nhận'}</div>
                  <div className="font-mono">{bankName} · {account.trim()}</div>
                  {amt > 0 && <div className="font-bold">{amt.toLocaleString('vi-VN')} đ</div>}
                  {memo && <div className="text-xs text-slate-500">{sanitizeMemo(memo)}</div>}
                </div>
                <div className="flex justify-center gap-2">
                  <button onClick={download} className="px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-1.5"><Download className="h-3.5 w-3.5" /> Tải ảnh PNG</button>
                  <button onClick={copy} className="px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-200 hover:bg-slate-50 flex items-center gap-1.5"><Copy className="h-3.5 w-3.5" /> Chép chuỗi</button>
                </div>
              </>
            )}
        </section>
      </div>
    </div>
  );
}
