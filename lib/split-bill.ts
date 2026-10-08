/** Chia tiền nhóm: tính số dư từng người và đề xuất ít giao dịch nhất. Tiền tính theo đơn vị nguyên (vd. đồng). */

export interface Person { id: string; name: string }

export interface Expense {
  id: string;
  title: string;
  amount: number;
  /** id người đã trả */
  payer: string;
  /** id những người cùng hưởng */
  participants: string[];
  /** 'equal': chia đều; 'exact': nhập số tiền riêng từng người */
  mode: 'equal' | 'exact';
  exact: Record<string, number>;
}

export interface Transfer { from: string; to: string; amount: number }

export interface Summary {
  paid: Record<string, number>;
  owed: Record<string, number>;
  /** dương = được nhận lại, âm = còn nợ */
  balance: Record<string, number>;
  transfers: Transfer[];
  total: number;
  /** khoản chi có số tiền riêng không khớp tổng */
  mismatched: string[];
}

/** Chia `amount` thành n phần nguyên, phần dư chia dần cho những người đầu. */
export function splitEqual(amount: number, n: number): number[] {
  if (n <= 0) return [];
  const total = Math.round(amount);
  const base = Math.floor(total / n);
  const rem = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

export function shareOf(e: Expense): Record<string, number> {
  const out: Record<string, number> = {};
  if (e.mode === 'exact') {
    for (const id of e.participants) out[id] = Math.round(e.exact[id] || 0);
    return out;
  }
  const parts = splitEqual(e.amount, e.participants.length);
  e.participants.forEach((id, i) => { out[id] = parts[i]; });
  return out;
}

export function summarize(people: Person[], expenses: Expense[]): Summary {
  const paid: Record<string, number> = {};
  const owed: Record<string, number> = {};
  for (const p of people) { paid[p.id] = 0; owed[p.id] = 0; }
  const mismatched: string[] = [];
  let total = 0;
  for (const e of expenses) {
    const amount = Math.round(e.amount);
    if (!(amount > 0) || e.participants.length === 0 || !(e.payer in paid)) continue;
    const share = shareOf(e);
    const sum = Object.values(share).reduce((a, b) => a + b, 0);
    if (e.mode === 'exact' && sum !== amount) { mismatched.push(e.id); continue; }
    total += amount;
    paid[e.payer] += amount;
    for (const [id, v] of Object.entries(share)) if (id in owed) owed[id] += v;
  }
  const balance: Record<string, number> = {};
  for (const p of people) balance[p.id] = paid[p.id] - owed[p.id];
  return { paid, owed, balance, transfers: settle(balance), total, mismatched };
}

/** Ghép người nợ nhiều nhất với người được nhận nhiều nhất để giảm số lần chuyển khoản. */
export function settle(balance: Record<string, number>): Transfer[] {
  const cred = Object.entries(balance).filter(([, v]) => v > 0).map(([id, v]) => ({ id, v })).sort((a, b) => b.v - a.v);
  const debt = Object.entries(balance).filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v })).sort((a, b) => b.v - a.v);
  const out: Transfer[] = [];
  let i = 0, j = 0;
  while (i < cred.length && j < debt.length) {
    const amt = Math.min(cred[i].v, debt[j].v);
    if (amt > 0) out.push({ from: debt[j].id, to: cred[i].id, amount: amt });
    cred[i].v -= amt; debt[j].v -= amt;
    if (cred[i].v === 0) i++;
    if (debt[j].v === 0) j++;
    cred.sort((a, b) => b.v - a.v); // giữ thứ tự theo số còn lại
    debt.sort((a, b) => b.v - a.v);
    i = 0; j = 0;
    while (i < cred.length && cred[i].v === 0) i++;
    while (j < debt.length && debt[j].v === 0) j++;
  }
  return out;
}

export const fmtMoney = (n: number) => Math.round(n).toLocaleString('vi-VN') + 'đ';

/** Chấp nhận "1.200.000", "1,200,000", "1200k", "1.5tr", "2 triệu". */
export function parseMoney(raw: string): number {
  const s = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return 0;
  const m = s.match(/^([\d.,]+)(k|nghìn|ngàn|tr|triệu|m)?$/);
  if (!m) return 0;
  let num = m[1];
  const mult = m[2] === 'k' || m[2] === 'nghìn' || m[2] === 'ngàn' ? 1e3 : m[2] ? 1e6 : 1;
  if (mult > 1) num = num.replace(',', '.');
  else num = num.replace(/[.,](?=\d{3}(\D|$))/g, '');
  const v = parseFloat(num.replace(/,/g, '.'));
  return Number.isFinite(v) ? Math.round(v * mult) : 0;
}

export function summaryText(people: Person[], s: Summary, title: string): string {
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? '?';
  const lines = [`💸 ${title || 'Chia tiền nhóm'} — tổng chi ${fmtMoney(s.total)}`, ''];
  for (const p of people) {
    const b = s.balance[p.id];
    lines.push(`• ${p.name}: đã trả ${fmtMoney(s.paid[p.id])}, phần của mình ${fmtMoney(s.owed[p.id])} → ${b > 0 ? 'nhận lại ' + fmtMoney(b) : b < 0 ? 'cần trả ' + fmtMoney(-b) : 'đã hòa'}`);
  }
  lines.push('');
  if (!s.transfers.length) lines.push('Không ai cần chuyển khoản.');
  else { lines.push('Chuyển khoản:'); for (const t of s.transfers) lines.push(`➡ ${name(t.from)} → ${name(t.to)}: ${fmtMoney(t.amount)}`); }
  return lines.join('\n');
}
