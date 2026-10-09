// Tài khoản ngân hàng của từng thành viên trong tool Chia tiền nhóm.
// Lưu ở khóa localStorage RIÊNG (không nằm trong state nhóm) để link chia sẻ nhóm không làm lộ số tài khoản.

export interface BankInfo { bin: string; account: string }

const KEY = 'getools_split_bill_banks';

export function readBanks(): Record<string, BankInfo> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, BankInfo> = {};
    for (const [id, b] of Object.entries(v as Record<string, unknown>)) {
      const o = b as Partial<BankInfo> | null;
      if (o && typeof o.bin === 'string' && typeof o.account === 'string') out[id] = { bin: o.bin, account: o.account };
    }
    return out;
  } catch { return {}; }
}

export function writeBank(personId: string, info: BankInfo | null): void {
  try {
    const all = readBanks();
    if (info) all[personId] = info; else delete all[personId];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* bị chặn hoặc đầy bộ nhớ: bỏ qua */ }
}
