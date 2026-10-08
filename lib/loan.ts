/** Tính khoản vay (gốc đều / niên kim / lãi trên gốc ban đầu) và tiết kiệm lãi kép. */

export type LoanMethod = 'reducing-equal-principal' | 'annuity' | 'flat';

export interface LoanRow { n: number; payment: number; principal: number; interest: number; balance: number }
export interface LoanResult { rows: LoanRow[]; totalInterest: number; totalPaid: number; firstPayment: number; lastPayment: number }

export function loanSchedule(principal: number, annualPct: number, months: number, method: LoanMethod, graceMonths = 0): LoanResult {
  const n = Math.max(1, Math.round(months));
  const r = annualPct / 100 / 12;
  const rows: LoanRow[] = [];
  let bal = principal;
  const grace = Math.min(Math.max(0, Math.round(graceMonths)), n - 1);
  const m = n - grace;
  const annuity = r === 0 ? principal / m : (principal * r) / (1 - Math.pow(1 + r, -m));
  for (let i = 1; i <= n; i++) {
    let interest: number, pr: number;
    if (method === 'flat') {
      interest = principal * r;
      pr = i <= grace ? 0 : principal / m;
    } else {
      interest = bal * r;
      if (i <= grace) pr = 0;
      else pr = method === 'annuity' ? annuity - interest : principal / m;
    }
    if (i === n) pr = bal; // triệt tiêu sai số làm tròn
    bal = Math.max(0, bal - pr);
    rows.push({ n: i, payment: pr + interest, principal: pr, interest, balance: bal });
  }
  const totalInterest = rows.reduce((a, x) => a + x.interest, 0);
  return { rows, totalInterest, totalPaid: principal + totalInterest, firstPayment: rows[0].payment, lastPayment: rows[rows.length - 1].payment };
}

export interface SavingsPoint { month: number; deposited: number; value: number }

/** Lãi kép ghép lãi theo tháng; gửi thêm cuối mỗi tháng. */
export function savingsGrowth(initial: number, monthly: number, annualPct: number, months: number): SavingsPoint[] {
  const r = annualPct / 100 / 12;
  const out: SavingsPoint[] = [{ month: 0, deposited: initial, value: initial }];
  let v = initial, dep = initial;
  for (let i = 1; i <= months; i++) {
    v = v * (1 + r) + monthly;
    dep += monthly;
    out.push({ month: i, deposited: dep, value: v });
  }
  return out;
}

/** Số tháng cần để đạt mục tiêu; null nếu không bao giờ đạt (trong 100 năm). */
export function monthsToGoal(initial: number, monthly: number, annualPct: number, goal: number): number | null {
  const r = annualPct / 100 / 12;
  let v = initial;
  if (v >= goal) return 0;
  for (let i = 1; i <= 1200; i++) {
    v = v * (1 + r) + monthly;
    if (v >= goal) return i;
  }
  return null;
}

/** Số tiền gửi hàng tháng cần có để đạt mục tiêu sau `months` tháng. */
export function monthlyForGoal(initial: number, annualPct: number, months: number, goal: number): number {
  const r = annualPct / 100 / 12;
  const grown = initial * Math.pow(1 + r, months);
  if (grown >= goal) return 0;
  const factor = r === 0 ? months : (Math.pow(1 + r, months) - 1) / r;
  return (goal - grown) / factor;
}
