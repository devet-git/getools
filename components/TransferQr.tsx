'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Select } from '@/components/ui/searchable-select';
import { BANKS, buildVietQr, sanitizeMemo } from '@/lib/vietqr';
import { readBanks, writeBank, type BankInfo } from '@/lib/split-bill-banks';

const field = 'w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-800 outline-hidden focus:border-indigo-500';

/** Mã VietQR để `payerName` chuyển `amount` cho `payeeName`. Tài khoản người nhận được nhớ trên máy này. */
export function TransferQr({ payeeId, payeeName, payerName, amount, title }: {
  payeeId: string; payeeName: string; payerName: string; amount: number; title: string;
}) {
  const [info, setInfo] = useState<BankInfo | null>(() => readBanks()[payeeId] ?? null);
  const [editing, setEditing] = useState(!info);
  const [bin, setBin] = useState(info?.bin ?? BANKS[0].bin);
  const [account, setAccount] = useState(info?.account ?? '');
  const canvas = useRef<HTMLCanvasElement>(null);

  const memo = sanitizeMemo(`${title} ${payerName}`.trim());
  let payload = '', error = '';
  if (info && !editing) {
    try { payload = buildVietQr({ bin: info.bin, account: info.account, amount: Math.round(amount), memo }); }
    catch (e) { error = e instanceof Error ? e.message : 'Lỗi'; }
  }
  useEffect(() => {
    if (canvas.current && payload) QRCode.toCanvas(canvas.current, payload, { errorCorrectionLevel: 'M', width: 220, margin: 2 }).catch(() => {});
  }, [payload]);

  const save = () => {
    const a = account.trim();
    if (!/^[0-9A-Za-z]{4,19}$/.test(a)) return;
    const next = { bin, account: a };
    writeBank(payeeId, next); setInfo(next); setEditing(false);
  };
  const forget = () => { writeBank(payeeId, null); setInfo(null); setAccount(''); setEditing(true); };

  return (
    <div className="mt-1.5 rounded-lg border border-indigo-100 bg-white p-3 space-y-2">
      {editing ? (
        <>
          <p className="text-xs text-slate-600">Tài khoản nhận tiền của <b>{payeeName}</b> (chỉ lưu trên máy này, không nằm trong link chia sẻ):</p>
          <Select value={bin} onChange={(e) => setBin(e.target.value)}>{BANKS.map((b) => <option key={b.bin} value={b.bin}>{b.name}</option>)}</Select>
          <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Số tài khoản" inputMode="text" className={`${field} font-mono`} />
          <button onClick={save} disabled={!/^[0-9A-Za-z]{4,19}$/.test(account.trim())} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">Lưu & tạo QR</button>
        </>
      ) : error ? <p className="text-sm text-red-600">{error}</p> : (
        <div className="flex items-center gap-3">
          <canvas ref={canvas} className="rounded border border-slate-200" />
          <div className="text-sm text-slate-700 space-y-0.5">
            <div className="font-semibold">{payerName} → {payeeName}</div>
            <div className="font-bold text-indigo-700">{Math.round(amount).toLocaleString('vi-VN')} đ</div>
            <div className="text-xs text-slate-500">{BANKS.find((b) => b.bin === info?.bin)?.name} · {info?.account}</div>
            <div className="text-xs text-slate-500">Nội dung: {memo}</div>
            <button onClick={() => setEditing(true)} className="text-xs text-indigo-600 hover:underline mr-3">Sửa tài khoản</button>
            <button onClick={forget} className="text-xs text-slate-500 hover:text-red-600 hover:underline">Xóa</button>
          </div>
        </div>
      )}
    </div>
  );
}
