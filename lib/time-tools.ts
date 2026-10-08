/**
 * Tiện ích thời gian / múi giờ — chỉ dùng Intl + Date có sẵn, không thư viện.
 * "Wall time" = giờ treo tường (năm, tháng, ngày, giờ...) trong một múi giờ IANA.
 */

export const WEEKDAYS_VI = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

export const DEFAULT_ZONES = [
  'Asia/Ho_Chi_Minh',
  'UTC',
  'America/New_York',
  'Europe/London',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
];

export interface WallParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
  weekday: number; // 0 = Chủ nhật
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function getDtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      era: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    getDtf(tz);
    return true;
  } catch {
    return false;
  }
}

export function listTimeZones(): string[] {
  let zones: string[] = [];
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (fn) zones = fn('timeZone');
  } catch {
    zones = [];
  }
  if (zones.length === 0) zones = [...DEFAULT_ZONES];
  if (!zones.includes('UTC')) zones = ['UTC', ...zones];
  return zones;
}

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Các thành phần giờ treo tường của một thời điểm (ms epoch) trong múi giờ tz. */
export function getWallParts(ms: number, tz: string): WallParts {
  const f = getDtf(tz);
  const floored = Math.floor(ms / 1000) * 1000;
  const parts = f.formatToParts(new Date(floored));
  let year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0;
  let bc = false;
  for (const p of parts) {
    switch (p.type) {
      case 'year': year = +p.value; break;
      case 'month': month = +p.value; break;
      case 'day': day = +p.value; break;
      case 'hour': hour = +p.value % 24; break;
      case 'minute': minute = +p.value; break;
      case 'second': second = +p.value; break;
      case 'era': bc = /^B/i.test(p.value); break;
    }
  }
  if (bc) year = 1 - year;
  const fake = utcFromParts(year, month, day, hour, minute, second);
  return {
    year, month, day, hour, minute, second,
    ms: ((ms % 1000) + 1000) % 1000,
    weekday: new Date(fake).getUTCDay(),
  };
}

/** Date.UTC nhưng không bị ép năm 0-99 thành 19xx. */
export function utcFromParts(y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0): number {
  const dt = new Date(0);
  dt.setUTCFullYear(y, mo - 1, d);
  dt.setUTCHours(h, mi, s, ms);
  return dt.getTime();
}

