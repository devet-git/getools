'use client';

import { useMemo, useRef, useState } from 'react';
import { FileText, Plus, Trash2, Printer } from 'lucide-react';
import { ToolHeader } from '@/components/ToolHeader';
import { Select } from '@/components/ui/searchable-select';
import { parseNum } from '@/lib/percent';
import { parseMoney } from '@/lib/split-bill';
import { KIND_LABEL, buildInvoiceHtml, computeTotals, type DocKind, type Invoice, type Party } from '@/lib/invoice';

const card = 'bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5';
const field = 'w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-800 outline-hidden focus:border-indigo-500';
const lbl = 'block text-xs font-bold uppercase tracking-wider text-slate-700 space-y-1';
const EMPTY: Party = { name: '', taxId: '', address: '', phone: '' };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

interface Row { name: string; unit: string; qty: string; price: string }

function PartyForm({ title, p, onChange }: { title: string; p: Party; onChange: (p: Party) => void }) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-bold text-slate-800">{title}</h2>
      <input value={p.name} onChange={(e) => onChange({ ...p, name: e.target.value })} placeholder="Tên cá nhân / công ty" className={field} />
      <div className="grid grid-cols-2 gap-2">
        <input value={p.taxId} onChange={(e) => onChange({ ...p, taxId: e.target.value })} placeholder="Mã số thuế" className={field} />
        <input value={p.phone} onChange={(e) => onChange({ ...p, phone: e.target.value })} placeholder="Điện thoại" className={field} />
      </div>
      <input value={p.address} onChange={(e) => onChange({ ...p, address: e.target.value })} placeholder="Địa chỉ" className={field} />
    </div>
  );
}

export default function InvoicePage() {
  const [kind, setKind] = useState<DocKind>('quote');
  const [number, setNumber] = useState('001');
  const [date, setDate] = useState(today);
  const [seller, setSeller] = useState<Party>({ ...EMPTY });
  const [buyer, setBuyer] = useState<Party>({ ...EMPTY });
  const [rows, setRows] = useState<Row[]>([{ name: 'Thiết kế logo', unit: 'gói', qty: '1', price: '2.500.000' }, { name: 'In danh thiếp', unit: 'hộp', qty: '2', price: '180.000' }]);
  const [discount, setDiscount] = useState('0');
  const [vat, setVat] = useState('0');
  const [bank, setBank] = useState('');
  const [note, setNote] = useState('');
  const frame = useRef<HTMLIFrameElement>(null);

  const inv: Invoice = useMemo(() => ({
    kind, number, date, seller, buyer,
    items: rows.map((r) => ({ name: r.name, unit: r.unit, qty: parseNum(r.qty) || 0, price: parseMoney(r.price) })),
    discountPct: Math.min(100, Math.max(0, parseNum(discount) || 0)),
    vatPct: Math.max(0, parseNum(vat) || 0), note, bank,
  }), [kind, number, date, seller, buyer, rows, discount, vat, note, bank]);
  const html = useMemo(() => buildInvoiceHtml(inv), [inv]);
  const totals = computeTotals(inv.items, inv.discountPct, inv.vatPct);

  const setRow = (i: number, k: keyof Row, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const print = () => { const w = frame.current?.contentWindow; if (w) { w.focus(); w.print(); } };

  return (
    <div className="space-y-3.5">
      <ToolHeader icon={FileText} title="Báo giá, hóa đơn & phiếu thu" desc="Soạn phiếu báo giá, hóa đơn bán hàng hoặc phiếu thu, xem trước rồi in / lưu PDF. Có tự đọc số tiền bằng chữ.">
        <button onClick={print} className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-indigo-500 text-white hover:bg-indigo-400 flex items-center gap-1.5"><Printer className="h-4 w-4" /> In / Lưu PDF</button>
      </ToolHeader>
      <div className="grid xl:grid-cols-2 gap-3.5 items-start">
        <section className={`${card} space-y-4`}>
          <div className="grid grid-cols-3 gap-2">
            <label className={lbl}>Loại
              <Select value={kind} onChange={(e) => setKind(e.target.value as DocKind)}>
                {(Object.keys(KIND_LABEL) as DocKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </Select>
            </label>
            <label className={lbl}>Số<input value={number} onChange={(e) => setNumber(e.target.value)} className={field} /></label>
            <label className={lbl}>Ngày<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} /></label>
          </div>
          <PartyForm title={kind === 'receipt' ? 'Bên thu' : 'Bên bán'} p={seller} onChange={setSeller} />
          <PartyForm title={kind === 'receipt' ? 'Bên nộp' : 'Bên mua'} p={buyer} onChange={setBuyer} />
          <div className="space-y-2">
            <h2 className="text-sm font-bold text-slate-800">Hàng hóa, dịch vụ</h2>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_56px_56px_96px_auto] gap-1.5 items-center">
                <input value={r.name} onChange={(e) => setRow(i, 'name', e.target.value)} placeholder="Tên hàng / dịch vụ" className={field} />
                <input value={r.unit} onChange={(e) => setRow(i, 'unit', e.target.value)} placeholder="ĐVT" className={field} />
                <input inputMode="decimal" value={r.qty} onChange={(e) => setRow(i, 'qty', e.target.value)} placeholder="SL" className={field} />
                <input inputMode="decimal" value={r.price} onChange={(e) => setRow(i, 'price', e.target.value)} placeholder="Đơn giá" className={field} />
                <button onClick={() => setRows(rows.filter((_, j) => j !== i))} disabled={rows.length < 2} aria-label={`Xóa dòng ${i + 1}`} className="p-1 text-slate-400 hover:text-red-600 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            <button onClick={() => setRows([...rows, { name: '', unit: '', qty: '1', price: '' }])} className="text-xs text-indigo-600 hover:underline flex items-center gap-1"><Plus className="h-3 w-3" /> Thêm dòng</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className={lbl}>Chiết khấu (%)<input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} className={field} /></label>
            <label className={lbl}>Thuế GTGT (%)<input inputMode="decimal" value={vat} onChange={(e) => setVat(e.target.value)} className={field} /></label>
          </div>
          <label className={lbl}>Thông tin thanh toán<input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="vd. Vietcombank · 0123456789 · NGUYEN VAN A" className={field} /></label>
          <label className={lbl}>Ghi chú<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={`${field} normal-case tracking-normal font-normal`} /></label>
          <p className="text-xs text-slate-500">Tổng thanh toán: <b>{totals.total.toLocaleString('vi-VN')} đ</b>. Chứng từ chỉ mang tính tham khảo, không thay thế hóa đơn điện tử theo quy định. Dữ liệu chỉ nằm trên trình duyệt của bạn. Trong hộp thoại in, chọn &quot;Lưu dạng PDF&quot; và tắt &quot;Đầu trang và chân trang&quot;.</p>
        </section>
        <section className={`${card} p-0 overflow-hidden`}>
          <iframe ref={frame} title="Xem trước" srcDoc={html} sandbox="allow-same-origin allow-modals" className="w-full h-[900px] bg-white" />
        </section>
      </div>
    </div>
  );
}
