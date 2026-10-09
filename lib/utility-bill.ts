// Tính tiền điện / nước theo bậc thang. Biểu giá do người dùng chỉnh được; mặc định chỉ để minh họa.

export interface Tier {
  /** Cận trên của bậc (kWh hoặc m³, tính cộng dồn); null = bậc cuối, không giới hạn */
  upTo: number | null;
  /** Đơn giá (đồng / đơn vị), chưa gồm thuế & phí */
  price: number;
}

export interface BillLine { from: number; to: number; qty: number; price: number; amount: number }
export interface Bill { lines: BillLine[]; subtotal: number; fee: number; vat: number; total: number }

/** Biểu giá điện sinh hoạt bán lẻ của EVN theo QĐ 1279/QĐ-BCT (hiệu lực 10/05/2025), chưa gồm VAT. */
export const EVN_TIERS: Tier[] = [
  { upTo: 50, price: 1984 },
  { upTo: 100, price: 2050 },
  { upTo: 200, price: 2380 },
  { upTo: 300, price: 2998 },
  { upTo: 400, price: 3350 },
  { upTo: null, price: 3460 },
];

/** Biểu giá nước CHỈ MINH HỌA: mỗi tỉnh/thành, mỗi công ty cấp nước có biểu giá riêng. */
export const WATER_EXAMPLE_TIERS: Tier[] = [
  { upTo: 10, price: 6000 },
  { upTo: 20, price: 7500 },
  { upTo: 30, price: 9000 },
  { upTo: null, price: 15000 },
];

/** Kiểm tra biểu giá: cận tăng dần, chỉ bậc cuối được để trống, đơn giá ≥ 0. Trả về thông báo lỗi hoặc null. */
export function validateTiers(tiers: Tier[]): string | null {
  if (tiers.length === 0) return 'Cần ít nhất một bậc.';
  let prev = 0;
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    if (!Number.isFinite(t.price) || t.price < 0) return `Bậc ${i + 1}: đơn giá không hợp lệ.`;
    if (i === tiers.length - 1) {
      if (t.upTo !== null) return 'Bậc cuối phải để trống cận trên (không giới hạn).';
    } else {
      if (t.upTo === null || !Number.isFinite(t.upTo)) return `Bậc ${i + 1}: thiếu cận trên.`;
      if (t.upTo <= prev) return `Bậc ${i + 1}: cận trên phải lớn hơn bậc trước (${prev}).`;
      prev = t.upTo;
    }
  }
  return null;
}

/** feePct = phí bảo vệ môi trường (nước) tính trên tiền nước; VAT tính trên (tiền + phí). */
export function computeBill(qty: number, tiers: Tier[], vatPct: number, feePct = 0): Bill {
  const lines: BillLine[] = [];
  let from = 0, left = Math.max(0, qty);
  for (const t of tiers) {
    if (left <= 0) break;
    const to = t.upTo ?? Infinity;
    const take = Math.min(left, to - from);
    if (take > 0) lines.push({ from, to: from + take, qty: take, price: t.price, amount: take * t.price });
    left -= take;
    from = to;
  }
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const fee = subtotal * (feePct / 100);
  const vat = (subtotal + fee) * (vatPct / 100);
  return { lines, subtotal, fee, vat, total: subtotal + fee + vat };
}

/** Từ tổng tiền (đã gồm thuế, phí) suy ngược ra số lượng tiêu thụ. Hàm tổng đơn điệu nên dò nhị phân. */
export function quantityFromTotal(total: number, tiers: Tier[], vatPct: number, feePct = 0): number {
  if (total <= 0) return 0;
  const f = (q: number) => computeBill(q, tiers, vatPct, feePct).total;
  if (f(1e7) < total) return NaN; // đơn giá 0 ở bậc cuối hoặc số quá lớn
  let lo = 0, hi = 1e7;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < total) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