/** Độ lệch (ms) của tz so với UTC tại thời điểm ms: wall = utc + offset. */
export function getOffsetMs(ms: number, tz: string): number {
  const p = getWallParts(ms, tz);
  const wall = utcFromParts(p.year, p.month, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(ms / 1000) * 1000;
}

export function formatOffset(offsetMs: number, withColon = true): string {
  const sign = offsetMs < 0 ? '-' : '+';
  const abs = Math.abs(Math.round(offsetMs / 60000));
  const h = String(Math.floor(abs / 60)).padStart(2, '0');
  const m = String(abs % 60).padStart(2, '0');
  return `${sign}${h}${withColon ? ':' : ''}${m}`;
}

/**
 * Đổi giờ treo tường trong múi giờ tz thành thời điểm (ms epoch).
 * - Giờ bị lặp (lùi đồng hồ): chọn lần xuất hiện sớm hơn.
 * - Giờ không tồn tại (tiến đồng hồ): đẩy tới sau khoảng trống (dùng offset trước chuyển đổi).
 */
export function zonedToInstant(
  y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string, ms = 0
): number {
  const guess = utcFromParts(y, mo, d, h, mi, s, ms);
  const DAY = 86400000;
  const offBefore = getOffsetMs(guess - DAY, tz);
  const offAfter = getOffsetMs(guess + DAY, tz);
  const target = Math.floor(guess / 1000);
  const candidates = Array.from(new Set([offBefore, offAfter])).map((o) => guess - o);
  const valid = candidates.filter((c) => {
    const p = getWallParts(c, tz);
    return Math.floor(utcFromParts(p.year, p.month, p.day, p.hour, p.minute, p.second) / 1000) === target;
  });
  if (valid.length > 0) return Math.min(...valid);
  return guess - offBefore;
}

/** Giờ treo tường có thật sự tồn tại trong tz không (false khi rơi vào khoảng trống DST). */
export function wallExists(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): boolean {
  const inst = zonedToInstant(y, mo, d, h, mi, s, tz);
  const p = getWallParts(inst, tz);
  return p.year === y && p.month === mo && p.day === d && p.hour === h && p.minute === mi && p.second === s;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function fmtYear(y: number): string {
  return y >= 0 && y <= 9999 ? pad(y, 4) : (y < 0 ? '-' : '+') + pad(Math.abs(y), 6);
}

/** "YYYY-MM-DD HH:mm:ss" trong tz. */
export function formatWall(ms: number, tz: string, withMs = false): string {
  const p = getWallParts(ms, tz);
  return `${fmtYear(p.year)}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${
    withMs ? '.' + pad(p.ms, 3) : ''
  }`;
}

/** ISO 8601 có offset của tz, ví dụ 2023-11-15T05:13:20+07:00 (UTC → Z). */
export function formatIso(ms: number, tz: string, withMs = false): string {
  const p = getWallParts(ms, tz);
  const off = getOffsetMs(ms, tz);
  const base = `${fmtYear(p.year)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${
    withMs ? '.' + pad(p.ms, 3) : ''
  }`;
  return base + (tz === 'UTC' || off === 0 ? (tz === 'UTC' ? 'Z' : '+00:00') : formatOffset(off));
}

export function isoUtc(ms: number, withMs = true): string {
  return formatIso(ms, 'UTC', withMs);
}

/** Tên múi giờ ngắn (GMT+7, EST...) */
export function zoneAbbr(ms: number, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(ms));
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

export type TimestampUnit = 's' | 'ms' | 'us' | 'ns';

export const UNIT_LABEL: Record<TimestampUnit, string> = {
  s: 'giây',
  ms: 'mili giây',
  us: 'micro giây',
  ns: 'nano giây',
};

/** Nhận dạng đơn vị theo độ lớn và đổi sang ms. */
export function detectTimestamp(input: string): { ms: number; unit: TimestampUnit } | null {
  const t = input.trim().replace(/_/g, '');
  if (!/^[+-]?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  const a = Math.abs(n);
  let unit: TimestampUnit;
  let ms: number;
  if (a < 1e11) { unit = 's'; ms = n * 1000; }
  else if (a < 1e14) { unit = 'ms'; ms = n; }
  else if (a < 1e17) { unit = 'us'; ms = n / 1000; }
  else { unit = 'ns'; ms = n / 1e6; }
  ms = Math.round(ms);
  if (Math.abs(ms) > 8.64e15) return null;
  return { ms, unit };
}

const MONTHS_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function validWall(y: number, mo: number, d: number, h: number, mi: number, s: number): boolean {
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return false;
  const dim = new Date(utcFromParts(y, mo + 1, 0)).getUTCDate();
  return d <= dim;
}

/**
 * Phân tích chuỗi ngày. Chuỗi không kèm múi giờ được hiểu theo `tz`.
 * Hỗ trợ: ISO 8601, RFC 2822, "YYYY-MM-DD HH:mm:ss", dd/mm/yyyy [HH:mm[:ss]].
 */
export function parseDateString(input: string, tz: string): number | null {
  const s = input.trim();
  if (!s) return null;

  // ISO / "YYYY-MM-DD[ T]HH:mm[:ss[.fff]]" [Z|±hh[:mm]]
  let m = s.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i
  );
  if (m) {
    const [y, mo, d, h, mi, sec] = [+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)];
    if (!validWall(y, mo, d, h, mi, sec)) return null;
    const frac = m[7] ? Math.floor(+('0.' + m[7]) * 1000) : 0;
    if (m[8]) {
      const z = m[8].toUpperCase();
      let off = 0;
      if (z !== 'Z') {
        const sign = z[0] === '-' ? -1 : 1;
        const digits = z.slice(1).replace(':', '');
        off = sign * (+digits.slice(0, 2) * 60 + +(digits.slice(2) || 0)) * 60000;
      }
      return utcFromParts(y, mo, d, h, mi, sec, frac) - off;
    }
    return zonedToInstant(y, mo, d, h, mi, sec, tz, frac);
  }

  // dd/mm/yyyy [HH:mm[:ss]]  (cũng nhận - và .)
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [d, mo, y, h, mi, sec] = [+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)];
    if (!validWall(y, mo, d, h, mi, sec)) return null;
    return zonedToInstant(y, mo, d, h, mi, sec, tz);
  }

  // RFC 2822: "Tue, 14 Nov 2023 22:13:20 +0000" / "14 Nov 2023 22:13:20 GMT"
  m = s.match(
    /^(?:[A-Za-z]{3},?\s+)?(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(GMT|UTC|UT|Z|[+-]\d{4})?$/i
  );
  if (m) {
    const mo = MONTHS_EN.indexOf(m[2].toLowerCase()) + 1;
    const [d, y, h, mi, sec] = [+m[1], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)];
    if (mo < 1 || !validWall(y, mo, d, h, mi, sec)) return null;
    if (m[7]) {
      const z = m[7].toUpperCase();
      let off = 0;
      if (/^[+-]/.test(z)) off = (z[0] === '-' ? -1 : 1) * (+z.slice(1, 3) * 60 + +z.slice(3, 5)) * 60000;
      return utcFromParts(y, mo, d, h, mi, sec) - off;
    }
    return zonedToInstant(y, mo, d, h, mi, sec, tz);
  }

  // Dự phòng: để Date.parse thử (ví dụ "Nov 14, 2023 10:00 PM UTC")
  const fallback = Date.parse(s);
  return Number.isNaN(fallback) ? null : fallback;
}

