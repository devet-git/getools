'use client';

import { useState } from 'react';
import { ShieldCheck, CheckCircle2, XCircle } from 'lucide-react';
import { ToolHeader } from '@/components/ToolHeader';
import { checkCccd, checkMst, checkPhone } from '@/lib/vn-id';

const card = 'bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5';
const field = 'w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-800 outline-hidden focus:border-indigo-500 font-mono';
const TABS = [{ id: 'mst', label: 'Mã số thuế' }, { id: 'cccd', label: 'CCCD 12 số' }, { id: 'phone', label: 'Số điện thoại' }] as const;
type Tab = (typeof TABS)[number]['id'];

function Verdict({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex items-start gap-2 text-sm font-medium ${ok ? 'text-emerald-700' : 'text-red-600'}`}>
      {ok ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <XCircle className="h-5 w-5 shrink-0" />}<div>{children}</div>
    </div>
  );
}
const Row = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between gap-3 py-1 border-b border-slate-100 last:border-0 text-sm"><span className="text-slate-500">{k}</span><span className="font-medium text-slate-900">{v}</span></div>;

export default function VnIdCheckPage() {
  const [tab, setTab] = useState<Tab>('mst');
  const [v, setV] = useState({ mst: '0100109106', cccd: '', phone: '' });
  const val = v[tab];
  const m = tab === 'mst' && val.trim() ? checkMst(val) : null;
  const c = tab === 'cccd' && val.trim() ? checkCccd(val) : null;
  const p = tab === 'phone' && val.trim() ? checkPhone(val) : null;
  return (
    <div className="space-y-3.5">
      <ToolHeader icon={ShieldCheck} title="Kiểm tra MST, CCCD & số điện thoại" desc="Kiểm tra cấu trúc mã số thuế, CCCD 12 số và số di động Việt Nam. Chạy hoàn toàn trên trình duyệt." />
      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => <button key={t.id} onClick={() => setTab(t.id)} className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${tab === t.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{t.label}</button>)}
      </div>
      <div className="grid lg:grid-cols-2 gap-3.5 items-start">
        <section className={`${card} space-y-3`}>
          <input autoFocus autoComplete="off" value={val} onChange={(e) => setV({ ...v, [tab]: e.target.value })} className={field}
            placeholder={tab === 'mst' ? '10 số hoặc 13 số (vd. 0100109106-001)' : tab === 'cccd' ? '12 chữ số trên thẻ' : '0912 345 678 hoặc +84 912 345 678'} />
          <p className="text-xs text-slate-500">Chỉ kiểm tra cấu trúc (độ dài, chữ số kiểm tra, mã tỉnh, đầu số). Không cho biết giấy tờ hay số điện thoại có thật, còn dùng hay thuộc về ai. Dữ liệu không được gửi đi đâu. Hãy tra cứu chính thức tại Tổng cục Thuế hoặc cổng dịch vụ công khi cần xác thực.</p>
        </section>
        <section className={`${card} space-y-2`}>
          {!val.trim() && <p className="text-sm text-slate-500">Nhập giá trị để kiểm tra.</p>}
          {m && (m.valid
            ? <><Verdict ok>Hợp lệ về cấu trúc</Verdict><Row k="Loại" v={m.kind === '13' ? 'MST đơn vị phụ thuộc (13 số)' : 'MST 10 số'} /></>
            : <Verdict ok={false}>{m.reason}</Verdict>)}
          {c && (c.valid
            ? <><Verdict ok>Hợp lệ về cấu trúc</Verdict><Row k="Nơi đăng ký khai sinh" v={c.province!} /><Row k="Giới tính" v={c.gender!} /><Row k="Năm sinh" v={String(c.birthYear)} /><p className="text-[11px] text-slate-500">Mã tỉnh theo đơn vị hành chính cũ in trên thẻ.</p></>
            : <><Verdict ok={false}>{c.reason}</Verdict>{c.province && <Row k="Nơi đăng ký khai sinh" v={c.province} />}</>)}
          {p && (p.valid
            ? <><Verdict ok>Đầu số di động hợp lệ</Verdict><Row k="Dạng trong nước" v={p.national!} /><Row k="Dạng quốc tế" v={p.international!} /><Row k="Đầu số thuộc" v={p.carrier!} /><p className="text-[11px] text-slate-500">Nhà mạng gốc theo đầu số; số có thể đã chuyển mạng giữ số.</p></>
            : <Verdict ok={false}>{p.reason}</Verdict>)}
        </section>
      </div>
    </div>
  );
}
