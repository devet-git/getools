// Tính tuổi, đếm ngược, ngày làm việc (trừ lễ VN) và đổi âm ↔ dương lịch.
// Mọi phép tính dùng "ngày thuần" (năm/tháng/ngày, UTC) để không bị lệch múi giờ / giờ mùa hè.

export interface YMD { y: number; m: number; d: number }

const DAY_MS = 86_400_000;

export const toDays = ({ y, m, d }: YMD): number => Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
export const fromDays = (n: number): YMD => {
  const dt = new Date(n * DAY_MS);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
};

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function isValidYMD({ y, m, d }: YMD): boolean {
  return Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d)
    && y >= 1 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/** Parse "YYYY-MM-DD" (giá trị của <input type="date">). */
export function parseISODate(s: string): YMD | null {
  const mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!mt) return null;
  const v = { y: +mt[1], m: +mt[2], d: +mt[3] };
  return isValidYMD(v) ? v : null;
}

export const toISODate = ({ y, m, d }: YMD): string =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export function todayYMD(now = new Date()): YMD {
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
}

export const WEEKDAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
export const weekdayOf = (v: YMD): number => new Date(Date.UTC(v.y, v.m - 1, v.d)).getUTCDay();

/** Cộng `n` tháng, kẹp ngày về cuối tháng nếu tháng đích ngắn hơn (31/1 + 1 tháng = 28/2). */
export function addMonths(v: YMD, n: number): YMD {
  const total = v.y * 12 + (v.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = (total % 12 + 12) % 12 + 1;
  return { y, m, d: Math.min(v.d, daysInMonth(y, m)) };
}

// ─── Tuổi ────────────────────────────────────────────────────────────────────

export interface AgeResult {
  years: number; months: number; days: number;
  totalDays: number; totalWeeks: number; totalMonths: number;
  nextBirthday: YMD; daysToNextBirthday: number; nextAge: number;
  birthWeekday: number;
}

/** Ngày sinh nhật của năm `y` (29/2 rơi về 28/2 ở năm không nhuận). */
function birthdayIn(birth: YMD, y: number): YMD {
  return { y, m: birth.m, d: Math.min(birth.d, daysInMonth(y, birth.m)) };
}

export function computeAge(birth: YMD, on: YMD): AgeResult | null {
  const b = toDays(birth), t = toDays(on);
  if (t < b) return null;
  let years = on.y - birth.y;
  if (toDays(addMonths(birth, years * 12)) > t) years--;
  let months = 0;
  while (toDays(addMonths(birth, years * 12 + months + 1)) <= t) months++;
  const days = t - toDays(addMonths(birth, years * 12 + months));
  // sinh nhật kế tiếp: hôm nay nếu trùng, nếu không là lần tới
  let next = birthdayIn(birth, on.y);
  if (toDays(next) < t) next = birthdayIn(birth, on.y + 1);
  return {
    years, months, days, totalDays: t - b, totalWeeks: Math.floor((t - b) / 7), totalMonths: years * 12 + months,
    nextBirthday: next, daysToNextBirthday: toDays(next) - t, nextAge: next.y - birth.y,
    birthWeekday: weekdayOf(birth),
  };
}

// ─── Âm lịch (dựa trên Intl "chinese" — múi giờ UTC+8, có thể lệch ngày ở vài năm hiếm) ──

export interface LunarDate { year: number; month: number; day: number; leap: boolean }

const lunarFmt = (): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat('en-u-ca-chinese', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function solarToLunar(v: YMD): LunarDate | null {
  try {
    const parts = lunarFmt().formatToParts(new Date(Date.UTC(v.y, v.m - 1, v.d, 12)));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const m = /^(\d+)(bis)?$/.exec(get('month'));
    const year = Number(get('relatedYear')), day = Number(get('day'));
    if (!m || !year || !day) return null;
    return { year, month: Number(m[1]), day, leap: !!m[2] };
  } catch { return null; }
}

/** Đổi âm → dương bằng cách dò trong khoảng năm dương tương ứng (không cần bảng tra). */
export function lunarToSolar(l: LunarDate): YMD | null {
  const start = toDays({ y: l.year, m: 1, d: 1 });
  for (let i = 0; i < 400; i++) {
    const s = fromDays(start + i);
    const c = solarToLunar(s);
    if (c && c.year === l.year && c.month === l.month && c.day === l.day && c.leap === l.leap) return s;
  }
  return null;
}

const CAN = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'];
const CHI = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi'];
export const canChiYear = (year: number): string => `${CAN[((year - 4) % 10 + 10) % 10]} ${CHI[((year - 4) % 12 + 12) % 12]}`;

// ─── Ngày lễ Việt Nam & ngày làm việc ────────────────────────────────────────

export interface Holiday { date: YMD; name: string }

/**
 * Các ngày nghỉ lễ theo luật (Bộ luật Lao động): Tết Dương lịch, Tết Âm lịch (5 ngày: cuối năm + mùng 1–4),
 * Giỗ Tổ 10/3 âm, 30/4, 1/5 và Quốc khánh (2/9 + 1 ngày liền kề từ 2025).
 * KHÔNG gồm ngày nghỉ bù do Chính phủ công bố từng năm — người dùng thêm tay ở phần "ngày nghỉ thêm".
 */
export function vietnamHolidays(year: number): Holiday[] {
  const out: Holiday[] = [
    { date: { y: year, m: 1, d: 1 }, name: 'Tết Dương lịch' },
    { date: { y: year, m: 4, d: 30 }, name: 'Giải phóng miền Nam' },
    { date: { y: year, m: 5, d: 1 }, name: 'Quốc tế Lao động' },
    { date: { y: year, m: 9, d: 2 }, name: 'Quốc khánh' },
  ];
  if (year >= 2025) out.push({ date: { y: year, m: 9, d: 1 }, name: 'Quốc khánh (liền kề)' });

  const gio = lunarToSolar({ year, month: 3, day: 10, leap: false });
  if (gio) out.push({ date: gio, name: 'Giỗ Tổ Hùng Vương (10/3 âm)' });

  const tet = lunarToSolar({ year, month: 1, day: 1, leap: false });
  if (tet) {
    const t = toDays(tet);
    for (let i = 0; i < 4; i++) out.push({ date: fromDays(t + i), name: i === 0 ? 'Mùng 1 Tết' : `Mùng ${i + 1} Tết` });
    out.push({ date: fromDays(t - 1), name: 'Giao thừa (ngày cuối năm âm)' });
  }
  return out.sort((a, b) => toDays(a.date) - toDays(b.date));
}

export function holidaySet(fromYear: number, toYear: number, extra: YMD[] = []): Set<number> {
  const s = new Set<number>(extra.map(toDays));
  for (let y = fromYear; y <= toYear; y++) for (const h of vietnamHolidays(y)) s.add(toDays(h.date));
  return s;
}

export interface WorkdayOptions { saturdayWork: boolean; useHolidays: boolean; extraHolidays: YMD[] }

const isWorkday = (n: number, o: WorkdayOptions, hol: Set<number>): boolean => {
  const wd = new Date(n * DAY_MS).getUTCDay();
  if (wd === 0) return false;
  if (wd === 6 && !o.saturdayWork) return false;
  return !hol.has(n);
};

/** Số ngày làm việc trong [from, to] (gồm cả hai đầu). */
export function countWorkdays(from: YMD, to: YMD, o: WorkdayOptions): number {
  const a = toDays(from), b = toDays(to);
  if (b < a) return 0;
  const hol = o.useHolidays ? holidaySet(from.y, to.y, o.extraHolidays) : new Set(o.extraHolidays.map(toDays));
  let n = 0;
  for (let i = a; i <= b; i++) if (isWorkday(i, o, hol)) n++;
  return n;
}

/** Ngày sau khi cộng `n` ngày làm việc (n âm = lùi). n = 0 trả về chính ngày bắt đầu. */
export function addWorkdays(from: YMD, n: number, o: WorkdayOptions): YMD {
  const step = n < 0 ? -1 : 1;
  let cur = toDays(from), left = Math.abs(n);
  const hol = o.useHolidays
    ? holidaySet(from.y - 1, from.y + 2 + Math.ceil(Math.abs(n) / 200), o.extraHolidays)
    : new Set(o.extraHolidays.map(toDays));
  while (left > 0) {
    cur += step;
    if (isWorkday(cur, o, hol)) left--;
  }
  return fromDays(cur);
}

export function formatVN({ y, m, d }: YMD): string {
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}