/** Thời gian tương đối: "3 giờ trước", "sau 2 ngày". */
export function relativeTime(targetMs: number, nowMs: number): string {
  const diff = targetMs - nowMs;
  const abs = Math.abs(diff);
  if (abs < 1000) return 'vừa xong';
  const units: [number, string][] = [
    [365.2425 * 86400000, 'năm'],
    [30.436875 * 86400000, 'tháng'],
    [7 * 86400000, 'tuần'],
    [86400000, 'ngày'],
    [3600000, 'giờ'],
    [60000, 'phút'],
    [1000, 'giây'],
  ];
  for (const [size, name] of units) {
    if (abs >= size) {
      const n = Math.floor(abs / size);
      return diff < 0 ? `${n} ${name} trước` : `sau ${n} ${name}`;
    }
  }
  return 'vừa xong';
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, mo: number): number {
  return new Date(utcFromParts(y, mo + 1, 0)).getUTCDate();
}

export function dayOfYear(y: number, mo: number, d: number): number {
  return Math.round((utcFromParts(y, mo, d) - utcFromParts(y, 1, 1)) / 86400000) + 1;
}

/** Tuần ISO 8601. */
export function isoWeek(y: number, mo: number, d: number): { week: number; year: number } {
  const date = new Date(utcFromParts(y, mo, d));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const isoYear = date.getUTCFullYear();
  const yearStart = utcFromParts(isoYear, 1, 1);
  return { week: Math.ceil(((date.getTime() - yearStart) / 86400000 + 1) / 7), year: isoYear };
}

export interface InstantInfo {
  ms: number;
  unixSeconds: number;
  isoUtc: string;
  isoZone: string;
  local: string;
  localZone: string;
  zoneWall: string;
  zoneOffset: string;
  zoneAbbr: string;
  rfc2822: string;
  relative: string;
  weekday: string;
  week: string;
  dayOfYear: number;
  leap: boolean;
}

