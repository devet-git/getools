/** Lương Gross ⇄ Net theo quy định Việt Nam. Mọi tham số có thể chỉnh vì luật thay đổi theo thời gian. */

export interface Bracket { upTo: number; rate: number }

export interface SalaryRules {
  id: string;
  label: string;
  personalDeduction: number;
  dependentDeduction: number;
  brackets: Bracket[];
  /** trần lương đóng BHXH, BHYT (20 × lương cơ sở) */
  capSocial: number;
  employeeRates: { bhxh: number; bhyt: number; bhtn: number };
  employerRates: { bhxh: number; bhyt: number; bhtn: number };
}

const INF = Number.POSITIVE_INFINITY;
const M = 1e6;

/** Vùng I..IV: lương tối thiểu vùng (trần BHTN = 20 lần) */
export const REGIONS: Record<string, { label: string; min2024: number; min2026: number }> = {
  '1': { label: 'Vùng I', min2024: 4_960_000, min2026: 5_310_000 },
  '2': { label: 'Vùng II', min2024: 4_410_000, min2026: 4_730_000 },
  '3': { label: 'Vùng III', min2024: 3_860_000, min2026: 4_140_000 },
  '4': { label: 'Vùng IV', min2024: 3_450_000, min2026: 3_700_000 },
};

const EMP = { bhxh: 0.08, bhyt: 0.015, bhtn: 0.01 };
const CO = { bhxh: 0.175, bhyt: 0.03, bhtn: 0.01 };

export const RULES: SalaryRules[] = [
  {
    id: '2024', label: 'Quy định đến hết 2025 (7 bậc, giảm trừ 11 triệu / 4,4 triệu)',
    personalDeduction: 11 * M, dependentDeduction: 4.4 * M,
    brackets: [{ upTo: 5 * M, rate: 0.05 }, { upTo: 10 * M, rate: 0.1 }, { upTo: 18 * M, rate: 0.15 }, { upTo: 32 * M, rate: 0.2 }, { upTo: 52 * M, rate: 0.25 }, { upTo: 80 * M, rate: 0.3 }, { upTo: INF, rate: 0.35 }],
    capSocial: 46_800_000, employeeRates: EMP, employerRates: CO,
  },
  {
    id: '2026', label: 'Quy định từ 2026 (5 bậc, giảm trừ 15,5 triệu / 6,2 triệu) — cần đối chiếu',
    personalDeduction: 15.5 * M, dependentDeduction: 6.2 * M,
    brackets: [{ upTo: 10 * M, rate: 0.05 }, { upTo: 30 * M, rate: 0.1 }, { upTo: 60 * M, rate: 0.2 }, { upTo: 100 * M, rate: 0.3 }, { upTo: INF, rate: 0.35 }],
    capSocial: 46_800_000, employeeRates: EMP, employerRates: CO,
  },
];

export interface SalaryInput {
  gross: number;
  dependents: number;
  /** có đóng bảo hiểm bắt buộc (hợp đồng lao động ≥ 1 tháng) */
  insured: boolean;
  /** lương đóng BH nếu khác lương Gross (0 = dùng Gross) */
  insuranceBase: number;
  /** lương tối thiểu vùng, dùng tính trần BHTN */
  regionMin: number;
}

export interface BracketLine { from: number; to: number; rate: number; taxable: number; tax: number }

export interface SalaryResult {
  gross: number;
  bhxh: number; bhyt: number; bhtn: number; insuranceTotal: number;
  deductions: number;
  income: number;           // thu nhập chịu thuế
  taxable: number;          // thu nhập tính thuế
  tax: number;
  net: number;
  lines: BracketLine[];
  employer: { bhxh: number; bhyt: number; bhtn: number; total: number; cost: number };
  effectiveRate: number;
}

export function taxByBrackets(taxable: number, brackets: Bracket[]): { tax: number; lines: BracketLine[] } {
  let prev = 0, tax = 0;
  const lines: BracketLine[] = [];
  for (const b of brackets) {
    if (taxable <= prev) break;
    const part = Math.min(taxable, b.upTo) - prev;
    lines.push({ from: prev, to: b.upTo, rate: b.rate, taxable: part, tax: part * b.rate });
    tax += part * b.rate;
    prev = b.upTo;
  }
  return { tax, lines };
}

export function grossToNet(inp: SalaryInput, r: SalaryRules): SalaryResult {
  const gross = Math.max(0, inp.gross);
  const base = inp.insuranceBase > 0 ? inp.insuranceBase : gross;
  const baseSocial = inp.insured ? Math.min(base, r.capSocial) : 0;
  const baseTn = inp.insured ? Math.min(base, inp.regionMin * 20) : 0;
  const bhxh = baseSocial * r.employeeRates.bhxh;
  const bhyt = baseSocial * r.employeeRates.bhyt;
  const bhtn = baseTn * r.employeeRates.bhtn;
  const insuranceTotal = bhxh + bhyt + bhtn;
  const deductions = r.personalDeduction + inp.dependents * r.dependentDeduction;
  const income = gross - insuranceTotal;
  const taxable = Math.max(0, income - deductions);
  const { tax, lines } = taxByBrackets(taxable, r.brackets);
  const net = gross - insuranceTotal - tax;
  const eb = baseSocial, et = baseTn;
  const employer = {
    bhxh: eb * r.employerRates.bhxh, bhyt: eb * r.employerRates.bhyt, bhtn: et * r.employerRates.bhtn,
    total: 0, cost: 0,
  };
  employer.total = employer.bhxh + employer.bhyt + employer.bhtn;
  employer.cost = gross + employer.total;
  return { gross, bhxh, bhyt, bhtn, insuranceTotal, deductions, income, taxable, tax, net, lines, employer, effectiveRate: gross > 0 ? (gross - net) / gross : 0 };
}

/** Net → Gross bằng tìm nhị phân (net tăng đơn điệu theo gross). */
export function netToGross(net: number, inp: Omit<SalaryInput, 'gross'>, r: SalaryRules): SalaryResult {
  let lo = 0, hi = Math.max(net * 3, 1e6) + 1e9;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (grossToNet({ ...inp, gross: mid }, r).net < net) lo = mid; else hi = mid;
  }
  return grossToNet({ ...inp, gross: Math.round(hi) }, r);
}
