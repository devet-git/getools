// Phiếu báo giá / hóa đơn bán hàng / phiếu thu dạng HTML in được (Ctrl+P → Lưu PDF).
// Đây là chứng từ tham khảo, KHÔNG phải hóa đơn điện tử theo Nghị định 123/2020/NĐ-CP.
import { numberToWords, parseNumberInput } from '@/lib/vn-number';

export interface InvoiceItem { name: string; unit: string; qty: number; price: number }
export interface Party { name: string; taxId: string; address: string; phone: string }
export type DocKind = 'quote' | 'sale' | 'receipt';

export interface Invoice {
  kind: DocKind;
  number: string;
  date: string; // YYYY-MM-DD
  seller: Party;
  buyer: Party;
  items: InvoiceItem[];
  discountPct: number;
  vatPct: number;
  note: string;
  bank: string;
}

export const KIND_LABEL: Record<DocKind, string> = { quote: 'PHIẾU BÁO GIÁ', sale: 'HÓA ĐƠN BÁN HÀNG', receipt: 'PHIẾU THU' };

export interface Totals { subtotal: number; discount: number; afterDiscount: number; vat: number; total: number }

export function computeTotals(items: InvoiceItem[], discountPct: number, vatPct: number): Totals {
  const subtotal = items.reduce((s, i) => s + (i.qty || 0) * (i.price || 0), 0);
  const discount = Math.round(subtotal * (discountPct / 100));
  const afterDiscount = subtotal - discount;
  const vat = Math.round(afterDiscount * (vatPct / 100));
  return { subtotal, discount, afterDiscount, vat, total: afterDiscount + vat };
}

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const money = (n: number): string => Math.round(n).toLocaleString('vi-VN');

export function totalInWords(total: number): string {
  const p = parseNumberInput(String(Math.round(total)));
  if (!p) return '';
  return numberToWords(p, { lang: 'vi', unit: 'đồng', capitalize: true, suffixChan: true });
}

export function formatDateVN(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `ngày ${+m[3]} tháng ${+m[2]} năm ${m[1]}` : '';
}

const party = (title: string, p: Party): string => `
  <div class="party"><h3>${title}</h3>
    <div><b>${esc(p.name) || '&nbsp;'}</b></div>
    ${p.taxId ? `<div>MST: ${esc(p.taxId)}</div>` : ''}
    ${p.address ? `<div>${esc(p.address)}</div>` : ''}
    ${p.phone ? `<div>Điện thoại: ${esc(p.phone)}</div>` : ''}
  </div>`;

/** Trang HTML hoàn chỉnh (A4). Mọi dữ liệu người dùng đều được escape. */
export function buildInvoiceHtml(inv: Invoice): string {
  const t = computeTotals(inv.items, inv.discountPct, inv.vatPct);
  const rows = inv.items.map((it, i) => `
    <tr><td class="c">${i + 1}</td><td>${esc(it.name)}</td><td class="c">${esc(it.unit)}</td>
    <td class="r">${esc(String(it.qty))}</td><td class="r">${money(it.price)}</td><td class="r">${money((it.qty || 0) * (it.price || 0))}</td></tr>`).join('');
  const sum = (label: string, v: string, strong = false) => `<tr class="${strong ? 'strong' : ''}"><td colspan="5" class="r">${label}</td><td class="r">${v}</td></tr>`;
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(KIND_LABEL[inv.kind])} ${esc(inv.number)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Roboto, Arial, sans-serif; font-size: 13px; color: #111; margin: 0; padding: 24px; line-height: 1.45; }
  h1 { text-align: center; margin: 0 0 2px; font-size: 22px; letter-spacing: .5px; }
  .meta { text-align: center; color: #444; margin-bottom: 16px; }
  .parties { display: flex; gap: 24px; margin-bottom: 14px; }
  .party { flex: 1; } .party h3 { margin: 0 0 4px; font-size: 12px; text-transform: uppercase; color: #555; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #999; padding: 5px 7px; vertical-align: top; }
  th { background: #f0f0f0; } .c { text-align: center; } .r { text-align: right; white-space: nowrap; }
  tr.strong td { font-weight: 700; font-size: 14px; }
  .words { margin-top: 10px; } .note { margin-top: 8px; color: #333; white-space: pre-wrap; }
  .sign { display: flex; justify-content: space-around; margin-top: 36px; text-align: center; }
  .sign div { width: 40%; } .sign small { color: #666; }
  .disclaimer { margin-top: 30px; font-size: 10px; color: #888; text-align: center; }
  tr { break-inside: avoid; }
</style></head><body>
  <h1>${esc(KIND_LABEL[inv.kind])}</h1>
  <div class="meta">${inv.number ? `Số: <b>${esc(inv.number)}</b> · ` : ''}${esc(formatDateVN(inv.date))}</div>
  <div class="parties">${party(inv.kind === 'receipt' ? 'Bên thu' : 'Bên bán', inv.seller)}${party(inv.kind === 'receipt' ? 'Bên nộp' : 'Bên mua', inv.buyer)}</div>
  <table><thead><tr><th style="width:36px">STT</th><th>Tên hàng hóa, dịch vụ</th><th style="width:60px">ĐVT</th><th style="width:70px">SL</th><th style="width:100px">Đơn giá</th><th style="width:110px">Thành tiền</th></tr></thead>
  <tbody>${rows}
  ${sum('Cộng tiền hàng', money(t.subtotal))}
  ${inv.discountPct > 0 ? sum(`Chiết khấu (${inv.discountPct}%)`, '−' + money(t.discount)) : ''}
  ${inv.vatPct > 0 ? sum(`Thuế GTGT (${inv.vatPct}%)`, money(t.vat)) : ''}
  ${sum('Tổng thanh toán (đồng)', money(t.total), true)}
  </tbody></table>
  <div class="words">Số tiền bằng chữ: <i>${esc(totalInWords(t.total))}</i></div>
  ${inv.bank ? `<div class="note"><b>Thông tin thanh toán:</b> ${esc(inv.bank)}</div>` : ''}
  ${inv.note ? `<div class="note"><b>Ghi chú:</b> ${esc(inv.note)}</div>` : ''}
  <div class="sign"><div><b>${inv.kind === 'receipt' ? 'Người nộp tiền' : 'Bên mua'}</b><br><small>(Ký, ghi rõ họ tên)</small></div><div><b>${inv.kind === 'receipt' ? 'Người thu tiền' : 'Bên bán'}</b><br><small>(Ký, ghi rõ họ tên)</small></div></div>
  <div class="disclaimer">Chứng từ tham khảo, không thay thế hóa đơn điện tử theo quy định của pháp luật về hóa đơn.</div>
</body></html>`;
}