export function describeInstant(ms: number, tz: string, localTz: string, nowMs: number): InstantInfo {
  const z = getWallParts(ms, tz);
  const wk = isoWeek(z.year, z.month, z.day);
  const u = getWallParts(ms, 'UTC');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][u.month - 1];
  const dn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][u.weekday];
  return {
    ms,
    unixSeconds: Math.floor(ms / 1000),
    isoUtc: isoUtc(ms),
    isoZone: formatIso(ms, tz, true),
    local: formatWall(ms, localTz, true),
    localZone: localTz,
    zoneWall: formatWall(ms, tz, true),
    zoneOffset: formatOffset(getOffsetMs(ms, tz)),
    zoneAbbr: zoneAbbr(ms, tz),
    rfc2822: `${dn}, ${pad(u.day)} ${mon} ${pad(u.year, 4)} ${pad(u.hour)}:${pad(u.minute)}:${pad(u.second)} +0000`,
    relative: relativeTime(ms, nowMs),
    weekday: WEEKDAYS_VI[z.weekday],
    week: `Tuần ${wk.week} (năm ISO ${wk.year})`,
    dayOfYear: dayOfYear(z.year, z.month, z.day),
    leap: isLeapYear(z.year),
  };
}

/* ---------------- Máy tính ngày ---------------- */

export interface DateDiff {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalDays: number; // số ngày (có phần lẻ) theo thời gian thực
  totalHours: number;
  totalSeconds: number;
  calendarDays: number; // số ngày lịch giữa 2 ngày (theo giờ treo tường)
  weekdays: number; // số ngày làm việc T2-T6 trong [from, to)
  negative: boolean;
}

/** Chênh lệch giữa hai thời điểm, tính theo lịch trong múi giờ tz. */
export function diffDates(aMs: number, bMs: number, tz: string): DateDiff {
  const negative = bMs < aMs;
  const from = negative ? bMs : aMs;
  const to = negative ? aMs : bMs;
  const f = getWallParts(from, tz);
  const t = getWallParts(to, tz);

  // Số tháng nguyên: lùi lại nếu mốc (from + m tháng, kẹp cuối tháng) vượt quá `to`.
  const anchorFor = (m: number) => {
    const tm = f.year * 12 + (f.month - 1) + m;
    const ay = Math.floor(tm / 12);
    const amo = tm - ay * 12 + 1;
    return utcFromParts(ay, amo, Math.min(f.day, daysInMonth(ay, amo)), f.hour, f.minute, f.second);
  };
  const toWall = utcFromParts(t.year, t.month, t.day, t.hour, t.minute, t.second);
  let totalMonths = (t.year - f.year) * 12 + (t.month - f.month);
  while (totalMonths > 0 && anchorFor(totalMonths) > toWall) totalMonths--;
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  let rest = Math.round((toWall - anchorFor(totalMonths)) / 1000);
  const days = Math.floor(rest / 86400); rest -= days * 86400;
  const hours = Math.floor(rest / 3600); rest -= hours * 3600;
  const minutes = Math.floor(rest / 60);
  const seconds = rest - minutes * 60;

  const totalMs = to - from;
  const d1 = utcFromParts(f.year, f.month, f.day);
  const d2 = utcFromParts(t.year, t.month, t.day);
  const calendarDays = Math.round((d2 - d1) / 86400000);
  // đếm ngày làm việc trong [ngày from, ngày to)
  let weekdays = 0;
  const full = Math.floor(calendarDays / 7);
  weekdays = full * 5;
  const startDow = new Date(d1).getUTCDay();
  for (let i = 0; i < calendarDays - full * 7; i++) {
    const dow = (startDow + i) % 7;
    if (dow !== 0 && dow !== 6) weekdays++;
  }
  return {
    years, months, days, hours, minutes, seconds,
    totalDays: totalMs / 86400000,
    totalHours: totalMs / 3600000,
    totalSeconds: totalMs / 1000,
    calendarDays,
    weekdays,
    negative,
  };
}

