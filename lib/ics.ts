// Tạo file lịch .ics (RFC 5545) để thêm sự kiện vào Google / Apple / Outlook Calendar.

export type Repeat = 'none' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface IcsEvent {
  title: string;
  description: string;
  location: string;
  allDay: boolean;
  /** YYYY-MM-DD */
  startDate: string;
  /** HH:mm (bỏ qua nếu allDay) */
  startTime: string;
  endDate: string;
  endTime: string;
  /** Múi giờ IANA mà người dùng nhập giờ theo */
  tz: string;
  repeat: Repeat;
  /** Số lần lặp (>0); 0 = lặp mãi */
  count: number;
  /** Nhắc trước bao nhiêu phút; null = không nhắc */
  remindMin: number | null;
}

export const EMPTY_EVENT: IcsEvent = {
  title: '', description: '', location: '', allDay: false,
  startDate: '', startTime: '09:00', endDate: '', endTime: '10:00',
  tz: 'Asia/Ho_Chi_Minh', repeat: 'none', count: 0, remindMin: 15,
};

/** Escape theo RFC 5545 §3.3.11: \ ; , và xuống dòng. */
export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** Gập dòng ở 75 octet (CRLF + 1 khoảng trắng), không cắt giữa ký tự UTF-8. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '', curBytes = 0, limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) { out.push(cur); cur = ''; curBytes = 0; limit = 74; }
    cur += ch; curBytes += b;
  }
  if (cur) out.push(cur);
  return out.join('\r\n ');
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function utcStamp(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

const parseDate = (s: string): [number, number, number] | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? [y, mo, d] : null;
};
const parseTime = (s: string): [number, number] | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  return m && +m[1] < 24 && +m[2] < 60 ? [+m[1], +m[2]] : null;
};

export type IcsResult = { ok: true; ics: string } | { ok: false; error: string };

/**
 * `toInstant` đổi giờ treo tường trong `ev.tz` thành ms epoch (truyền zonedToInstant để dùng được múi giờ có DST).
 * `nowMs` và `uid` được truyền vào để kết quả kiểm thử được.
 */
export function buildIcs(
  ev: IcsEvent, nowMs: number, uid: string,
  toInstant: (y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string) => number,
): IcsResult {
  if (!ev.title.trim()) return { ok: false, error: 'Nhập tiêu đề sự kiện.' };
  const sd = parseDate(ev.startDate), ed = parseDate(ev.endDate || ev.startDate);
  if (!sd) return { ok: false, error: 'Ngày bắt đầu không hợp lệ.' };
  if (!ed) return { ok: false, error: 'Ngày kết thúc không hợp lệ.' };
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//GeTools//Lich hen//VI', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${uid}`, `DTSTAMP:${utcStamp(nowMs)}`];

  if (ev.allDay) {
    const s = Date.UTC(sd[0], sd[1] - 1, sd[2]), e = Date.UTC(ed[0], ed[1] - 1, ed[2]);
    if (e < s) return { ok: false, error: 'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.' };
    const endExcl = new Date(e + 86_400_000);
    const ds = (y: number, m: number, d: number) => `${pad(y, 4)}${pad(m)}${pad(d)}`;
    lines.push(`DTSTART;VALUE=DATE:${ds(sd[0], sd[1], sd[2])}`, `DTEND;VALUE=DATE:${ds(endExcl.getUTCFullYear(), endExcl.getUTCMonth() + 1, endExcl.getUTCDate())}`);
  } else {
    const st = parseTime(ev.startTime), et = parseTime(ev.endTime);
    if (!st || !et) return { ok: false, error: 'Giờ không hợp lệ (dạng HH:mm).' };
    const s = toInstant(sd[0], sd[1], sd[2], st[0], st[1], 0, ev.tz);
    const e = toInstant(ed[0], ed[1], ed[2], et[0], et[1], 0, ev.tz);
    if (e <= s) return { ok: false, error: 'Giờ kết thúc phải sau giờ bắt đầu.' };
    lines.push(`DTSTART:${utcStamp(s)}`, `DTEND:${utcStamp(e)}`);
  }

  lines.push(`SUMMARY:${escapeText(ev.title.trim())}`);
  if (ev.description.trim()) lines.push(`DESCRIPTION:${escapeText(ev.description.trim())}`);
  if (ev.location.trim()) lines.push(`LOCATION:${escapeText(ev.location.trim())}`);
  if (ev.repeat !== 'none') {
    if (!Number.isInteger(ev.count) || ev.count < 0 || ev.count > 1000) return { ok: false, error: 'Số lần lặp từ 0 (mãi mãi) đến 1000.' };
    lines.push(`RRULE:FREQ=${ev.repeat}${ev.count > 0 ? `;COUNT=${ev.count}` : ''}`);
  }
  if (ev.remindMin !== null) {
    if (!Number.isInteger(ev.remindMin) || ev.remindMin < 0 || ev.remindMin > 40320) return { ok: false, error: 'Nhắc trước từ 0 đến 40320 phút (4 tuần).' };
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(ev.title.trim())}`, `TRIGGER:-PT${ev.remindMin}M`, 'END:VALARM');
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return { ok: true, ics: lines.map(foldLine).join('\r\n') + '\r\n' };
}
