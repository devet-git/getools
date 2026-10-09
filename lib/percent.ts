// Máy tính phần trăm, giảm giá nhiều lớp và VAT. Toàn bộ là hàm thuần để dễ kiểm thử.

/** Làm tròn đến `dp` chữ số thập phân (tránh lỗi nhị phân kiểu 1.005). */
export function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** Đọc số người dùng gõ: chấp nhận "1.250.000", "1,5", "12%", khoảng trắng. Trả NaN nếu không hợp lệ. */
export function parseNum(s: string): number {
  let t = s.trim().replace(/%$/, '').replace(/\s/g, '');
  if (!t) return NaN;
  const dots = (t.match(/\./g) ?? []).length, commas = (t.match(/,/g) ?? []).length;
  if (dots && commas) {
    // dấu xuất hiện sau cùng là dấu thập phân
    const dec = t.lastIndexOf('.') > t.lastIndexOf(',') ? '.' : ',';
    t = dec === '.' ? t.replace(/,/g, '') : t.replace(/\./g, '').replace(',', '.');
  } else if (dots > 1) t = t.replace(/\./g, '');
  else if (commas > 1) t = t.replace(/,/g, '');
  else if (commas === 1) t = t.replace(',', '.');
  else if (dots === 1 && /^-?\d{1,3}\.\d{3}$/.test(t)) t = t.replace('.', ''); // "1.250" → 1250 (kiểu VN)
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

export const percentOf = (pct: number, base: number): number => (base * pct) / 100;
/** a là bao nhiêu % của b */
export const whatPercent = (a: number, b: number): number => (b === 0 ? NaN : (a / b) * 100);
/** Thay đổi từ `from` đến `to`, tính theo % của `from` (dương = tăng). */
export const percentChange = (from: number, to: number): number => (from === 0 ? NaN : ((to - from) / Math.abs(from)) * 100);
export const increaseBy = (base: number, pct: number): number => base * (1 + pct / 100);
export const decreaseBy = (base: number, pct: number): number => base * (1 - pct / 100);
/** Tìm số gốc biết `value` đã là `pct`% của nó. */
export const baseFromPercent = (value: number, pct: number): number => (pct === 0 ? NaN : (value * 100) / pct);

export interface DiscountResult {
  finalPrice: number;
  totalSaved: number;
  effectivePct: number;
  steps: { pct: number; before: number; after: number; saved: number }[];
}

/** Giảm giá nhiều lớp liên tiếp (vd. giảm 20% rồi thêm 10%): không bằng giảm 30%. */
export function stackedDiscount(price: number, pcts: number[]): DiscountResult {
  let cur = price;
  const steps = pcts.map((pct) => {
    const after = cur * (1 - pct / 100);
    const st = { pct, before: cur, after, saved: cur - after };
    cur = after;
    return st;
  });
  return { finalPrice: cur, totalSaved: price - cur, effectivePct: price === 0 ? 0 : ((price - cur) / price) * 100, steps };
}

export interface VatResult { net: number; vat: number; gross: number }

/** Giá chưa VAT → có VAT. */
export function addVat(net: number, rate: number): VatResult {
  const vat = net * (rate / 100);
  return { net, vat, gross: net + vat };
}

/** Giá đã gồm VAT → tách ra giá chưa VAT và tiền thuế. */
export function removeVat(gross: number, rate: number): VatResult {
  const net = gross / (1 + rate / 100);
  return { net, vat: gross - net, gross };
}

/** Lãi gộp / biên lợi nhuận từ giá vốn và giá bán. */
export function margin(cost: number, price: number): { profit: number; marginPct: number; markupPct: number } {
  const profit = price - cost;
  return { profit, marginPct: price === 0 ? NaN : (profit / price) * 100, markupPct: cost === 0 ? NaN : (profit / cost) * 100 };
}

/** Giá bán để đạt biên lợi nhuận mong muốn (% trên giá bán). */
export const priceForMargin = (cost: number, marginPct: number): number => (marginPct >= 100 ? NaN : cost / (1 - marginPct / 100));

export function fmt(n: number, dp = 2): string {
  if (!Number.isFinite(n)) return '—';
  return round(n, dp).toLocaleString('vi-VN', { maximumFractionDigits: dp });
}