export interface Duration {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/**
 * Cộng (sign=1) / trừ (sign=-1) khoảng thời gian. Năm/tháng/ngày cộng theo lịch trong giờ treo tường
 * (tháng bị kẹp về ngày cuối tháng, giữ nguyên giờ qua DST); giờ/phút/giây cộng theo thời gian thực.
 */
export function addDuration(ms: number, tz: string, dur: Duration, sign: 1 | -1): number {
  const p = getWallParts(ms, tz);
  const totalMonths = p.year * 12 + (p.month - 1) + sign * (dur.years * 12 + dur.months);
  const ny = Math.floor(totalMonths / 12);
  const nm = totalMonths - ny * 12 + 1;
  const nd = Math.min(p.day, daysInMonth(ny, nm)) + sign * dur.days;
  // utcFromParts chuẩn hoá ngày tràn
  const norm = new Date(utcFromParts(ny, nm, nd, p.hour, p.minute, p.second));
  const base = zonedToInstant(
    norm.getUTCFullYear(), norm.getUTCMonth() + 1, norm.getUTCDate(),
    norm.getUTCHours(), norm.getUTCMinutes(), norm.getUTCSeconds(), tz, p.ms
  );
  return base + sign * (dur.hours * 3600000 + dur.minutes * 60000 + dur.seconds * 1000);
}

/* ---------------- Đồng hồ thế giới & lịch họp ---------------- */

export interface WorldClockRow {
  tz: string;
  wall: string;
  weekday: string;
  offset: string;
  abbr: string;
  dstShift: boolean; // offset khác offset chuẩn (mùa đông) của năm đó
}

export function worldClock(ms: number, zones: string[]): WorldClockRow[] {
  return zones.filter(isValidTimeZone).map((tz) => {
    const p = getWallParts(ms, tz);
    const off = getOffsetMs(ms, tz);
    const jan = getOffsetMs(utcFromParts(p.year, 1, 1), tz);
    const jul = getOffsetMs(utcFromParts(p.year, 7, 1), tz);
    const std = Math.min(jan, jul);
    return {
      tz,
      wall: formatWall(ms, tz),
      weekday: WEEKDAYS_VI[p.weekday],
      offset: formatOffset(off),
      abbr: zoneAbbr(ms, tz),
      dstShift: jan !== jul && off !== std,
    };
  });
}

export interface PlannerSlot {
  instant: number;
  cells: { hour: number; minute: number; working: boolean; dayShift: number }[];
  allWorking: boolean;
}

/**
 * 24 khung giờ (mỗi giờ) bắt đầu từ 00:00 của ngày tham chiếu theo múi giờ refTz.
 * working = trong giờ làm việc [startHour, endHour) tại múi giờ đó.
 */
export function meetingPlanner(
  refMs: number, refTz: string, zones: string[], startHour = 9, endHour = 18
): PlannerSlot[] {
  const r = getWallParts(refMs, refTz);
  const slots: PlannerSlot[] = [];
  const midnight = zonedToInstant(r.year, r.month, r.day, 0, 0, 0, refTz);
  for (let i = 0; i < 24; i++) {
    const inst = midnight + i * 3600000;
    const cells = zones.map((tz) => {
      const p = getWallParts(inst, tz);
      const minutesOfDay = p.hour * 60 + p.minute;
      const dayShift = Math.round(
        (utcFromParts(p.year, p.month, p.day) - utcFromParts(r.year, r.month, r.day)) / 86400000
      );
      return {
        hour: p.hour,
        minute: p.minute,
        working: minutesOfDay >= startHour * 60 && minutesOfDay < endHour * 60,
        dayShift,
      };
    });
    slots.push({ instant: inst, cells, allWorking: cells.length > 0 && cells.every((c) => c.working) });
  }
  return slots;
}
